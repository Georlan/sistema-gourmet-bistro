from fastapi.testclient import TestClient

from app.main import app


OFFICIAL_ORIGIN = "https://sistema-gourmet-bistro.pages.dev"


def test_cardapio_order_preflight_allows_real_checkout_headers():
    client = TestClient(app)

    response = client.options(
        "/cardapio/pedidos",
        headers={
            "Origin": OFFICIAL_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": (
                "Content-Type,X-Idempotency-Key,X-Koma-Customer-Token"
            ),
        },
    )

    assert response.status_code in (200, 204)
    assert response.headers.get("access-control-allow-origin") == OFFICIAL_ORIGIN
    assert "POST" in response.headers.get("access-control-allow-methods", "")

    allowed_headers = response.headers.get("access-control-allow-headers", "").lower()
    assert "content-type" in allowed_headers
    assert "x-idempotency-key" in allowed_headers
    assert "x-koma-customer-token" in allowed_headers
