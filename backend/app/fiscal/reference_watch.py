from __future__ import annotations

import datetime
import hashlib
import html
import json
import os
import re
from dataclasses import dataclass
from typing import Any, Iterable

import httpx
from sqlalchemy.orm import Session

from ..fiscal_reference_models import FiscalOfficialReferenceState


NCM_JSON_URL = "https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json"
NFE_TECHNICAL_REPORTS_URL = (
    "https://www.nfe.fazenda.gov.br/pOrtaL/listaConteudo.aspx?"
    "tipoConteudo=hXzemuyNHW4%3D"
)
RTC_LOCAL_BASE_URL = os.getenv(
    "KOMA_RTC_CALCULATOR_BASE_URL",
    "http://127.0.0.1:8080/api/calculadora",
).rstrip("/")
RTC_VERSION_PATH = "/dados-abertos/versao"


class FiscalReferenceWatchError(RuntimeError):
    pass


@dataclass(frozen=True)
class OfficialReferenceProbe:
    source_key: str
    source_url: str
    source_version: str | None
    content_sha256: str | None
    metadata: dict[str, Any]


@dataclass(frozen=True)
class OfficialReferenceSyncResult:
    source_key: str
    status: str
    changed: bool
    observed_version: str | None
    observed_sha256: str | None
    active_version: str | None
    active_sha256: str | None
    metadata: dict[str, Any]


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _canonical_json_hash(payload: Any) -> str:
    raw = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _extract_ncm_entries(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = None
        for key in ("Nomenclaturas", "nomenclaturas", "data", "items", "lista"):
            candidate = payload.get(key)
            if isinstance(candidate, list):
                rows = candidate
                break
        if rows is None:
            raise FiscalReferenceWatchError("Tabela NCM oficial retornou envelope desconhecido.")
    else:
        raise FiscalReferenceWatchError("Tabela NCM oficial retornou conteúdo não estruturado.")

    normalized = [row for row in rows if isinstance(row, dict)]
    if len(normalized) < 1000:
        raise FiscalReferenceWatchError(
            "Tabela NCM oficial retornou quantidade incompatível com uma carga completa."
        )
    return normalized


def probe_official_ncm(
    *,
    client: httpx.Client | None = None,
    timeout_seconds: float = 30.0,
) -> OfficialReferenceProbe:
    owns_client = client is None
    http = client or httpx.Client(timeout=timeout_seconds, follow_redirects=True)
    try:
        response = http.get(NCM_JSON_URL)
        response.raise_for_status()
        payload = response.json()
        rows = _extract_ncm_entries(payload)
        return OfficialReferenceProbe(
            source_key="rfb-ncm-json",
            source_url=NCM_JSON_URL,
            source_version=None,
            content_sha256=_canonical_json_hash(payload),
            metadata={"entry_count": len(rows), "kind": "ncm-json"},
        )
    except (httpx.HTTPError, ValueError) as exc:
        raise FiscalReferenceWatchError(f"Falha ao consultar NCM oficial: {exc}") from exc
    finally:
        if owns_client:
            http.close()


def _html_to_plain_text(raw_html: str) -> str:
    without_scripts = re.sub(
        r"<(script|style)\b[^>]*>.*?</\1>",
        " ",
        raw_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    without_tags = re.sub(r"<[^>]+>", " ", without_scripts)
    return re.sub(r"\s+", " ", html.unescape(without_tags)).strip()


def _extract_technical_report_snippets(raw_html: str) -> tuple[str, ...]:
    """Extrai somente entradas de Informe Técnico, ignorando estatísticas voláteis."""

    text = _html_to_plain_text(raw_html)
    starts = [
        match.start()
        for match in re.finditer(r"Informe\s+T[eé]cnico", text, flags=re.IGNORECASE)
    ]
    snippets: list[str] = []
    seen: set[str] = set()
    for index, start in enumerate(starts):
        next_start = starts[index + 1] if index + 1 < len(starts) else len(text)
        snippet = text[start : min(next_start, start + 500)].strip(" -|;")
        snippet = re.sub(r"\s+", " ", snippet)
        if snippet and snippet not in seen:
            seen.add(snippet)
            snippets.append(snippet)

    if len(snippets) < 5:
        raise FiscalReferenceWatchError(
            "Portal NF-e retornou poucos Informes Técnicos; parser/fonte precisa ser revisado."
        )
    return tuple(snippets[:50])


def probe_nfe_technical_reports(
    *,
    client: httpx.Client | None = None,
    timeout_seconds: float = 30.0,
) -> OfficialReferenceProbe:
    """Detecta publicações técnicas futuras antes de alterarem as tabelas vigentes."""

    owns_client = client is None
    http = client or httpx.Client(timeout=timeout_seconds, follow_redirects=True)
    try:
        response = http.get(NFE_TECHNICAL_REPORTS_URL)
        response.raise_for_status()
        snippets = _extract_technical_report_snippets(response.text)
        effective_dates = sorted(
            set(
                re.findall(
                    r"(?:vigente\s+)?a\s+partir\s+de\s+(\d{2}/\d{2}/\d{4})",
                    " ".join(snippets),
                    flags=re.IGNORECASE,
                )
            )
        )
        payload = {"technical_reports": snippets}
        return OfficialReferenceProbe(
            source_key="nfe-informes-tecnicos",
            source_url=NFE_TECHNICAL_REPORTS_URL,
            source_version=None,
            content_sha256=_canonical_json_hash(payload),
            metadata={
                "entry_count": len(snippets),
                "recent_entries": list(snippets[:10]),
                "future_effective_dates": effective_dates,
                "kind": "nfe-technical-reports",
            },
        )
    except httpx.HTTPError as exc:
        raise FiscalReferenceWatchError(
            f"Falha ao consultar Informes Técnicos do Portal NF-e: {exc}"
        ) from exc
    finally:
        if owns_client:
            http.close()


def _normalize_rtc_version(payload: Any) -> tuple[str, dict[str, Any]]:
    if not isinstance(payload, dict):
        raise FiscalReferenceWatchError("Calculadora RTC retornou versão em formato inválido.")

    app_version = str(payload.get("versaoApp") or "").strip()
    db_version = str(payload.get("versaoDb") or "").strip()
    environment = str(payload.get("ambiente") or "").strip()
    if not app_version or not db_version:
        raise FiscalReferenceWatchError("Calculadora RTC não informou versaoApp/versaoDb.")

    version = f"{app_version}|db:{db_version}"
    metadata = {
        "versao_app": app_version,
        "versao_db": db_version,
        "descricao_versao_db": payload.get("descricaoVersaoDb"),
        "data_versao_db": payload.get("dataVersaoDb"),
        "ambiente": environment,
    }
    return version, metadata


def probe_local_rtc_calculator(
    *,
    base_url: str | None = None,
    client: httpx.Client | None = None,
    timeout_seconds: float = 5.0,
) -> OfficialReferenceProbe:
    base = (base_url or RTC_LOCAL_BASE_URL).rstrip("/")
    url = f"{base}{RTC_VERSION_PATH}"
    owns_client = client is None
    http = client or httpx.Client(timeout=timeout_seconds)
    try:
        response = http.get(url)
        response.raise_for_status()
        payload = response.json()
        version, metadata = _normalize_rtc_version(payload)
        return OfficialReferenceProbe(
            source_key="rfb-rtc-calculator-local",
            source_url=url,
            source_version=version,
            content_sha256=_canonical_json_hash(payload),
            metadata=metadata,
        )
    except (httpx.HTTPError, ValueError) as exc:
        raise FiscalReferenceWatchError(
            f"Calculadora RTC local indisponível ou incompatível: {exc}"
        ) from exc
    finally:
        if owns_client:
            http.close()


def _differs_from_active(
    state: FiscalOfficialReferenceState,
    probe: OfficialReferenceProbe,
) -> bool:
    version_changed = bool(
        probe.source_version
        and state.active_version
        and probe.source_version != state.active_version
    )
    hash_changed = bool(
        probe.content_sha256
        and state.active_sha256
        and probe.content_sha256 != state.active_sha256
    )
    return version_changed or hash_changed


def record_probe(session: Session, probe: OfficialReferenceProbe) -> OfficialReferenceSyncResult:
    now = _utcnow()
    state = session.get(FiscalOfficialReferenceState, probe.source_key)

    if state is None:
        state = FiscalOfficialReferenceState(
            source_key=probe.source_key,
            source_url=probe.source_url,
            observed_version=probe.source_version,
            observed_sha256=probe.content_sha256,
            active_version=probe.source_version,
            active_sha256=probe.content_sha256,
            status="current",
            metadata_json=probe.metadata,
            checked_at=now,
            promoted_at=now,
        )
        session.add(state)
        changed = False
    else:
        state.source_url = probe.source_url
        state.observed_version = probe.source_version
        state.observed_sha256 = probe.content_sha256
        state.checked_at = now
        state.last_error = None
        state.metadata_json = probe.metadata

        changed = _differs_from_active(state, probe)
        if changed:
            state.status = "changed"
            if state.changed_at is None:
                state.changed_at = now
        else:
            state.status = "current"
            state.changed_at = None

    session.flush()
    return OfficialReferenceSyncResult(
        source_key=probe.source_key,
        status=state.status,
        changed=changed,
        observed_version=state.observed_version,
        observed_sha256=state.observed_sha256,
        active_version=state.active_version,
        active_sha256=state.active_sha256,
        metadata=probe.metadata,
    )


def record_probe_error(session: Session, source_key: str, source_url: str, error: Exception) -> None:
    now = _utcnow()
    state = session.get(FiscalOfficialReferenceState, source_key)
    if state is None:
        state = FiscalOfficialReferenceState(
            source_key=source_key,
            source_url=source_url,
            status="error",
            checked_at=now,
        )
        session.add(state)
    state.status = "error"
    state.checked_at = now
    state.last_error = str(error)[:2000]
    session.flush()


def promote_observed_reference(session: Session, source_key: str) -> None:
    state = session.get(FiscalOfficialReferenceState, source_key)
    if state is None:
        raise KeyError(source_key)
    if not state.observed_version and not state.observed_sha256:
        raise FiscalReferenceWatchError(
            f"Fonte {source_key} ainda não possui versão/hash observado para promoção."
        )
    state.active_version = state.observed_version
    state.active_sha256 = state.observed_sha256
    state.status = "current"
    state.changed_at = None
    state.promoted_at = _utcnow()
    state.last_error = None
    session.flush()


def stale_reference_keys(
    states: Iterable[FiscalOfficialReferenceState],
    *,
    now: datetime.datetime | None = None,
    max_age: datetime.timedelta = datetime.timedelta(days=2),
) -> tuple[str, ...]:
    current = now or _utcnow()
    result: list[str] = []
    for state in states:
        checked_at = state.checked_at
        if checked_at is None:
            result.append(state.source_key)
            continue
        if checked_at.tzinfo is None:
            checked_at = checked_at.replace(tzinfo=datetime.timezone.utc)
        if current - checked_at > max_age:
            result.append(state.source_key)
    return tuple(sorted(result))
