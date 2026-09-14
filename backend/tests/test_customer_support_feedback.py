from types import SimpleNamespace
from unittest.mock import MagicMock

from app.database import current_restaurante_id
from app.routes import customer_satisfaction
from app.support_models import CustomerSupportFeedback


def test_support_feedback_page_context_never_keeps_query_or_hash():
    assert customer_satisfaction._safe_feedback_page_path("/caixa?token=secret#frag") == "/caixa"
    assert customer_satisfaction._safe_feedback_page_path("https://example.com/caixa?token=secret") is None
    assert customer_satisfaction._safe_feedback_page_path(None) is None


def test_support_feedback_is_persisted_and_owner_notification_is_enqueued(monkeypatch):
    db = MagicMock()
    db.query.return_value.filter.return_value.scalar.return_value = "Restaurante Piloto"
    enqueued = []

    monkeypatch.setattr(
        customer_satisfaction,
        "settings",
        SimpleNamespace(KOMA_OWNER_EMAIL="owner@example.com"),
    )
    monkeypatch.setenv("KOMA_OWNER_WHATSAPP_PHONE", "5588999999999")
    monkeypatch.setattr(
        customer_satisfaction,
        "enqueue",
        lambda _db, **kwargs: enqueued.append(kwargs),
    )

    tenant_token = current_restaurante_id.set(42)
    try:
        result = customer_satisfaction.create_koma_support_feedback(
            customer_satisfaction.CreateKomaSupportFeedbackInput(
                kind="suggestion",
                message="  Deixem o fechamento do caixa mais simples.  ",
                page_path="/caixa?invite=should-not-leak#token=also-secret",
            ),
            db=db,
            current_user=SimpleNamespace(
                id="user-7",
                nome="Cliente QA",
                role="admin",
                cargo="admin",
            ),
        )
    finally:
        current_restaurante_id.reset(tenant_token)

    assert result["status"] == "received"
    assert result["id"]
    db.commit.assert_called_once()

    persisted = db.add.call_args.args[0]
    assert isinstance(persisted, CustomerSupportFeedback)
    assert persisted.restaurante_id == 42
    assert persisted.reporter_user_id == "user-7"
    assert persisted.reporter_name == "Cliente QA"
    assert persisted.kind == "suggestion"
    assert persisted.message == "Deixem o fechamento do caixa mais simples."
    assert persisted.page_path == "/caixa"
    assert persisted.status == "new"

    assert len(enqueued) == 1
    notification = enqueued[0]
    assert notification["email"] == "owner@example.com"
    assert notification["phone"] == "5588999999999"
    assert notification["subject"] == "Sugestão de cliente — KÔMA"
    assert "Restaurante Piloto (ID 42)" in notification["message"]
    assert "Tela: /caixa" in notification["message"]
    assert "should-not-leak" not in notification["message"]
    assert "also-secret" not in notification["message"]
