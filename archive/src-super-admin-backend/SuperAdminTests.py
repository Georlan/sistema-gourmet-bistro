import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient

# Import our FastAPI app and DI services
from SuperAdminMain import app, get_supabase_service, get_cloudflare_service, get_telegram_service
from SuperAdminServices import SupabaseService, CloudflareService, TelegramService

# Set up test client
client = TestClient(app)

# Helper token header to satisfy JWT verification dependency
AUTH_HEADERS = {"Authorization": "Bearer mock_test_token"}

def test_admin_authentication_archived():
    """
    Validates that archived backend endpoint returns 410 Gone.
    """
    payload = {
        "username": "admin",
        "password": "password"
    }
    response = client.post("/api/super-admin/token", json=payload)
    assert response.status_code == 410
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


def test_admin_authentication_unauthorized():
    """
    Validates that random logins are blocked with a 401 code.
    """
    payload = {
        "username": "malicious@attacker.com",
        "password": "wrongpassword"
    }
    response = client.post("/api/super-admin/token", json=payload)
    assert response.status_code == 401
    assert response.json()["detail"] == "Incorrect username or password"


def test_unauthorized_endpoints():
    """
    Asserts that all metrics, onboarding, and DNS controls require Bearer validation.
    """
    response = client.get("/api/super-admin/restaurantes")
    assert response.status_code == 401
    assert response.json()["detail"] == "Valid authorization bearer token required."


# Mock services for testing the multi-stage pipelines without sending real network payloads
@pytest.fixture
def mock_onboarding_services():
    mock_supabase = MagicMock(spec=SupabaseService)
    mock_supabase.create_tenant_schema = AsyncMock(return_value={
        "status": "PROVISIONED",
        "schema": "schema_test-pizza",
        "isolated_tables": ["products", "categories"]
    })

    mock_cloudflare = MagicMock(spec=CloudflareService)
    mock_cloudflare.create_cname_record = AsyncMock(return_value={
        "id": "cf_rec_test_123",
        "subdomain": "test-pizza.koma.com",
        "status": "ACTIVE"
    })

    mock_telegram = MagicMock(spec=TelegramService)
    mock_telegram.send_alert = AsyncMock(return_value=True)

    # Inject overrides into FastAPI dependencies
    app.dependency_overrides[get_supabase_service] = lambda: mock_supabase
    app.dependency_overrides[get_cloudflare_service] = lambda: mock_cloudflare
    app.dependency_overrides[get_telegram_service] = lambda: mock_telegram

    yield mock_supabase, mock_cloudflare, mock_telegram

    # Clear overrides after test finishes
    app.dependency_overrides.clear()


def test_one_click_onboarding_pipeline(mock_onboarding_services):
    """
    Verifies that onboarding a restaurant fires DDL, DNS subdomains, and notifies Telegram.
    """
    mock_supabase, mock_cloudflare, mock_telegram = mock_onboarding_services

    payload = {
        "name": "Test Pizza",
        "plan": "Delivery",
        "subdomain": "test-pizza.koma.com"
    }

    response = client.post("/api/super-admin/restaurantes/onboarding", json=payload, headers=AUTH_HEADERS)
    assert response.status_code == 200
    data = response.json()

    assert data["success"] is True
    assert data["tenant_slug"] == "test-pizza"
    
    # Assert calls are placed properly
    mock_supabase.create_tenant_schema.assert_called_once_with("test-pizza", "Delivery")
    mock_cloudflare.create_cname_record.assert_called_once_with("test-pizza.koma.com")
    mock_telegram.send_alert.assert_called_once()


def test_financial_block_toggle():
    """
    Asserts that blocking a restaurant due to overdue bills triggers Telegram notification.
    """
    mock_telegram = MagicMock(spec=TelegramService)
    mock_telegram.send_alert = AsyncMock(return_value=True)
    app.dependency_overrides[get_telegram_service] = lambda: mock_telegram

    payload = {"status": "SUSPENDED"}
    response = client.put("/api/super-admin/restaurantes/ten_01a/status", json=payload, headers=AUTH_HEADERS)
    
    assert response.status_code == 200
    assert response.json()["tenant_id"] == "ten_01a"
    assert response.json()["status"] == "SUSPENDED"

    # Verify alerting was triggered
    mock_telegram.send_alert.assert_called_once_with(
        "⚠️ <b>Alerta Financeiro:</b> Inquilino ID ten_01a foi <b>SUSPENSO</b> devido a inadimplência no pagamento Asaas."
    )
    app.dependency_overrides.clear()


def test_manual_webhook_resolver_bypass():
    """
    Asserts that the webhook error terminal forces confirmation and notifies developer.
    """
    mock_telegram = MagicMock(spec=TelegramService)
    mock_telegram.send_alert = AsyncMock(return_value=True)
    app.dependency_overrides[get_telegram_service] = lambda: mock_telegram

    response = client.post("/api/super-admin/webhooks/asaas/wh_err_9831/confirm", headers=AUTH_HEADERS)
    
    assert response.status_code == 200
    assert response.json()["status"] == "FORCE_CONFIRMED"
    assert response.json()["webhook_id"] == "wh_err_9831"

    # Verify alerting was triggered
    mock_telegram.send_alert.assert_called_once_with(
        "✅ <b>BYPASS EFETUADO:</b> Webhook wh_err_9831 verificado manualmente. Pagamento aprovado no caixa!"
    )
    app.dependency_overrides.clear()
