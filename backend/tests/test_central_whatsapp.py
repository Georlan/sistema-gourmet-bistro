"""Regression gates for the opt-in KÔMA-central WhatsApp pilot.

No real WhatsApp API calls are performed by these tests.
"""
from decimal import Decimal
from dataclasses import replace

import httpx

from app.database import SessionLocal
from app.domain.orders.events import OrderCreated
from app.domain.orders.types import FulfillmentType, OrderChannel
from app.models import ConfiguracaoRestaurante, IntegrationOutbox
from app.services import central_whatsapp as wa
from app.services.outbox.dispatcher import dispatch_single_outbox_event
from tests.characterization.orders.fixtures import CHAR_RESTAURANT_ID, char_client, char_setup


def _enable(monkeypatch, rid=CHAR_RESTAURANT_ID):
    monkeypatch.setenv("KOMA_CENTRAL_WA_ENABLED", "true")
    monkeypatch.setenv("KOMA_CENTRAL_WA_PILOT_RESTAURANT_ID", str(rid))
    monkeypatch.setenv("KOMA_CENTRAL_WA_SENDER_PHONE", "5511888888888")
    monkeypatch.setenv("KOMA_CENTRAL_WA_INSTANCE_NAME", "koma-business-pilot")


def _order(rid=CHAR_RESTAURANT_ID):
    return OrderCreated(
        restaurant_id=rid, order_id="central-pilot-synthetic-1",
        check_id=None, display_number="7-B", channel=OrderChannel.WEB_CARDAPIO,
        fulfillment=FulfillmentType.PICKUP, total=Decimal("18.50"),
        items_count=1, customer_name="Não persistir na outbox",
        customer_phone="5511777777777",
    )


def test_default_off_and_fail_closed(monkeypatch):
    for key in (
        "KOMA_CENTRAL_WA_ENABLED", "KOMA_CENTRAL_WA_PILOT_RESTAURANT_ID",
        "KOMA_CENTRAL_WA_OPERATOR_PHONE", "KOMA_CENTRAL_WA_SENDER_PHONE",
        "KOMA_CENTRAL_WA_INSTANCE_NAME", "KOMA_CENTRAL_WA_PILOT_CUSTOMER_PHONE",
    ):
        monkeypatch.delenv(key, raising=False)
    assert wa.pilot_configuration() is None
    _enable(monkeypatch)
    assert wa.enabled_for(CHAR_RESTAURANT_ID)
    assert not wa.enabled_for(CHAR_RESTAURANT_ID + 1)
    monkeypatch.setenv("KOMA_CENTRAL_WA_SENDER_PHONE", "invalid")
    assert wa.pilot_configuration() is None
    monkeypatch.setenv("KOMA_CENTRAL_WA_SENDER_PHONE", "5511888888888")
    monkeypatch.setenv("KOMA_CENTRAL_WA_INSTANCE_NAME", "koma-restaurant-1")
    assert wa.pilot_configuration() is None
    monkeypatch.setenv("KOMA_CENTRAL_WA_INSTANCE_NAME", "koma-business-pilot")
    monkeypatch.setenv("KOMA_CENTRAL_WA_PILOT_RESTAURANT_ID", "1,2")
    assert wa.pilot_configuration() is None


def test_sender_identity_verified_without_sending():
    def provider(request):
        if request.url.path.endswith("/connectionState/koma-business-pilot"):
            return httpx.Response(200, json={"instance": {"state": "open"}})
        return httpx.Response(200, json=[{
            "name": "koma-business-pilot", "ownerJid": "5511888888888@s.whatsapp.net"
        }])

    with httpx.Client(transport=httpx.MockTransport(provider)) as client:
        assert wa._provider_sender_matches(
            client, "https://example.test", {}, "koma-business-pilot", "5511888888888"
        )
        assert not wa._provider_sender_matches(
            client, "https://example.test", {}, "koma-business-pilot", "5511999999999"
        )



def test_sender_identity_accepts_legacy_brazilian_mobile_jid():
    # WhatsApp can publish BR mobile IDs with the ninth digit omitted.
    def provider(request):
        if request.url.path.endswith("/connectionState/koma-business-pilot"):
            return httpx.Response(200, json={"instance": {"state": "open"}})
        return httpx.Response(200, json=[{
            "name": "koma-business-pilot",
            "ownerJid": "551187654321@s.whatsapp.net",
        }])

    with httpx.Client(transport=httpx.MockTransport(provider)) as client:
        assert wa._provider_sender_status(
            client, "https://example.test", {}, "koma-business-pilot", "5511987654321"
        ) == "matched"
        assert wa._provider_sender_status(
            client, "https://example.test", {}, "koma-business-pilot", "5511981234567"
        ) == "mismatch"


def test_sender_verification_blocks_closed_or_unknown_business_session():
    requests = []

    def disconnected(request):
        requests.append(request.url.path)
        return httpx.Response(200, json={"instance": {"state": "close"}})

    with httpx.Client(transport=httpx.MockTransport(disconnected)) as client:
        assert wa._provider_sender_status(
            client, "https://example.test", {}, "koma-business-pilot", "5511987654321"
        ) == "not_open"
    assert requests == ["/instance/connectionState/koma-business-pilot"]

    def no_owner(request):
        if "connectionState" in request.url.path:
            return httpx.Response(200, json={"instance": {"state": "open"}})
        return httpx.Response(200, json=[{
            "name": "koma-business-pilot",
            "connectionStatus": "open",
        }])

    with httpx.Client(transport=httpx.MockTransport(no_owner)) as client:
        assert wa._provider_sender_status(
            client, "https://example.test", {}, "koma-business-pilot", "5511987654321"
        ) == "owner_missing"


def test_sender_verification_supports_nested_instance_without_cross_instance_fallback():
    def nested(request):
        if "connectionState" in request.url.path:
            return httpx.Response(200, json={"instance": {"state": "open"}})
        return httpx.Response(200, json=[
            {"name": "another-instance", "ownerJid": "5511987654321@s.whatsapp.net"},
            {"instance": {"instanceName": "koma-business-pilot",
                          "ownerJid": "551187654321@s.whatsapp.net"}},
        ])

    with httpx.Client(transport=httpx.MockTransport(nested)) as client:
        assert wa._provider_sender_matches(
            client, "https://example.test", {}, "koma-business-pilot", "5511987654321"
        )



def test_enqueue_is_gated_deduped_and_contains_no_personal_contact(char_setup, monkeypatch):
    _enable(monkeypatch)
    db = SessionLocal(restaurante_id=CHAR_RESTAURANT_ID)
    try:
        tenant = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=CHAR_RESTAURANT_ID).one()
        tenant.whatsapp_instance_name = wa.CENTRAL_INSTANCE_MARKER
        tenant.whatsapp_recipient_phone = "5511999999999"
        tenant.whatsapp_alerts_enabled = False
        db.flush()
        first = wa.enqueue_operator_alert(db, _order())
        second = wa.enqueue_operator_alert(db, _order())
        assert first is second
        assert first.event_name == wa.EVENT_NAME
        assert "phone" not in first.payload
        assert "customer_name" not in first.payload
        assert "Não persistir" not in str(first.payload)
        # Any buyer can trigger the operator alert; buyer is not the destination.
        assert wa.enqueue_operator_alert(db, replace(_order(), customer_phone="5511999000000")) is first
        tenant = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=CHAR_RESTAURANT_ID).one()
        tenant.whatsapp_alerts_enabled = True
        assert wa.enqueue_operator_alert(db, _order()) is None
        tenant.whatsapp_alerts_enabled = False
        assert wa.enqueue_operator_alert(db, _order(CHAR_RESTAURANT_ID + 1)) is None
        assert wa.enqueue_operator_alert(db, OrderCreated(
            restaurant_id=CHAR_RESTAURANT_ID, order_id="pos-order",
            channel=OrderChannel.POS,
        )) is None
        db.rollback()
    finally:
        db.close()


def test_disabled_after_enqueue_skips_provider_entirely(char_setup, monkeypatch):
    _enable(monkeypatch)
    db = SessionLocal(restaurante_id=CHAR_RESTAURANT_ID)
    try:
        tenant = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=CHAR_RESTAURANT_ID).one()
        tenant.whatsapp_instance_name = wa.CENTRAL_INSTANCE_MARKER
        tenant.whatsapp_recipient_phone = "5511999999999"
        tenant.whatsapp_alerts_enabled = False
        db.flush()
        row = wa.enqueue_operator_alert(db, _order())
        db.commit()
        event_id = row.id
        monkeypatch.setenv("KOMA_CENTRAL_WA_ENABLED", "false")
        event = db.query(IntegrationOutbox).filter_by(id=event_id, restaurante_id=CHAR_RESTAURANT_ID).one()
        assert not dispatch_single_outbox_event(db, event)
        db.refresh(event)
        assert event.status == "dead_letter"
        assert "nenhuma mensagem enviada" in event.last_error
        assert event.attempts == 0
    finally:
        db.close()


def test_render_minimal_comanda_with_real_line_items(char_setup, monkeypatch):
    _enable(monkeypatch)
    db = SessionLocal(restaurante_id=CHAR_RESTAURANT_ID)
    try:
        msg = wa.render_operator_message(db, {
            "restaurant_id": CHAR_RESTAURANT_ID,
            "order_id": "missing-test-order",
            "check_id": None,
            "display_number": "7-B",
            "fulfillment": "pickup",
            "total": "18.50",
        })
        assert "Pedido #7-B" in msg
        assert "Retirada" in msg
        assert "R$ 18,50" in msg
        assert "aceitar" in msg
        assert "5511999999999" not in msg
    finally:
        db.close()
