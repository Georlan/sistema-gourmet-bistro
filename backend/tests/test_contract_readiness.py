from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.legal_config import LEGAL_SOURCE_BLOB_SHA, LEGAL_SOURCE_COMMIT, LEGAL_VERSION
from app.routes.contract_readiness import router


LEGAL_ENV_VARS = (
    "KOMA_LEGAL_PROVIDER_NAME",
    "KOMA_LEGAL_PROVIDER_TAX_ID",
    "KOMA_LEGAL_PROVIDER_ADDRESS",
    "KOMA_LEGAL_PROVIDER_LOCATION",
)


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_contract_readiness_fails_closed_without_provider_identity(monkeypatch):
    for name in LEGAL_ENV_VARS:
        monkeypatch.delenv(name, raising=False)

    with _client() as client:
        response = client.get("/api/contracts/readiness")

    assert response.status_code == 200
    assert response.json() == {
        "ready": False,
        "providerIdentityConfigured": False,
        "legalVersion": LEGAL_VERSION,
        "legalSourceCommit": LEGAL_SOURCE_COMMIT,
        "legalSourceBlobSha": LEGAL_SOURCE_BLOB_SHA,
    }


def test_contract_readiness_exposes_no_sensitive_provider_data(monkeypatch):
    test_tax_id = "52998224725"
    test_address = "Endereço jurídico de teste, 100"
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_NAME", "Prestador de Teste")
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_TAX_ID", test_tax_id)
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_ADDRESS", test_address)
    monkeypatch.setenv("KOMA_LEGAL_PROVIDER_LOCATION", "Limoeiro do Norte/CE")

    with _client() as client:
        response = client.get("/api/contracts/readiness")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ready"] is True
    assert payload["providerIdentityConfigured"] is True
    assert payload["legalVersion"] == LEGAL_VERSION
    assert test_tax_id not in response.text
    assert test_address not in response.text
    assert "Prestador de Teste" not in response.text


def test_contract_readiness_router_is_composed_into_runtime():
    composition = Path("backend/app/routes/__init__.py").read_text(encoding="utf-8")
    assert "from .contract_readiness import router as _contract_readiness_router" in composition
    assert "_root_router.router.include_router(_contract_readiness_router)" in composition
