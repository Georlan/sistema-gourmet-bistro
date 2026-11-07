"""Testes de resiliência e fallback para a fonte oficial do IBGE."""

from __future__ import annotations

from unittest.mock import patch
import httpx
import pytest

from app.fiscal.ibge import (
    OfficialLocationSourceUnavailable,
    get_ibge_municipality,
    list_ibge_municipalities_for_uf,
    _cache,
)


@pytest.fixture(autouse=True)
def clear_ibge_cache():
    _cache.clear()
    yield
    _cache.clear()


def test_ibge_fallback_when_external_api_times_out():
    """Quando o IBGE falhar por timeout ou 503, o fallback resiliente entrega os 184 municípios do CE."""
    with patch("httpx.get", side_effect=httpx.ConnectTimeout("IBGE connection timeout")):
        municipalities = list_ibge_municipalities_for_uf("23")
        assert len(municipalities) == 184
        fortaleza = next((m for m in municipalities if m.code == "2304400"), None)
        assert fortaleza is not None
        assert fortaleza.name == "Fortaleza"
        assert fortaleza.uf == "CE"


def test_ibge_single_municipality_fallback_when_external_api_fails():
    """Busca de município individual retorna dados canônicos empacotados se o IBGE estiver fora."""
    with patch("httpx.get", side_effect=httpx.HTTPStatusError("503 Service Unavailable", request=None, response=httpx.Response(503))):
        mun = get_ibge_municipality("2304400")
        assert mun.code == "2304400"
        assert mun.name == "Fortaleza"
        assert mun.uf == "CE"


def test_ibge_returns_stale_cache_on_refresh_failure():
    """Quando o cache expira e o IBGE falha ao revalidar, os dados em cache são preservados."""
    with patch("httpx.get", side_effect=httpx.ConnectTimeout("IBGE down")):
        first_call = list_ibge_municipalities_for_uf("23")
        # Simula expiração temporal do cache
        key = "municipalities:uf:23"
        _cache[key] = (0.0, first_call)
        second_call = list_ibge_municipalities_for_uf("23")
        assert len(second_call) == 184
