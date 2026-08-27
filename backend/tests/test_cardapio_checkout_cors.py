from fastapi.testclient import TestClient

from app.main import app


OFFICIAL_ORIGIN = "https://sistema-gourmet-bistro.pages.dev"
client = TestClient(app)


def _preflight(request_headers: str):
    return client.options(
        "/cardapio/pedidos",
        headers={
            "Origin": OFFICIAL_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": request_headers,
        },
    )


def test_checkout_publico_preflight_aceita_json_sem_header_idempotente_customizado():
    response = _preflight("content-type")

    assert response.status_code in (200, 204), response.text
    assert response.headers.get("access-control-allow-origin") == OFFICIAL_ORIGIN
    assert "POST" in response.headers.get("access-control-allow-methods", "")
    assert "content-type" in response.headers.get("access-control-allow-headers", "").lower()


def test_checkout_identificado_preflight_aceita_token_do_cliente():
    response = _preflight("content-type,x-koma-customer-token")

    assert response.status_code in (200, 204), response.text
    assert response.headers.get("access-control-allow-origin") == OFFICIAL_ORIGIN
    allowed_headers = response.headers.get("access-control-allow-headers", "").lower()
    assert "content-type" in allowed_headers
    assert "x-koma-customer-token" in allowed_headers
