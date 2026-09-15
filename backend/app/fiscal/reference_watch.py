from __future__ import annotations

import datetime
import hashlib
import json
import os
from dataclasses import dataclass
from typing import Any, Iterable

import httpx
from sqlalchemy.orm import Session

from ..fiscal_reference_models import FiscalOfficialReferenceState


NCM_JSON_URL = "https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json"
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
    source_version: str | None
    content_sha256: str | None
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
    """Aceita pequenas variações de envelope sem aceitar conteúdo não estruturado."""

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


def record_probe(session: Session, probe: OfficialReferenceProbe) -> OfficialReferenceSyncResult:
    now = _utcnow()
    state = session.get(FiscalOfficialReferenceState, probe.source_key)
    changed = False

    if state is None:
        state = FiscalOfficialReferenceState(
            source_key=probe.source_key,
            source_url=probe.source_url,
            source_version=probe.source_version,
            content_sha256=probe.content_sha256,
            status="current",
            metadata_json=probe.metadata,
            checked_at=now,
        )
        session.add(state)
    else:
        version_changed = bool(
            probe.source_version
            and state.source_version
            and probe.source_version != state.source_version
        )
        hash_changed = bool(
            probe.content_sha256
            and state.content_sha256
            and probe.content_sha256 != state.content_sha256
        )
        changed = version_changed or hash_changed
        state.source_url = probe.source_url
        state.checked_at = now
        state.last_error = None
        state.metadata_json = probe.metadata
        if changed:
            state.status = "changed"
            state.changed_at = now
        elif state.status != "changed":
            state.status = "current"

        # Guardar o observado mais recente sem tratá-lo como versão ativa de regra.
        state.source_version = probe.source_version
        state.content_sha256 = probe.content_sha256

    session.flush()
    return OfficialReferenceSyncResult(
        source_key=probe.source_key,
        status=state.status,
        changed=changed,
        source_version=probe.source_version,
        content_sha256=probe.content_sha256,
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


def acknowledge_reference_change(session: Session, source_key: str) -> None:
    state = session.get(FiscalOfficialReferenceState, source_key)
    if state is None:
        raise KeyError(source_key)
    state.status = "current"
    state.acknowledged_at = _utcnow()
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
