import io
import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient
from app.main import app
from app.database import engine, Base, SessionLocal, current_restaurante_id
from app.routes.auth import create_access_token
from app.models import Restaurante, Usuario

client = TestClient(app)

# Dummy 1x1 valid PNG image bytes
VALID_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?"
    b"\x03\x00\x05\x00\x01\x0d\x0a-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


@pytest.fixture(autouse=True)
def test_setup():
    from app.config import settings
    settings.SUPABASE_URL = "https://iiowhekvahxiepwcdidm.supabase.co"
    settings.SUPABASE_SERVICE_ROLE_KEY = "test_service_role_key_12345"
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    token_var = current_restaurante_id.set(999)
    try:
        # Create test restaurant 999
        rest = db.query(Restaurante).filter(Restaurante.id == 999).first()
        if not rest:
            rest = Restaurante(id=999, nome="Restaurante Teste 999", plano="bistro")
            db.add(rest)
            db.commit()

        # Create test user for tenant 999
        user = db.query(Usuario).filter(Usuario.email == "test999@koma.com").first()
        if not user:
            user = Usuario(
                nome="Gerente Teste 999",
                email="test999@koma.com",
                cargo="admin",
                role="admin",
                status="ativo",
                restaurante_id=999
            )
            db.add(user)
        else:
            user.role = "admin"
            user.cargo = "admin"
            user.status = "ativo"
        db.commit()

        auth_token = create_access_token(subject=user.id, restaurante_id=999, role="admin")
        yield {"user": user, "token": auth_token, "rest_id": 999}
    finally:
        current_restaurante_id.set(None)
        db.close()


def test_upload_asset_unauthenticated():
    response = client.post("/api/cardapio-digital/assets/logo", files={"file": ("logo.png", VALID_PNG_BYTES, "image/png")})
    assert response.status_code == 401


def test_upload_asset_invalid_mime(test_setup):
    headers = {"Authorization": f"Bearer {test_setup['token']}"}
    response = client.post(
        "/api/cardapio-digital/assets/logo",
        headers=headers,
        files={"file": ("script.sh", b"#!/bin/bash\necho hack", "text/plain")}
    )
    assert response.status_code == 400
    assert "Formato de arquivo inválido" in response.json()["detail"]


def test_upload_asset_exceeds_max_size(test_setup):
    headers = {"Authorization": f"Bearer {test_setup['token']}"}
    large_content = b"\x89PNG\r\n\x1a\n" + (b"0" * (5 * 1024 * 1024 + 10))
    response = client.post(
        "/api/cardapio-digital/assets/logo",
        headers=headers,
        files={"file": ("large.png", large_content, "image/png")}
    )
    assert response.status_code == 400
    assert "excede o limite máximo" in response.json()["detail"]


@patch("httpx.AsyncClient.post")
def test_upload_logo_success(mock_post, test_setup):
    mock_res = AsyncMock()
    mock_res.status_code = 200
    mock_post.return_value = mock_res

    headers = {"Authorization": f"Bearer {test_setup['token']}"}
    response = client.post(
        "/api/cardapio-digital/assets/logo",
        headers=headers,
        files={"file": ("logo.png", VALID_PNG_BYTES, "image/png")}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == 999
    assert "cardapio-assets/999/logo/" in data["logo_url"]


@patch("httpx.AsyncClient.post")
def test_upload_banner_success(mock_post, test_setup):
    mock_res = AsyncMock()
    mock_res.status_code = 200
    mock_post.return_value = mock_res

    headers = {"Authorization": f"Bearer {test_setup['token']}"}
    response = client.post(
        "/api/cardapio-digital/assets/banner",
        headers=headers,
        files={"file": ("banner.png", VALID_PNG_BYTES, "image/png")}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == 999
    assert "cardapio-assets/999/banner/" in data["banner_url"]


@patch("httpx.AsyncClient.request")
def test_delete_logo_success(mock_delete, test_setup):
    mock_res = AsyncMock()
    mock_res.status_code = 200
    mock_delete.return_value = mock_res

    headers = {"Authorization": f"Bearer {test_setup['token']}"}
    response = client.delete("/api/cardapio-digital/assets/logo", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["logo_url"] is None


@patch("httpx.AsyncClient.request")
def test_delete_banner_success(mock_delete, test_setup):
    mock_res = AsyncMock()
    mock_res.status_code = 200
    mock_delete.return_value = mock_res

    headers = {"Authorization": f"Bearer {test_setup['token']}"}
    response = client.delete("/api/cardapio-digital/assets/banner", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["banner_url"] is None
