from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any

import httpx


IBGE_LOCALITIES_BASE_URL = "https://servicodados.ibge.gov.br/api/v1/localidades"
_IBGE_TIMEOUT_SECONDS = 5.0
_CACHE_TTL_SECONDS = 6 * 60 * 60
_cache_lock = threading.Lock()
_cache: dict[str, tuple[float, object]] = {}


class OfficialLocationSourceUnavailable(RuntimeError):
    pass


class OfficialLocationMismatch(ValueError):
    pass


@dataclass(frozen=True)
class IbgeMunicipality:
    code: str
    name: str
    uf: str
    source: str = "ibge-localidades"


def _cached(key: str) -> object | None:
    now = time.monotonic()
    with _cache_lock:
        item = _cache.get(key)
        if item is None:
            return None
        expires_at, value = item
        if expires_at <= now:
            return None
        return value


def _get_stale_cache(key: str) -> object | None:
    with _cache_lock:
        item = _cache.get(key)
        return item[1] if item is not None else None


def _get_ceara_fallback_tuple() -> tuple[IbgeMunicipality, ...]:
    from .ceara_municipalities_fallback import CEARA_MUNICIPALITIES_DATA
    return tuple(
        IbgeMunicipality(code=c, name=n, uf=u)
        for c, n, u in CEARA_MUNICIPALITIES_DATA
    )


def _store_cache(key: str, value: object) -> None:
    with _cache_lock:
        _cache[key] = (time.monotonic() + _CACHE_TTL_SECONDS, value)


def _request_json(path: str) -> Any:
    try:
        response = httpx.get(
            f"{IBGE_LOCALITIES_BASE_URL}{path}",
            timeout=_IBGE_TIMEOUT_SECONDS,
            headers={"Accept": "application/json", "User-Agent": "KOMA-Fiscal/1.0"},
        )
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise OfficialLocationSourceUnavailable(
            "Não foi possível validar o município na fonte oficial do IBGE. Tente novamente."
        ) from exc


def _find_uf_sigla(value: object) -> str | None:
    if isinstance(value, dict):
        uf = value.get("UF")
        if isinstance(uf, dict):
            sigla = str(uf.get("sigla") or "").strip().upper()
            if len(sigla) == 2:
                return sigla
        for nested in value.values():
            found = _find_uf_sigla(nested)
            if found:
                return found
    elif isinstance(value, list):
        for nested in value:
            found = _find_uf_sigla(nested)
            if found:
                return found
    return None


def parse_ibge_municipality(payload: object) -> IbgeMunicipality:
    if not isinstance(payload, dict):
        raise OfficialLocationMismatch("Resposta de município do IBGE inválida.")
    code = str(payload.get("id") or "").strip()
    name = str(payload.get("nome") or "").strip()
    uf = _find_uf_sigla(payload)
    if len(code) != 7 or not code.isdigit() or not name or not uf:
        raise OfficialLocationMismatch("Resposta de município do IBGE incompleta.")
    return IbgeMunicipality(code=code, name=name, uf=uf)


def get_ibge_municipality(code: str) -> IbgeMunicipality:
    key = f"municipality:{code}"
    cached = _cached(key)
    if isinstance(cached, IbgeMunicipality):
        return cached
    try:
        municipality = parse_ibge_municipality(_request_json(f"/municipios/{code}"))
        _store_cache(key, municipality)
        return municipality
    except Exception as exc:
        stale = _get_stale_cache(key)
        if isinstance(stale, IbgeMunicipality):
            return stale
        fallback_tuple = _get_ceara_fallback_tuple()
        fallback_match = next((m for m in fallback_tuple if m.code == code), None)
        if fallback_match is not None:
            return fallback_match
        raise


def list_ibge_municipalities_for_uf(uf_code: str = "23") -> tuple[IbgeMunicipality, ...]:
    key = f"municipalities:uf:{uf_code}"
    cached = _cached(key)
    if isinstance(cached, tuple):
        return cached

    try:
        payload = _request_json(f"/estados/{uf_code}/municipios?orderBy=nome")
        if not isinstance(payload, list):
            raise OfficialLocationMismatch("Lista de municípios do IBGE inválida.")
        municipalities = tuple(parse_ibge_municipality(item) for item in payload)
        if not municipalities:
            raise OfficialLocationMismatch("IBGE retornou lista de municípios vazia.")
        _store_cache(key, municipalities)
        return municipalities
    except Exception as exc:
        stale = _get_stale_cache(key)
        if isinstance(stale, tuple) and stale:
            return stale
        if str(uf_code).strip() in ("23", "CE"):
            fallback_ceara = _get_ceara_fallback_tuple()
            _store_cache(key, fallback_ceara)
            return fallback_ceara
        raise
