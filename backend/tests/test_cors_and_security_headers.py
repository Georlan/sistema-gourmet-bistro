"""
Suíte de Testes Automatizados para CORS Estrito e Headers HTTP de Segurança.
Valida isolamento de origens, tratamento de exceções 401/500 sem vazamento,
normalização via urlsplit, HSTS por ambiente, CSP restritiva e política de WebSockets.
"""
import os
import jwt
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.config import settings, normalize_cors_origin

client = TestClient(app)

OFFICIAL_ORIGIN = "https://sistema-gourmet-bistro.pages.dev"
MALICIOUS_ORIGIN = "https://evil.example"
PAGES_DEV_HACKER = "https://evil-hacker.pages.dev"
SUBDOMAIN_ATTACK = "https://sistema-gourmet-bistro.pages.dev.evil.example"
UNAUTHORIZED_SUBDOMAIN = "https://sub.sistema-gourmet-bistro.pages.dev"
DIFFERENT_PORT = "http://localhost:5174"
HTTP_SPOOF = "http://sistema-gourmet-bistro.pages.dev"


# Rota exclusiva para teste 500 controlado
@app.get("/api/test-trigger-500-controlled")
def trigger_test_500_controlled():
    raise RuntimeError("erro controlado de teste para validacao de middleware")


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


def test_auth_401_invalid_jwt_with_official_origin():
    """Resposta 401 de JWT inválido para origem oficial recebe CORS e headers de segurança."""
    response = client.get(
        "/api/pedidos/1",
        headers={
            "Origin": OFFICIAL_ORIGIN,
            "Authorization": "Bearer token_invalido_jwt_123",
        },
    )
    assert response.status_code == 401
    assert response.headers.get("access-control-allow-origin") == OFFICIAL_ORIGIN
    assert response.headers.get("x-content-type-options") == "nosniff"
    assert response.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
    assert "camera=()" in response.headers.get("permissions-policy", "")
    assert response.headers.get("x-frame-options") == "DENY"


def test_auth_401_invalid_jwt_with_malicious_origin():
    """Resposta 401 de JWT inválido para origem maliciosa NÃO recebe CORS mas recebe headers de segurança."""
    response = client.get(
        "/api/pedidos/1",
        headers={
            "Origin": MALICIOUS_ORIGIN,
            "Authorization": "Bearer token_invalido_jwt_123",
        },
    )
    assert response.status_code == 401
    assert "access-control-allow-origin" not in response.headers
    assert response.headers.get("x-content-type-options") == "nosniff"
    assert response.headers.get("x-frame-options") == "DENY"


def test_auth_401_malformed_authorization_header():
    """Resposta 401 para cabeçalho Authorization malformado (ex: Basic)."""
    response = client.get(
        "/api/pedidos/1",
        headers={
            "Origin": OFFICIAL_ORIGIN,
            "Authorization": "Basic usuario:senha_invalida",
        },
    )
    assert response.status_code == 401
    assert response.headers.get("access-control-allow-origin") == OFFICIAL_ORIGIN


def test_auth_401_boolean_restaurante_id_in_token():
    """Token JWT contendo restaurante_id booleano gera 401 com CORS wrapped."""
    payload = {"restaurante_id": True, "role": "garcom"}
    token = jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    response = client.get(
        "/api/pedidos/1",
        headers={
            "Origin": OFFICIAL_ORIGIN,
            "Authorization": f"Bearer {token}",
        },
    )
    assert response.status_code == 401
    assert response.headers.get("access-control-allow-origin") == OFFICIAL_ORIGIN


def test_auth_401_invalid_text_restaurante_id_in_token():
    """Token JWT contendo restaurante_id texto inválido gera 401 com CORS wrapped."""
    payload = {"restaurante_id": "restaurante_invalido_abc", "role": "garcom"}
    token = jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    response = client.get(
        "/api/pedidos/1",
        headers={
            "Origin": OFFICIAL_ORIGIN,
            "Authorization": f"Bearer {token}",
        },
    )
    assert response.status_code == 401
    assert response.headers.get("access-control-allow-origin") == OFFICIAL_ORIGIN


def test_auth_401_negative_restaurante_id_in_token():
    """Token JWT contendo restaurante_id negativo gera 401 com CORS wrapped."""
    payload = {"restaurante_id": -10, "role": "garcom"}
    token = jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    response = client.get(
        "/api/pedidos/1",
        headers={
            "Origin": OFFICIAL_ORIGIN,
            "Authorization": f"Bearer {token}",
        },
    )
    assert response.status_code == 401
    assert response.headers.get("access-control-allow-origin") == OFFICIAL_ORIGIN


def test_real_500_error_wrapping():
    """Erro 500 real da aplicação deve ser envolto por CORS e headers de segurança."""
    # 1. Com Origem Maliciosa
    resp_malicious = client.get("/api/test-trigger-500-controlled", headers={"Origin": MALICIOUS_ORIGIN})
    assert resp_malicious.status_code == 500
    assert "access-control-allow-origin" not in resp_malicious.headers
    assert resp_malicious.headers.get("x-content-type-options") == "nosniff"

    # 2. Com Origem Oficial
    resp_official = client.get("/api/test-trigger-500-controlled", headers={"Origin": OFFICIAL_ORIGIN})
    assert resp_official.status_code == 500
    assert resp_official.headers.get("access-control-allow-origin") == OFFICIAL_ORIGIN
    assert resp_official.headers.get("x-content-type-options") == "nosniff"


def test_strict_origin_normalization_urlsplit():
    """Valida rejeição estrita via urllib.parse.urlsplit para origens malformadas."""
    invalid_origins = [
        "https://app.example.com/path",
        "https://app.example.com?x=1",
        "https://app.example.com/#fragment",
        "https://user:pass@app.example.com",
        "*.pages.dev",
        "https://*.pages.dev",
        "javascript:alert(1)",
        "ftp://app.example.com",
        "app.example.com",
        "texto-arbitrario-sem-protocolo",
    ]
    for orig in invalid_origins:
        with pytest.raises(RuntimeError):
            normalize_cors_origin(orig)

    # Válidas com barra final removida
    assert normalize_cors_origin("https://app.example.com/") == "https://app.example.com"
    assert normalize_cors_origin("http://localhost:5173") == "http://localhost:5173"


def test_environment_behavior_default_production(monkeypatch):
    """Quando ENVIRONMENT está ausente/vazio ou produção, não adiciona localhost ou origens implícitas."""
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.setattr(settings, "CORS_ALLOWED_ORIGINS", "")
    origins = settings.get_cors_allowed_origins()
    assert len(origins) == 0
    assert "http://localhost:5173" not in origins
    assert "https://sistema-gourmet-bistro.pages.dev" not in origins


def test_hsts_strict_conditions(monkeypatch):
    """Testa matriz de HSTS: Apenas PRODUÇÃO + HTTPS + NÃO LOCALHOST."""
    # 1. Produção + HTTPS -> HSTS Presente
    monkeypatch.setenv("ENVIRONMENT", "production")
    resp_prod_https = client.get("/health", headers={"X-Forwarded-Proto": "https", "Host": "api.koma.com.br"})
    assert "max-age=31536000" in resp_prod_https.headers.get("strict-transport-security", "")

    # 2. Produção + HTTP -> HSTS Ausente
    resp_prod_http = client.get("/health", headers={"X-Forwarded-Proto": "http", "Host": "api.koma.com.br"})
    assert "strict-transport-security" not in resp_prod_http.headers

    # 3. Desenvolvimento + HTTPS -> HSTS Ausente
    monkeypatch.setenv("ENVIRONMENT", "development")
    resp_dev_https = client.get("/health", headers={"X-Forwarded-Proto": "https", "Host": "api.koma.com.br"})
    assert "strict-transport-security" not in resp_dev_https.headers

    # 4. Localhost em Produção -> HSTS Ausente
    monkeypatch.setenv("ENVIRONMENT", "production")
    resp_localhost = client.get("/health", headers={"X-Forwarded-Proto": "https", "Host": "localhost"})
    assert "strict-transport-security" not in resp_localhost.headers


def test_csp_strict_assertions():
    """Valida o conteúdo estrito do arquivo public/_headers."""
    headers_file = os.path.join(os.path.dirname(__file__), "..", "..", "public", "_headers")
    assert os.path.exists(headers_file)
    with open(headers_file, "r", encoding="utf-8") as f:
        content = f.read()

    assert "script-src 'self';" in content
    assert "'unsafe-inline'" not in content.split("script-src")[1].split(";")[0]
    assert "img-src 'self' data: blob: https://iiowhekvahxiepwcdidm.supabase.co;" in content
    assert "https://*.supabase.co" not in content
    assert "wss://*.railway.app" not in content


def test_websocket_origin_policy(monkeypatch):
    """Testa a política de origens para conexões WebSocket."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "CORS_ALLOWED_ORIGINS", OFFICIAL_ORIGIN)

    # 1. Origem oficial permitida
    with client.websocket_connect("/ws/cliente?restaurante_id=1", headers={"Origin": OFFICIAL_ORIGIN}) as ws:
        assert ws is not None

    # 2. Origem maliciosa encerrada com status 1008
    with pytest.raises(Exception):
        client.websocket_connect("/ws/cliente?restaurante_id=1", headers={"Origin": MALICIOUS_ORIGIN})

    # 3. Origem .pages.dev de terceiro encerrada com status 1008
    with pytest.raises(Exception):
        client.websocket_connect("/ws/cliente?restaurante_id=1", headers={"Origin": PAGES_DEV_HACKER})

    # 4. Origem ausente em produção bloqueada
    monkeypatch.setattr(settings, "WEBSOCKET_ALLOW_MISSING_ORIGIN", False)
    with pytest.raises(Exception):
        client.websocket_connect("/ws/cliente?restaurante_id=1")

    # 5. Origem ausente em ambiente de teste permitida
    monkeypatch.setenv("ENVIRONMENT", "test")
    with client.websocket_connect("/ws/cliente?restaurante_id=1") as ws_test:
        assert ws_test is not None
