import os
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.config import settings
from app.routes.super_admin_services import (
    SupabaseService,
    CloudflareService,
    RailwayService,
    TelegramService,
    is_mock_allowed
)

client = TestClient(app)

def test_backend_initializes_successfully_in_test_environment():
    """Comprova que o backend inicializa normalmente em ENVIRONMENT=test."""
    assert os.getenv("ENVIRONMENT") == "test"
    assert app is not None

def test_no_hardcoded_sentry_dsn_default():
    """Comprova que SENTRY_DSN não possui DSN de produção hardcoded no config."""
    assert not settings.SENTRY_DSN or "ingest.us.sentry.io" not in settings.SENTRY_DSN

def test_credentials_store_does_not_exist_in_super_admin():
    """Comprova que credentialsStore de segredos não existe mais no módulo super_admin."""
    import app.routes.super_admin as sa_module
    assert not hasattr(sa_module, "credentialsStore")

def test_superadmin_fails_safely_when_env_vars_missing():
    """Comprova que o SuperAdmin falha de forma segura quando SUPERADMIN_USERNAME não está configurado."""
    from app.routes.super_admin import login_for_access_token, TokenRequest
    
    old_user = os.environ.pop("SUPERADMIN_USERNAME", None)
    old_hash = os.environ.pop("SUPERADMIN_PASSWORD_HASH", None)
    try:
        with pytest.raises(Exception):
            login_for_access_token(TokenRequest(username="admin", password="123"))
    finally:
        if old_user:
            os.environ["SUPERADMIN_USERNAME"] = old_user
        if old_hash:
            os.environ["SUPERADMIN_PASSWORD_HASH"] = old_hash

@pytest.mark.parametrize("env_val,allowed", [
    (None, False),
    ("", False),
    ("   ", False),
    ("production", False),
    ("prod", False),
    ("staging", False),
    ("unknown", False),
    ("development", True),
    ("DEVELOPMENT", True),
    ("test", True),
    ("TEST", True),
])
def test_is_mock_allowed_fail_closed(env_val, allowed):
    """Comprova que is_mock_allowed é estrito (fail-closed) para qualquer ambiente diferente de dev ou test."""
    old_env = os.environ.get("ENVIRONMENT")
    try:
        if env_val is None:
            os.environ.pop("ENVIRONMENT", None)
        else:
            os.environ["ENVIRONMENT"] = env_val
        assert is_mock_allowed() == allowed
    finally:
        if old_env is not None:
            os.environ["ENVIRONMENT"] = old_env
        else:
            os.environ.pop("ENVIRONMENT", None)

@pytest.mark.anyio
async def test_external_services_do_not_simulate_success_in_production():
    """Comprova que serviços externos lançam exceção de configuração em ENVIRONMENT=production se não configurados."""
    old_env = os.environ.get("ENVIRONMENT")
    os.environ["ENVIRONMENT"] = "production"
    try:
        supabase = SupabaseService(db_url="", service_role_key="")
        with pytest.raises(RuntimeError, match="SupabaseService: SUPABASE_DB_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados em produção"):
            await supabase.create_tenant_schema("test-slug", "Bistro")

        cloudflare = CloudflareService(api_token="", zone_id="")
        with pytest.raises(RuntimeError, match="CloudflareService: CLOUDFLARE_API_TOKEN ou CLOUDFLARE_ZONE_ID não configurados em produção"):
            await cloudflare.create_cname_record("sub.koma.com")

        railway = RailwayService(api_token="", project_id="")
        with pytest.raises(RuntimeError, match="RailwayService: RAILWAY_API_TOKEN ou RAILWAY_PROJECT_ID não configurados em produção"):
            await railway.get_service_metrics()

        telegram = TelegramService(bot_token="", chat_id="")
        with pytest.raises(RuntimeError, match="TelegramService: TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não configurados em produção"):
            await telegram.send_alert("Teste")
    finally:
        if old_env:
            os.environ["ENVIRONMENT"] = old_env

def test_credentials_endpoint_returns_only_non_sensitive_booleans():
    """Comprova que GET /api/super-admin/credentials retorna apenas booleans de configuração de metadados."""
    from app.security import create_access_token
    token = create_access_token(subject="admin", restaurante_id=0, role="superadmin")
    headers = {"Authorization": f"Bearer {token}"}
    
    response = client.get("/api/super-admin/credentials", headers=headers)
    assert response.status_code == 200
    data = response.json()

    expected_keys = {"sentry", "cloudflare", "railway", "github", "telegram", "supabase"}
    assert set(data.keys()) == expected_keys

    for svc_key, val in data.items():
        assert isinstance(val, dict)
        assert "configured" in val
        assert isinstance(val["configured"], bool)
        assert len(val) == 1

def test_update_credentials_endpoint_returns_501_and_does_not_modify_environ():
    """Comprova que POST /api/super-admin/credentials retorna HTTP 501 e não altera os.environ."""
    from app.security import create_access_token
    token = create_access_token(subject="admin", restaurante_id=0, role="superadmin")
    headers = {"Authorization": f"Bearer {token}"}
    
    test_key = "UNSAFE_TEST_CREDENTIAL_KEY"
    os.environ.pop(test_key, None)
    
    response = client.post(
        "/api/super-admin/credentials",
        json={"UNSAFE_TEST_CREDENTIAL_KEY": "secret_value_123"},
        headers=headers
    )
    
    assert response.status_code == 501
    assert response.json()["detail"] == "Armazenamento seguro de credenciais não configurado."
    assert test_key not in os.environ
