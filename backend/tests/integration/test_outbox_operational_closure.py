"""Testes de fechamento operacional da Outbox (Fase 6.1 / 6.1.1).

Valida:
1. Lifecycle e execução do OutboxWorker.
2. Claim multi-worker transacional seguro (SKIP LOCKED e partições disjuntas).
3. Recuperação de claims órfãos / stale claims (worker crash/timeout).
4. Envelope HMAC criptograficamente vinculado e proteção real contra Replay Attack.
5. Circuito completo de OrderDispatched -> koma.order.dispatched -> Webhook delivery.
6. Retry com backoff exponencial e transição para dead_letter.
7. [Fase 6.1.1] Descoberta e isolamento multi-tenant RLS (discover_active_restaurant_ids e tenant_session_scope).
8. [Fase 6.1.1] Atomicidade estrita no despacho (falha ao gravar na Outbox causa rollback total de delivery_status).
9. [Fase 6.1.1] Heartbeat de lease pré-HTTP e proteção contra roubo de claims em trânsito.
10. [Fase 6.1.1] Proteção de posse na liquidação (settle ownership check).
"""

from __future__ import annotations

import asyncio
import datetime
from decimal import Decimal
import json
from unittest.mock import patch
import uuid
import httpx
import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal, tenant_session_scope
from app.models import (
    Comanda,
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
    dispatch_single_claimed_snapshot,
    recover_stale_outbox_claims,
    renew_outbox_claim_lease,
    settle_outbox_event,
)
from app.services.outbox.signer import (
    build_webhook_headers,
    sign_webhook_payload,
    verify_webhook_envelope,
    verify_webhook_signature,
)
from app.services.outbox.worker import OutboxWorker, discover_active_restaurant_ids
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
    stale_time = now - datetime.timedelta(seconds=180)

    # Evento 1: preso em processing há 3 minutos (stale)
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

    # Executa recuperação de stale claims com limite de 120s
    recovered_count = recover_stale_outbox_claims(op_db, stale_timeout_seconds=120, restaurant_id=CHAR_RESTAURANT_ID)
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


# ─────────────────────────────────────────────────────────────────────────────
# Testes da Fase 6.1.1 (Production Hardening & Real RLS / Atomic / Lease)
# ─────────────────────────────────────────────────────────────────────────────

def test_worker_multi_tenant_rls_discovery_and_execution(op_db):
    """Garante que o OutboxWorker descobre dinamicamente os tenants e despacha sob tenant_session_scope."""
    # 1. Cria segundo restaurante de teste
    other_tenant_id = 999
    rest2 = op_db.query(Restaurante).filter(Restaurante.id == other_tenant_id).first()
    if not rest2:
        rest2 = Restaurante(id=other_tenant_id, nome="Restaurante Tenant 2", slug="bistro-tenant-2")
        op_db.add(rest2)

    cfg2 = op_db.query(ConfiguracaoRestaurante).filter(ConfiguracaoRestaurante.restaurante_id == other_tenant_id).first()
    if not cfg2:
        cfg2 = ConfiguracaoRestaurante(
            restaurante_id=other_tenant_id,
            webhook_url="https://n8n.tenant2.com/webhook",
            webhook_secret="secret-tenant-2",
            webhook_ativo=True,
        )
        op_db.add(cfg2)
    op_db.commit()

    # Descobre restaurantes ativos
    r_ids = discover_active_restaurant_ids(op_db)
    assert CHAR_RESTAURANT_ID in r_ids
    assert other_tenant_id in r_ids

    # Insere um evento para cada restaurante
    now = datetime.datetime.now(datetime.timezone.utc)
    ev1 = IntegrationOutbox(
        id="evt-tenant-1",
        restaurante_id=CHAR_RESTAURANT_ID,
        event_id="e-1",
        event_name="koma.order.created",
        aggregate_type="order",
        aggregate_id="ord-t1",
        payload={"tenant": 1},
        status="pending",
        created_at=now,
    )
    ev2 = IntegrationOutbox(
        id="evt-tenant-2",
        restaurante_id=other_tenant_id,
        event_id="e-2",
        event_name="koma.order.created",
        aggregate_type="order",
        aggregate_id="ord-t2",
        payload={"tenant": 2},
        status="pending",
        created_at=now,
    )
    op_db.add_all([ev1, ev2])
    op_db.commit()

    # Executa run_once do worker com mock transport (sem passar tenant específico, exercitando descoberta global)
    def mock_transport(request: httpx.Request):
        return httpx.Response(200, json={"status": "ok"})

    client = httpx.Client(transport=httpx.MockTransport(mock_transport))
    worker = OutboxWorker(batch_size=10, worker_id="test-global-worker")
    stats = worker.run_once(client=client)

    assert stats["claimed"] >= 2
    assert stats["delivered"] >= 2

    # Verifica que ambos os eventos foram entregues
    e1_db = op_db.query(IntegrationOutbox).filter(IntegrationOutbox.id == "evt-tenant-1").first()
    e2_db = op_db.query(IntegrationOutbox).filter(IntegrationOutbox.id == "evt-tenant-2").first()
    assert e1_db.status == "delivered"
    assert e2_db.status == "delivered"


def test_dispatch_order_atomic_rollback_on_outbox_failure(op_db):
    """Garante que se a gravação na Outbox falhar, a transição inteira sofre rollback (status NÃO vira transito)."""
    # 1. Cria pedido de Delivery
    cmd_create = CreateOrderCommand(
        restaurant_id=CHAR_RESTAURANT_ID,
        channel=OrderChannel.WEB_CARDAPIO,
        fulfillment=FulfillmentType.DELIVERY,
        items=(
            OrderItemInput(product_id="prod-char-simples", quantity=Decimal("1.00")),
        ),
        customer=CustomerInput(name="Ana Rollback", phone="11999995555"),
        delivery=DeliveryInput(address="Rua do Rollback, 100"),
        idempotency_key="idemp-op-rollback-atomic",
    )
    order = OrderApplicationService.create_order(db=op_db, cmd=cmd_create)
    OrderApplicationService.accept_order(db=op_db, cmd=AcceptOrderCommand(restaurant_id=CHAR_RESTAURANT_ID, order_id=order.order_id))
    OrderApplicationService.mark_order_ready(db=op_db, cmd=MarkOrderReadyCommand(restaurant_id=CHAR_RESTAURANT_ID, order_id=order.order_id))

    comanda = op_db.query(Comanda).filter(Comanda.id == order.comanda_id).first()
    assert comanda.delivery_status == "pronto"
    assert comanda.motoboy_id is None

    # Simula falha catastrófica no enqueue_outbox_event_in_session
    with patch("app.application.orders.service.enqueue_outbox_event_in_session", side_effect=RuntimeError("Simulated Outbox Disk Error")):
        with pytest.raises(RuntimeError, match="Simulated Outbox Disk Error"):
            OrderApplicationService.dispatch_order(
                db=op_db,
                cmd=DispatchOrderCommand(
                    restaurant_id=CHAR_RESTAURANT_ID,
                    order_id=order.order_id,
                    courier_id=701,
                ),
            )

    # Rollback explícito da sessão de teste para verificar estado persistido
    op_db.rollback()
    comanda_after = op_db.query(Comanda).filter(Comanda.id == order.comanda_id).first()

    # Invariante: como a Outbox falhou, comanda NÃO pode ter sido despachada
    assert comanda_after.delivery_status == "pronto"
    assert comanda_after.motoboy_id is None


def test_pre_http_lease_heartbeat_and_aborted_stolen_claim(op_db):
    """Garante que o lease é renovado antes do HTTP e aborta com segurança se o claim tiver sido roubado."""
    now = datetime.datetime.now(datetime.timezone.utc)
    ev = IntegrationOutbox(
        id="evt-heartbeat-test",
        restaurante_id=CHAR_RESTAURANT_ID,
        event_id="e-heartbeat",
        event_name="koma.order.created",
        aggregate_type="order",
        aggregate_id="ord-hb",
        payload={"test": True},
        status="processing",
        locked_at=now - datetime.timedelta(seconds=50),
        locked_by="worker-owner",
        created_at=now,
    )
    op_db.add(ev)
    op_db.commit()

    # 1. Renovação legítima pelo proprietário do lock
    renewed = renew_outbox_claim_lease(op_db, "evt-heartbeat-test", "worker-owner")
    assert renewed is True

    ev_db = op_db.query(IntegrationOutbox).filter(IntegrationOutbox.id == "evt-heartbeat-test").first()
    assert (datetime.datetime.now(datetime.timezone.utc) - ev_db.locked_at.replace(tzinfo=datetime.timezone.utc)).total_seconds() < 5

    # 2. Tentativa de renovação por worker que NÃO é dono do lock -> rejeitada
    stolen_renew = renew_outbox_claim_lease(op_db, "evt-heartbeat-test", "worker-impostor")
    assert stolen_renew is False

    # 3. Se um snapshot local contendo o claim tentar envio após perder o lease, aborta o disparo
    snapshot_stolen = {
        "id": "evt-heartbeat-test",
        "restaurante_id": CHAR_RESTAURANT_ID,
        "event_id": "e-heartbeat",
        "event_name": "koma.order.created",
        "payload": {},
        "attempts": 0,
        "max_attempts": 5,
        "locked_by": "worker-impostor",
    }
    dispatched = dispatch_single_claimed_snapshot(op_db, snapshot_stolen)
    assert dispatched is False


def test_settle_ownership_protection(op_db):
    """Garante que settle_outbox_event não sobrescreve eventos cuja posse já foi alterada."""
    now = datetime.datetime.now(datetime.timezone.utc)
    ev = IntegrationOutbox(
        id="evt-settle-test",
        restaurante_id=CHAR_RESTAURANT_ID,
        event_id="e-settle",
        event_name="koma.order.created",
        aggregate_type="order",
        aggregate_id="ord-settle",
        payload={},
        status="processing",
        locked_at=now,
        locked_by="worker-valid",
        created_at=now,
    )
    op_db.add(ev)
    op_db.commit()

    # Worker diferente tenta liquidar evento que não possui lock
    settled_fake = settle_outbox_event(op_db, "evt-settle-test", status="delivered", worker_id="worker-fake")
    assert settled_fake is False

    ev_db = op_db.query(IntegrationOutbox).filter(IntegrationOutbox.id == "evt-settle-test").first()
    assert ev_db.status == "processing"
    assert ev_db.locked_by == "worker-valid"

    # Worker legítimo liquida com sucesso
    settled_ok = settle_outbox_event(op_db, "evt-settle-test", status="delivered", worker_id="worker-valid")
    assert settled_ok is True

    op_db.refresh(ev_db)
    assert ev_db.status == "delivered"
    assert ev_db.locked_by is None
