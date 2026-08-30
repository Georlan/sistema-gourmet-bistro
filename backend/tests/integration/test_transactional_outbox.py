import datetime
from decimal import Decimal
import time
import pytest
import httpx
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import (
    ConfiguracaoRestaurante,
    ExternalOrderReference,
    IntegrationOutbox,
    Lancamento,
    Produto,
)
from app.application.orders.commands import (
    AcceptOrderCommand,
    CancelOrderCommand,
    CompleteOrderCommand,
    CreateOrderCommand,
    CustomerInput,
    DeliveryInput,
    OrderItemInput,
    MarkOrderReadyCommand,
    RejectOrderCommand,
)
from app.application.orders.service import OrderApplicationService
from app.adapters.orders.provider_adapter import (
    MarketplaceProviderAdapter,
    record_external_reference,
    resolve_external_reference,
)
from app.domain.orders.types import FulfillmentType, OrderChannel
from app.services.outbox.publisher import (
    enqueue_outbox_event_in_session,
)
from app.services.outbox.signer import (
    build_webhook_headers,
    sign_webhook_payload,
    verify_webhook_signature,
)
from app.services.outbox.dispatcher import (
    dispatch_pending_outbox_events,
    dispatch_single_outbox_event,
)
from tests.characterization.orders.fixtures import (
    CHAR_RESTAURANT_ID,
    char_client,
    char_setup,
)


@pytest.fixture
def outbox_db(char_setup):
    """Sessão de banco com webhook configurado para o restaurante de teste."""
    db: Session = SessionLocal()
    try:
        config = (
            db.query(ConfiguracaoRestaurante)
            .filter(ConfiguracaoRestaurante.restaurante_id == CHAR_RESTAURANT_ID)
            .first()
        )
        if not config:
            config = ConfiguracaoRestaurante(
                restaurante_id=CHAR_RESTAURANT_ID,
                nicho="hamburgueria",
                delivery_ativo=True,
            )
            db.add(config)

        config.webhook_url = "https://webhook.koma.internal/n8n/events"
        config.webhook_secret = "koma_super_secret_signing_key_123"
        config.webhook_ativo = True
        db.commit()

        # Limpa outbox e external refs anteriores deste restaurante
        db.query(IntegrationOutbox).filter(IntegrationOutbox.restaurante_id == CHAR_RESTAURANT_ID).delete()
        db.query(ExternalOrderReference).filter(ExternalOrderReference.restaurante_id == CHAR_RESTAURANT_ID).delete()
        db.commit()

        yield db
    finally:
        db.close()


def test_outbox_signature_and_constant_time_verification():
    """Valida cálculo de assinatura HMAC-SHA256 e proteção contra clock drift/tampering."""
    secret = "my_secret_key"
    payload = b'{"event":"test","data":123}'
    now_ts = str(int(time.time()))

    headers = build_webhook_headers(secret, payload, "evt-123", "koma.order.test", timestamp_str=now_ts)
    assert headers["X-Koma-Event-Id"] == "evt-123"
    assert headers["X-Koma-Event-Type"] == "koma.order.test"
    assert headers["X-Koma-Signature"].startswith("v1=")

    # Validação com sucesso
    is_valid = verify_webhook_signature(
        secret=secret,
        payload_bytes=payload,
        signature_header=headers["X-Koma-Signature"],
        timestamp_str=now_ts,
    )
    assert is_valid is True

    # Rejeição com payload adulterado
    tampered_payload = b'{"event":"test","data":999}'
    assert verify_webhook_signature(secret, tampered_payload, headers["X-Koma-Signature"], now_ts) is False

    # Rejeição com segredo incorreto
    assert verify_webhook_signature("wrong_secret", payload, headers["X-Koma-Signature"], now_ts) is False

    # Rejeição com timestamp fora da tolerância (> 300s drift)
    expired_ts = str(int(time.time()) - 400)
    assert verify_webhook_signature(secret, payload, headers["X-Koma-Signature"], expired_ts) is False


def test_order_creation_enqueues_outbox_atomically(outbox_db):
    """Garante que ao criar pedido, o evento koma.order.created é gravado na mesma transação."""
    cmd = CreateOrderCommand(
        restaurant_id=CHAR_RESTAURANT_ID,
        channel=OrderChannel.WEB_CARDAPIO,
        fulfillment=FulfillmentType.DELIVERY,
        items=(
            OrderItemInput(
                product_id="prod-char-simples",
                quantity=Decimal("2.00"),
            ),
        ),
        customer=CustomerInput(name="Maria", phone="11999990002"),
        delivery=DeliveryInput(address="Rua das Flores, 123"),
        idempotency_key="idemp-outbox-create-1",
    )

    order_dto = OrderApplicationService.create_order(db=outbox_db, cmd=cmd)
    assert order_dto.order_id is not None

    # Verifica se o evento foi gravado na Outbox
    outbox_events = (
        outbox_db.query(IntegrationOutbox)
        .filter(IntegrationOutbox.restaurante_id == CHAR_RESTAURANT_ID)
        .all()
    )
    assert len(outbox_events) == 1
    ev = outbox_events[0]
    assert ev.event_name == "koma.order.created"
    assert ev.status == "pending"
    assert ev.payload["channel"] == "web_cardapio"
    assert ev.aggregate_id == str(order_dto.order_id)


def test_order_lifecycle_transitions_enqueue_outbox(outbox_db):
    """Garante que todas as transições de ciclo de vida gravam os respectivos eventos na Outbox."""
    # 1. Cria pedido pendente
    cmd = CreateOrderCommand(
        restaurant_id=CHAR_RESTAURANT_ID,
        channel=OrderChannel.WEB_CARDAPIO,
        fulfillment=FulfillmentType.PICKUP,
        items=(
            OrderItemInput(
                product_id="prod-char-simples",
                quantity=Decimal("1.00"),
            ),
        ),
        customer=CustomerInput(name="Carlos", phone="11999990003"),
        idempotency_key="idemp-outbox-trans-1",
    )
    order = OrderApplicationService.create_order(db=outbox_db, cmd=cmd)

    # 2. Aceita pedido
    OrderApplicationService.accept_order(
        db=outbox_db,
        cmd=AcceptOrderCommand(restaurant_id=CHAR_RESTAURANT_ID, order_id=order.order_id, operator_user_id=42),
    )

    # 3. Marca como pronto
    OrderApplicationService.mark_order_ready(
        db=outbox_db,
        cmd=MarkOrderReadyCommand(restaurant_id=CHAR_RESTAURANT_ID, order_id=order.order_id),
    )

    # 4. Finaliza pedido
    OrderApplicationService.complete_order(
        db=outbox_db,
        cmd=CompleteOrderCommand(restaurant_id=CHAR_RESTAURANT_ID, order_id=order.order_id, operator_user_id=42),
    )

    events = (
        outbox_db.query(IntegrationOutbox)
        .filter(IntegrationOutbox.restaurante_id == CHAR_RESTAURANT_ID)
        .order_by(IntegrationOutbox.created_at.asc())
        .all()
    )

    event_names = [e.event_name for e in events]
    assert event_names == [
        "koma.order.created",
        "koma.order.accepted",
        "koma.order.ready",
        "koma.order.completed",
    ]


def test_outbox_dispatcher_success_delivery(outbox_db):
    """Testa o despachador entregando com sucesso para o webhook mockado."""
    cmd = CreateOrderCommand(
        restaurant_id=CHAR_RESTAURANT_ID,
        channel=OrderChannel.POS,
        fulfillment=FulfillmentType.DINE_IN,
        items=(
            OrderItemInput(
                product_id="prod-char-simples",
                quantity=Decimal("1.00"),
            ),
        ),
        idempotency_key="idemp-dispatch-success",
    )
    OrderApplicationService.create_order(db=outbox_db, cmd=cmd)

    # Mock HTTP transport respondendo 200 OK
    def mock_handler(request: httpx.Request):
        assert request.headers.get("X-Koma-Signature") is not None
        assert request.headers.get("X-Koma-Event-Type") == "koma.order.created"
        return httpx.Response(200, json={"received": True})

    client = httpx.Client(transport=httpx.MockTransport(mock_handler))

    stats = dispatch_pending_outbox_events(outbox_db, client=client)
    assert stats["total"] == 1
    assert stats["delivered"] == 1
    assert stats["failed"] == 0

    ev = outbox_db.query(IntegrationOutbox).filter(IntegrationOutbox.restaurante_id == CHAR_RESTAURANT_ID).first()
    assert ev.status == "delivered"
    assert ev.processed_at is not None
    assert ev.response_status_code == 200


def test_outbox_dispatcher_failure_and_dead_letter(outbox_db):
    """Testa falhas com backoff exponencial e eventual encaminhamento para dead_letter."""
    cmd = CreateOrderCommand(
        restaurant_id=CHAR_RESTAURANT_ID,
        channel=OrderChannel.POS,
        fulfillment=FulfillmentType.DINE_IN,
        items=(
            OrderItemInput(
                product_id="prod-char-simples",
                quantity=Decimal("1.00"),
            ),
        ),
        idempotency_key="idemp-dispatch-fail",
    )
    OrderApplicationService.create_order(db=outbox_db, cmd=cmd)

    # Mock HTTP transport retornando erro 503
    def failing_handler(request: httpx.Request):
        return httpx.Response(503, text="Service Unavailable")

    client = httpx.Client(transport=httpx.MockTransport(failing_handler))

    ev = outbox_db.query(IntegrationOutbox).filter(IntegrationOutbox.restaurante_id == CHAR_RESTAURANT_ID).first()

    # Tentativa 1 -> status failed, backoff agendado
    dispatch_single_outbox_event(outbox_db, ev, client=client)
    assert ev.status == "failed"
    assert ev.attempts == 1
    assert ev.next_retry_at is not None
    assert ev.response_status_code == 503

    # Simula tentativas até o limite máximo (max_attempts = 5)
    ev.attempts = 4
    dispatch_single_outbox_event(outbox_db, ev, client=client)
    assert ev.status == "dead_letter"
    assert ev.attempts == 5
    assert "503" in (ev.last_error or "")


class MockIfoodAdapter(MarketplaceProviderAdapter):
    @property
    def provider_name(self) -> str:
        return "ifood"

    def translate_to_command(self, restaurant_id: int, raw_payload: dict) -> tuple[str, CreateOrderCommand]:
        external_id = raw_payload["order_id"]
        cmd = CreateOrderCommand(
            restaurant_id=restaurant_id,
            channel=OrderChannel.IFOOD,
            fulfillment=FulfillmentType.DELIVERY,
            items=(
                OrderItemInput(
                    product_id="prod-char-simples",
                    quantity=Decimal(str(raw_payload.get("qtd", 1))),
                ),
            ),
            customer=CustomerInput(name="iFood Customer", phone="11988887777"),
            delivery=DeliveryInput(address="Rua Marketplace, 999"),
            idempotency_key=f"ifood:{external_id}",
        )
        return external_id, cmd


def test_marketplace_provider_adapter_idempotency(outbox_db):
    """Garante que payloads de marketplaces externos geram pedido e mapeamento de referência idempotente."""
    adapter = MockIfoodAdapter()
    raw_payload = {"order_id": "ifood-98765", "qtd": 2}

    # 1. Primeira chegada do pedido
    order1 = adapter.handle_external_order(
        db=outbox_db,
        restaurant_id=CHAR_RESTAURANT_ID,
        raw_payload=raw_payload,
    )
    assert order1.order_id is not None
    assert order1.channel == "cardapio"

    # Verifica se a referência externa foi registrada
    ref = resolve_external_reference(outbox_db, CHAR_RESTAURANT_ID, "ifood", "ifood-98765")
    assert ref is not None
    assert ref.internal_order_id == str(order1.order_id)

    # 2. Segunda chegada (replay do webhook do iFood)
    order2 = adapter.handle_external_order(
        db=outbox_db,
        restaurant_id=CHAR_RESTAURANT_ID,
        raw_payload=raw_payload,
    )

    # Deve retornar exatamente o mesmo pedido sem criar novo lançamento
    assert order2.order_id == order1.order_id

    matching_launches = (
        outbox_db.query(Lancamento)
        .filter(
            Lancamento.restaurante_id == CHAR_RESTAURANT_ID,
            Lancamento.idempotency_key == "ifood:ifood-98765",
        )
        .count()
    )
    assert matching_launches == 1
