from pathlib import Path

from starlette.requests import Request

from app.adapters.orders.web_adapter import _order_acquisition_payload, _safe_referrer
from app.schemas import CardapioPedidoCreate


def _request(*, user_agent: str, referer: str = "") -> Request:
    headers = [(b"user-agent", user_agent.encode())]
    if referer:
        headers.append((b"referer", referer.encode()))
    return Request({
        "type": "http",
        "method": "POST",
        "path": "/cardapio/pedidos",
        "headers": headers,
        "query_string": b"",
        "server": ("testserver", 80),
        "client": ("127.0.0.1", 1234),
        "scheme": "http",
    })


def _payload(**extra):
    base = {
        "restaurante_id": 6,
        "itens": [{"produto_id": "p1", "quantidade": 1}],
        "cliente_nome": "Cliente Teste",
        "cliente_telefone": "88999990000",
        "forma_pagamento": "na_entrega",
        "forma_pagamento_detalhe": "dinheiro",
        "tipo_pedido": "retirada",
    }
    base.update(extra)
    return CardapioPedidoCreate(**base)


def test_server_infers_instagram_surface_without_persisting_raw_user_agent():
    request = _request(
        user_agent="Mozilla/5.0 Instagram 449.0.0.52.84 Android",
        referer="https://instagram.com/some/path?secret=abc#fragment",
    )
    data = _order_acquisition_payload(_payload(), request)

    assert data["source"] == "instagram"
    assert data["medium"] == "in_app_browser"
    assert data["client_surface"] == "instagram_in_app"
    assert data["referrer"] == "https://instagram.com/some/path"
    assert data["session_id"].startswith("server-")
    assert "user_agent" not in data
    assert "ip" not in data


def test_client_utm_wins_over_coarse_server_inference():
    request = _request(user_agent="Instagram Browser")
    data = _order_acquisition_payload(
        _payload(acquisition={
            "session_id": "session-12345678",
            "source": "instagram",
            "medium": "paid_social",
            "campaign": "almoco_domingo",
            "content": "story_01",
            "landing_path": "/quentinha-caseira",
            "client_surface": "instagram_in_app",
        }),
        request,
    )

    assert data["session_id"] == "session-12345678"
    assert data["medium"] == "paid_social"
    assert data["campaign"] == "almoco_domingo"
    assert data["content"] == "story_01"


def test_referrer_sanitizer_drops_query_fragment_and_non_http_protocols():
    assert _safe_referrer("https://example.com/path?a=1#x") == "https://example.com/path"
    assert _safe_referrer("javascript:alert(1)") is None


def test_acquisition_migration_extends_current_head_linearly():
    root = Path(__file__).resolve().parents[2]
    migration = (
        root
        / "backend/alembic/versions/b4c8d9e0f1a2_order_acquisition_attribution.py"
    ).read_text(encoding="utf-8")
    assert 'revision = "b4c8d9e0f1a2"' in migration
    assert 'down_revision = "a3af4de4e221"' in migration
