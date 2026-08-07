"""
Suíte de Testes Automatizados para CORS Estrito e Headers HTTP de Segurança.
Valida isolamento de origens, resposta 500 real sem exceções não capturadas pelo cliente,
normalização estrita de portas via urlsplit, CSP com portas do agente de impressão e Supabase WSS,
e códigos de fechamento 1008 para WebSockets.
"""
import os
import jwt
import pytest
from fastapi.testclient import TestClient
from fastapi.websockets import WebSocketDisconnect
from app.main import app
from app.config import settings, normalize_cors_origin

client = TestClient(app)
error_client = TestClient(app, raise_server_exceptions=False)

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
    """Erro 500 real da aplicação usando cliente com raise_server_exceptions=False."""
    # 1. Com Origem Maliciosa -> Retorna EXATAMENTE 500 sem CORS
    resp_malicious = error_client.get("/api/test-trigger-500-controlled", headers={"Origin": MALICIOUS_ORIGIN})
    assert resp_malicious.status_code == 500
    assert "access-control-allow-origin" not in resp_malicious.headers
    assert resp_malicious.headers.get("x-content-type-options") == "nosniff"
    assert resp_malicious.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
    assert "camera=()" in resp_malicious.headers.get("permissions-policy", "")
    assert resp_malicious.headers.get("x-frame-options") == "DENY"

    # 2. Com Origem Oficial -> Retorna EXATAMENTE 500 com CORS oficial
    resp_official = error_client.get("/api/test-trigger-500-controlled", headers={"Origin": OFFICIAL_ORIGIN})
    assert resp_official.status_code == 500
    assert resp_official.headers.get("access-control-allow-origin") == OFFICIAL_ORIGIN
    assert resp_official.headers.get("x-content-type-options") == "nosniff"
    assert resp_official.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
    assert "camera=()" in resp_official.headers.get("permissions-policy", "")
    assert resp_official.headers.get("x-frame-options") == "DENY"


def test_strict_origin_normalization_urlsplit():
    """Valida rejeição estrita via urllib.parse.urlsplit para origens malformadas e portas inválidas."""
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
        "https://example.com:abc",
        "https://example.com:0",
        "https://example.com:65536",
        "https://example.com:99999",
    ]
    for orig in invalid_origins:
        with pytest.raises(RuntimeError):
            normalize_cors_origin(orig)

    # Normalização de portas padrão (443 para https, 80 para http)
    assert normalize_cors_origin("https://example.com:443") == "https://example.com"
    assert normalize_cors_origin("http://example.com:80") == "http://example.com"

    # Preservação de portas não padrão válidas
    assert normalize_cors_origin("https://example.com:8443") == "https://example.com:8443"
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


def test_csp_strict_assertions_and_print_agent():
    """Valida o conteúdo estrito do arquivo public/_headers (CSP, agente de impressão e Supabase WSS)."""
    headers_file = os.path.join(os.path.dirname(__file__), "..", "..", "public", "_headers")
    assert os.path.exists(headers_file)
    with open(headers_file, "r", encoding="utf-8") as f:
        content = f.read()

    assert "script-src 'self';" in content
    assert "'unsafe-inline'" not in content.split("script-src")[1].split(";")[0]
    assert "img-src 'self' data: blob: https://iiowhekvahxiepwcdidm.supabase.co;" in content
    assert "https://*.supabase.co" not in content
    assert "wss://*.railway.app" not in content
    assert "wss://*.supabase.co" not in content

    # Supabase Realtime WSS exato
    assert "wss://iiowhekvahxiepwcdidm.supabase.co" in content

    # Validação das portas exatas do agente de impressão 17654-17664
    connect_src = content.split("connect-src")[1].split(";")[0]
    for port in range(17654, 17665):
        assert f"http://127.0.0.1:{port}" in connect_src

    # Portas fora do intervalo NÃO estão autorizadas
    assert "http://127.0.0.1:17653" not in connect_src
    assert "http://127.0.0.1:17665" not in connect_src

    # Ausência de wildcards de portas
    assert "127.0.0.1:*" not in connect_src
    assert "localhost:*" not in connect_src


def test_websocket_origin_policy(monkeypatch):
    """Testa a política de origens para conexões WebSocket exigindo código de encerramento 1008."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "CORS_ALLOWED_ORIGINS", OFFICIAL_ORIGIN)

    # 1. Origem oficial permitida
    with client.websocket_connect("/ws/cliente?restaurante_id=1", headers={"Origin": OFFICIAL_ORIGIN}) as ws:
        assert ws is not None

    # 2. Origem maliciosa encerrada com status 1008
    with pytest.raises(WebSocketDisconnect) as exc_info_malicious:
        with client.websocket_connect("/ws/cliente?restaurante_id=1", headers={"Origin": MALICIOUS_ORIGIN}) as ws:
            pass
    assert exc_info_malicious.value.code == 1008

    # 3. Origem .pages.dev de terceiro encerrada com status 1008
    with pytest.raises(WebSocketDisconnect) as exc_info_hacker:
        with client.websocket_connect("/ws/cliente?restaurante_id=1", headers={"Origin": PAGES_DEV_HACKER}) as ws:
            pass
    assert exc_info_hacker.value.code == 1008

    # 4. Origem malformada encerrada com status 1008
    with pytest.raises(WebSocketDisconnect) as exc_info_malformed:
        with client.websocket_connect("/ws/cliente?restaurante_id=1", headers={"Origin": "https://example.com/path"}) as ws:
            pass
    assert exc_info_malformed.value.code == 1008

    # 5. Origem ausente em produção encerrada com status 1008
    monkeypatch.setattr(settings, "WEBSOCKET_ALLOW_MISSING_ORIGIN", False)
    with pytest.raises(WebSocketDisconnect) as exc_info_missing:
        with client.websocket_connect("/ws/cliente?restaurante_id=1") as ws:
            pass
    assert exc_info_missing.value.code == 1008

    # 6. Origem ausente em ambiente de teste permitida
    monkeypatch.setenv("ENVIRONMENT", "test")
    with client.websocket_connect("/ws/cliente?restaurante_id=1") as ws_test:
        assert ws_test is not None
