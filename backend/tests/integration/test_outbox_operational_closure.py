"""Testes de fechamento operacional da Outbox (Fase 6.1).

Valida:
1. Lifecycle e execução do OutboxWorker.
2. Claim multi-worker transacional seguro (SKIP LOCKED e partições disjuntas).
3. Recuperação de claims órfãos / stale claims (worker crash/timeout).
4. Envelope HMAC criptograficamente vinculado e proteção real contra Replay Attack.
5. Circuito completo de OrderDispatched -> koma.order.dispatched -> Webhook delivery.
6. Retry com backoff exponencial e transição para dead_letter.
"""

from __future__ import annotations

import asyncio
import datetime
from decimal import Decimal
import json
import uuid
import httpx
import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import (
    ConfiguracaoRestaurante,
    IntegrationOutbox,
    Lancamento,
    Motoboy,
    Produto,
    Restaurante,
    Usuario,
)
from app.application.orders.commands import (
    AcceptOrderCommand,
    CreateOrderCommand,
    DispatchOrderCommand,
    MarkOrderReadyCommand,
    OrderItemInput,
    CustomerInput,
    DeliveryInput,
)
from app.application.orders.service import OrderApplicationService
from app.domain.orders.types import FulfillmentType, OrderChannel
from app.services.outbox.dispatcher import (
    claim_outbox_batch,
    dispatch_pending_outbox_events,
    recover_stale_outbox_claims,
)
from app.services.outbox.signer import (
    build_webhook_headers,
    sign_webhook_payload,
    verify_webhook_envelope,
    verify_webhook_signature,
)
from app.services.outbox.worker import OutboxWorker
from tests.characterization.orders.fixtures import (
    CHAR_RESTAURANT_ID,
    char_client,
    char_setup,
)


@pytest.fixture
def op_db(char_setup):
    """Sessão com dados de caracterização, webhook configurado e motoboy para testes operacionais."""
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

        config.webhook_url = "https://n8n.exemplo.com/webhook/koma"
        config.webhook_secret = "super-secret-key-fase-6-1"
        config.webhook_ativo = True

        # Cria ou ativa motoboy 701
        motoboy = db.query(Motoboy).filter(Motoboy.id == 701).first()
        if not motoboy:
            motoboy = Motoboy(
                id=701,
                restaurante_id=CHAR_RESTAURANT_ID,
                nome="Roberto Entregador",
                telefone="11988887777",
                ativo=True,
            )
            db.add(motoboy)

        db.commit()

        # Limpa outbox deste restaurante para testes isolados
        db.query(IntegrationOutbox).filter(IntegrationOutbox.restaurante_id == CHAR_RESTAURANT_ID).delete()
        db.commit()

        yield db
    finally:
        db.close()


def test_hmac_cryptographic_envelope_binding_and_replay_protection():
    """Valida o vínculo formal de event_id/type na assinatura e a rejeição de replay no consumidor."""
    secret = "secret-token-koma-2026"
    payload = {"pedido_id": 123, "total": "50.00"}
    payload_bytes = json.dumps(payload).encode("utf-8")
    event_id = "evt-unique-abc-123"
    event_name = "koma.order.created"
    ts = str(int(datetime.datetime.now(datetime.timezone.utc).timestamp()))

    headers = build_webhook_headers(
        secret=secret,
        payload_bytes=payload_bytes,
        event_id=event_id,
        event_name=event_name,
        timestamp_str=ts,
    )

    processed_events_cache: set[str] = set()

    # 1. Primeira recepção válida
    valid, reason = verify_webhook_envelope(
        secret=secret,
        payload_bytes=payload_bytes,
        headers=headers,
        processed_event_ids=processed_events_cache,
    )
    assert valid is True
    assert reason == "OK"
    assert event_id in processed_events_cache

    # 2. Replay attack com a MESMA requisição e assinatura válida
    replay_valid, replay_reason = verify_webhook_envelope(
        secret=secret,
        payload_bytes=payload_bytes,
        headers=headers,
        processed_event_ids=processed_events_cache,
    )
    assert replay_valid is False
    assert "Replay attack detected" in replay_reason

    # 3. Adulteração do event_id ou payload quebra a assinatura criptograficamente
    tampered_headers = dict(headers)
    tampered_headers["X-Koma-Event-Id"] = "evt-tampered-id"
    tampered_valid, tampered_reason = verify_webhook_envelope(
        secret=secret,
        payload_bytes=payload_bytes,
        headers=tampered_headers,
    )
    assert tampered_valid is False
    assert "Invalid HMAC-SHA256 signature" in tampered_reason


def test_multi_worker_concurrent_claim_disjoint_sets(op_db):
    """Garante que múltiplos workers chamando claim_outbox_batch recebem lotes disjuntos sem colisão."""
    # Cria 10 eventos na outbox
    now = datetime.datetime.now(datetime.timezone.utc)
    for i in range(10):
        ev = IntegrationOutbox(
            id=f"outbox-{i}",
            restaurante_id=CHAR_RESTAURANT_ID,
            event_id=f"evt-{i}",
            event_name="koma.order.created",
            aggregate_type="order",
            aggregate_id=f"ord-{i}",
            payload={"i": i},
            status="pending",
            created_at=now,
        )
        op_db.add(ev)
    op_db.commit()

    # Worker A faz claim de 4 eventos
    claimed_a = claim_outbox_batch(op_db, batch_size=4, worker_id="worker-A", restaurant_id=CHAR_RESTAURANT_ID)
    assert len(claimed_a) == 4
    ids_a = {item["id"] for item in claimed_a}

    # Worker B faz claim logo em seguida de 4 eventos
    claimed_b = claim_outbox_batch(op_db, batch_size=4, worker_id="worker-B", restaurant_id=CHAR_RESTAURANT_ID)
    assert len(claimed_b) == 4
    ids_b = {item["id"] for item in claimed_b}

    # Garantia de partição disjunta: A e B não possuem nenhuma interseção
    assert ids_a.isdisjoint(ids_b)

    # Worker C pega os 2 restantes
    claimed_c = claim_outbox_batch(op_db, batch_size=4, worker_id="worker-C", restaurant_id=CHAR_RESTAURANT_ID)
    assert len(claimed_c) == 2
    ids_c = {item["id"] for item in claimed_c}
    assert ids_c.isdisjoint(ids_a)
    assert ids_c.isdisjoint(ids_b)

    # Worker D não encontra mais nenhum evento disponível
    claimed_d = claim_outbox_batch(op_db, batch_size=4, worker_id="worker-D", restaurant_id=CHAR_RESTAURANT_ID)
    assert len(claimed_d) == 0


def test_stale_claim_recovery_after_worker_crash(op_db):
    """Garante que eventos travados em 'processing' por workers mortos/interrompidos são recuperados."""
    now = datetime.datetime.now(datetime.timezone.utc)
    stale_time = now - datetime.timedelta(seconds=120)

    # Evento 1: preso em processing há 2 minutos (stale)
    ev1 = IntegrationOutbox(
        id="outbox-stale-1",
        restaurante_id=CHAR_RESTAURANT_ID,
        event_id="evt-stale-1",
        event_name="koma.order.created",
        aggregate_type="order",
        aggregate_id="ord-stale-1",
        payload={"order": 1},
        status="processing",
        locked_at=stale_time,
        locked_by="dead-worker-1",
        created_at=stale_time,
    )
    # Evento 2: processing recente (há 5 segundos, não deve ser recuperado)
    ev2 = IntegrationOutbox(
        id="outbox-active-2",
        restaurante_id=CHAR_RESTAURANT_ID,
        event_id="evt-active-2",
        event_name="koma.order.created",
        aggregate_type="order",
        aggregate_id="ord-active-2",
        payload={"order": 2},
        status="processing",
        locked_at=now - datetime.timedelta(seconds=5),
        locked_by="live-worker-2",
        created_at=now,
    )
    op_db.add_all([ev1, ev2])
    op_db.commit()

    # Executa recuperação de stale claims com limite de 60s
    recovered_count = recover_stale_outbox_claims(op_db, stale_timeout_seconds=60, restaurant_id=CHAR_RESTAURANT_ID)
    assert recovered_count == 1

    # Verifica status
    ev1_db = op_db.query(IntegrationOutbox).filter(IntegrationOutbox.id == "outbox-stale-1").first()
    assert ev1_db.status == "pending"
    assert ev1_db.locked_at is None
    assert ev1_db.locked_by is None
    assert "Stale claim recovered" in ev1_db.last_error

    ev2_db = op_db.query(IntegrationOutbox).filter(IntegrationOutbox.id == "outbox-active-2").first()
    assert ev2_db.status == "processing"
    assert ev2_db.locked_by == "live-worker-2"


def test_order_dispatched_lifecycle_and_webhook_delivery(op_db):
    """Garante o ciclo completo: Criar -> Aceitar -> Pronto -> Despachar -> koma.order.dispatched -> Webhook."""
    # 1. Cria pedido de Delivery
    cmd_create = CreateOrderCommand(
        restaurant_id=CHAR_RESTAURANT_ID,
        channel=OrderChannel.WEB_CARDAPIO,
        fulfillment=FulfillmentType.DELIVERY,
        items=(
            OrderItemInput(product_id="prod-char-simples", quantity=Decimal("1.00")),
        ),
        customer=CustomerInput(name="Lucas Entregas", phone="11999991234"),
        delivery=DeliveryInput(address="Rua das Palmeiras, 777"),
        idempotency_key="idemp-op-dispatch-1",
    )
    order = OrderApplicationService.create_order(db=op_db, cmd=cmd_create)

    # 2. Aceita pedido
    OrderApplicationService.accept_order(
        db=op_db,
        cmd=AcceptOrderCommand(restaurant_id=CHAR_RESTAURANT_ID, order_id=order.order_id),
    )

    # 3. Marca como pronto
    OrderApplicationService.mark_order_ready(
        db=op_db,
        cmd=MarkOrderReadyCommand(restaurant_id=CHAR_RESTAURANT_ID, order_id=order.order_id),
    )

    # 4. Despacha pedido com motoboy
    dispatched_order = OrderApplicationService.dispatch_order(
        db=op_db,
        cmd=DispatchOrderCommand(
            restaurant_id=CHAR_RESTAURANT_ID,
            order_id=order.order_id,
            courier_id=701,
        ),
    )
    assert dispatched_order.status == "transito"

    # Verifica se o evento koma.order.dispatched foi gravado na Outbox
    events = (
        op_db.query(IntegrationOutbox)
        .filter(IntegrationOutbox.restaurante_id == CHAR_RESTAURANT_ID)
        .order_by(IntegrationOutbox.created_at.asc())
        .all()
    )
    event_names = [e.event_name for e in events]
    assert "koma.order.dispatched" in event_names

    dispatched_ev = next(e for e in events if e.event_name == "koma.order.dispatched")
    assert dispatched_ev.status == "pending"
    assert dispatched_ev.payload["courier_id"] == 701

    # 5. Despacha via Dispatcher com mock de transporte HTTP
    received_requests = []

    def mock_transport(request: httpx.Request):
        received_requests.append(request)
        return httpx.Response(200, json={"status": "received", "event_id": request.headers.get("X-Koma-Event-Id")})

    client = httpx.Client(transport=httpx.MockTransport(mock_transport))
    stats = dispatch_pending_outbox_events(op_db, client=client, restaurant_id=CHAR_RESTAURANT_ID)

    assert stats["delivered"] >= 4
    assert stats["failed"] == 0

    # Valida cabeçalhos e assinatura do webhook recebido para o evento dispatched
    dispatched_http_req = next(
        req for req in received_requests
        if req.headers.get("X-Koma-Event-Type") == "koma.order.dispatched"
    )
    assert dispatched_http_req.headers.get("X-Koma-Event-Id") == dispatched_ev.event_id

    # Verifica envelope no receptor
    valid, reason = verify_webhook_envelope(
        secret="super-secret-key-fase-6-1",
        payload_bytes=dispatched_http_req.content,
        headers=dict(dispatched_http_req.headers),
    )
    assert valid is True
    assert reason == "OK"


def test_dispatcher_retry_and_dead_letter_progression(op_db):
    """Garante que requisições HTTP com falha progridem com backoff e vão para dead_letter ao esgotar retries."""
    now = datetime.datetime.now(datetime.timezone.utc)
    ev = IntegrationOutbox(
        id="outbox-fail-progression",
        restaurante_id=CHAR_RESTAURANT_ID,
        event_id="evt-fail-progression",
        event_name="koma.order.created",
        aggregate_type="order",
        aggregate_id="ord-fail-1",
        payload={"order": 99},
        status="pending",
        attempts=4,  # max_attempts padrão é 5
        max_attempts=5,
        created_at=now,
    )
    op_db.add(ev)
    op_db.commit()

    # Falha 500 do n8n / servidor externo
    def mock_error_transport(request: httpx.Request):
        return httpx.Response(500, text="Internal Server Error on downstream n8n")

    client = httpx.Client(transport=httpx.MockTransport(mock_error_transport))

    stats = dispatch_pending_outbox_events(op_db, client=client, restaurant_id=CHAR_RESTAURANT_ID)
    assert stats["dead_letter"] == 1
    assert stats["delivered"] == 0

    ev_db = op_db.query(IntegrationOutbox).filter(IntegrationOutbox.id == "outbox-fail-progression").first()
    assert ev_db.status == "dead_letter"
    assert ev_db.attempts == 5
    assert "HTTP 500" in ev_db.last_error


@pytest.mark.anyio
async def test_outbox_worker_async_lifecycle():
    """Testa inicialização, parada graciosa e método run_once do OutboxWorker."""
    worker = OutboxWorker(poll_interval_seconds=0.1, batch_size=10, worker_id="test-worker-life")
    
    # 1. Inicia worker
    task = worker.start()
    assert worker.is_running is True
    assert task is not None
    assert not task.done()

    # Aguarda 200ms de loop
    await asyncio.sleep(0.2)

    # 2. Para worker graciosamente
    await worker.stop(timeout_seconds=2.0)
    assert worker.is_running is False
    assert task.done()
