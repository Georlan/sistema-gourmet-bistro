"""
Suíte de Testes Automatizados para CORS Estrito e Headers HTTP de Segurança.
Valida o isolamento de origens, tratamento de exceções sem vazamento CORS,
segurança de preflight, comportamento por ambiente e ausência de wildcards/regex permissivas.
"""
import os
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.config import settings

client = TestClient(app)

OFFICIAL_ORIGIN = "https://sistema-gourmet-bistro.pages.dev"
MALICIOUS_ORIGIN = "https://evil.example"
PAGES_DEV_HACKER = "https://evil-hacker.pages.dev"
SUBDOMAIN_ATTACK = "https://sistema-gourmet-bistro.pages.dev.evil.example"
UNAUTHORIZED_SUBDOMAIN = "https://sub.sistema-gourmet-bistro.pages.dev"
DIFFERENT_PORT = "http://localhost:5174"
HTTP_SPOOF = "http://sistema-gourmet-bistro.pages.dev"


def test_cors_official_allowed_origin():
    """Origem oficial exata recebe Access-Control-Allow-Origin exato."""
    response = client.get("/health", headers={"Origin": OFFICIAL_ORIGIN})
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == OFFICIAL_ORIGIN


def test_cors_malicious_origin_blocked():
    """Origem maliciosa não recebe cabeçalho Access-Control-Allow-Origin."""
    response = client.get("/health", headers={"Origin": MALICIOUS_ORIGIN})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_cors_malicious_pages_dev_blocked():
    """Origem .pages.dev arbitrária não configurada é bloqueada (sem regex ampla)."""
    response = client.get("/health", headers={"Origin": PAGES_DEV_HACKER})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_cors_similar_domain_suffix_attack_blocked():
    """Tentativa de sufixo no domínio é bloqueada."""
    response = client.get("/health", headers={"Origin": SUBDOMAIN_ATTACK})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_cors_unauthorized_subdomain_blocked():
    """Subdomínio não explicitamente autorizado é bloqueado."""
    response = client.get("/health", headers={"Origin": UNAUTHORIZED_SUBDOMAIN})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_cors_different_port_blocked():
    """Origem em porta não autorizada é bloqueada."""
    response = client.get("/health", headers={"Origin": DIFFERENT_PORT})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_cors_http_scheme_spoof_blocked():
    """Esquema HTTP quando HTTPS é exigido é bloqueado."""
    response = client.get("/health", headers={"Origin": HTTP_SPOOF})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_cors_absence_of_origin_header():
    """Requisição normal sem Origin funciona e não injeta CORS desnecessário."""
    response = client.get("/health")
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_cors_valid_preflight():
    """Preflight OPTIONS de origem autorizada retorna status correto e cabeçalhos limitados."""
    response = client.options(
        "/api/auth/login",
        headers={
            "Origin": OFFICIAL_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Authorization, Content-Type",
        },
    )
    assert response.status_code in (200, 204)
    assert response.headers.get("access-control-allow-origin") == OFFICIAL_ORIGIN
    assert "POST" in response.headers.get("access-control-allow-methods", "")


def test_cors_malicious_preflight_rejected():
    """Preflight OPTIONS de origem maliciosa não recebe autorização CORS."""
    response = client.options(
        "/api/auth/login",
        headers={
            "Origin": MALICIOUS_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Authorization, Content-Type",
        },
    )
    assert "access-control-allow-origin" not in response.headers


def test_cors_error_404_with_malicious_origin():
    """Resposta 404 para origem maliciosa não inclui Access-Control-Allow-Origin."""
    response = client.get("/api/rota-inexistente-12345", headers={"Origin": MALICIOUS_ORIGIN})
    assert response.status_code == 404
    assert "access-control-allow-origin" not in response.headers


def test_cors_error_422_with_malicious_origin():
    """Resposta 422 para origem maliciosa não inclui Access-Control-Allow-Origin."""
    response = client.post("/api/auth/login", json={}, headers={"Origin": MALICIOUS_ORIGIN})
    assert response.status_code == 422
    assert "access-control-allow-origin" not in response.headers


def test_cors_error_500_with_malicious_origin(monkeypatch):
    """Resposta 500 para origem maliciosa não reflete o cabeçalho Origin."""
    # Garante que respostas 500 tratadas pelo exception handler não reflitam Origin malicioso
    response = client.get("/api/cardapio-digital/config?restaurante_id=invalido_trigger_500", headers={"Origin": MALICIOUS_ORIGIN})
    assert response.status_code in (400, 422, 500)
    assert "access-control-allow-origin" not in response.headers or response.headers.get("access-control-allow-origin") != MALICIOUS_ORIGIN


def test_cors_authorized_origin_on_error_response():
    """Origem autorizada recebe cabeçalhos CORS mesmo em resposta de erro (404/422)."""
    response = client.get("/api/rota-inexistente-12345", headers={"Origin": OFFICIAL_ORIGIN})
    assert response.status_code == 404
    assert response.headers.get("access-control-allow-origin") == OFFICIAL_ORIGIN


def test_cors_environment_behavior(monkeypatch):
    """Testa comportamento estrito por ambiente (dev vs produção)."""
    # Em modo produção sem CORS_ALLOWED_ORIGINS explícito, localhost não deve ser adicionado automaticamente
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "CORS_ALLOWED_ORIGINS", "")
    prod_origins = settings.get_cors_allowed_origins()
    assert "http://localhost:5173" not in prod_origins
    assert len(prod_origins) == 0

    # Em produção com origem explícita
    monkeypatch.setattr(settings, "CORS_ALLOWED_ORIGINS", "https://app.koma.com.br")
    prod_custom = settings.get_cors_allowed_origins()
    assert prod_custom == ["https://app.koma.com.br"]


def test_http_security_headers():
    """Valida presença dos cabeçalhos HTTP de segurança obrigatórios."""
    response = client.get("/health")
    assert response.headers.get("x-content-type-options") == "nosniff"
    assert response.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
    assert "camera=()" in response.headers.get("permissions-policy", "")
    assert response.headers.get("x-frame-options") in ("DENY", "SAMEORIGIN")


def test_hsts_header_in_production(monkeypatch):
    """Valida HSTS presente em requisições com HTTPS em produção."""
    response = client.get("/health", headers={"X-Forwarded-Proto": "https", "Host": "api.koma.com.br"})
    assert response.status_code == 200
    assert "max-age=31536000" in response.headers.get("strict-transport-security", "")


def test_no_wildcard_credentials():
    """Garante ausência de Access-Control-Allow-Origin: * com credenciais ativas."""
    response = client.get("/health", headers={"Origin": "*"})
    assert response.headers.get("access-control-allow-origin") != "*"
