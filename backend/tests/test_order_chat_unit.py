from __future__ import annotations

import datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.models import PublicRateLimit, Categoria, Cliente, Comanda, Item, Lancamento, Produto, Restaurante, Usuario
from app.order_chat_models import OrderConversation, OrderMessage
from app.routes.caixa_chat import router as caixa_chat_router
from app.routes.order_tracking import router as order_tracking_router
from app.security import create_access_token
from app.session_models import UserSessionVersion
from app.services.order_chat_hub import order_chat_hub
from app.services.order_chat_service import (
    LEGACY_ESCAPED_BODY_FORMAT,
    PLAIN_TEXT_BODY_FORMAT,
    create_conversation_for_order,
    get_caixa_unread_summary,
    list_caixa_conversations,
    post_system_order_event,
    send_customer_message,
    serialize_message,
)


@pytest.fixture()
def client_and_session():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Restaurante.__table__.create(engine)
    Usuario.__table__.create(engine)
    UserSessionVersion.__table__.create(engine)
    Cliente.__table__.create(engine)
    Categoria.__table__.create(engine)
    Produto.__table__.create(engine)
    Comanda.__table__.create(engine)
    Lancamento.__table__.create(engine)
    Item.__table__.create(engine)
    OrderConversation.__table__.create(engine)
    OrderMessage.__table__.create(engine)
    PublicRateLimit.__table__.create(engine)

    SessionTesting = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionTesting()

    test_app = FastAPI()
    test_app.include_router(order_tracking_router)
    test_app.include_router(caixa_chat_router)

    def override_get_db():
        db = SessionTesting()
        try:
            yield db
        finally:
            db.close()

    test_app.dependency_overrides[get_db] = override_get_db
    client = TestClient(test_app)

    yield client, session

    session.close()
    engine.dispose()


def _seed_data(db):
    rest_a = Restaurante(id=1, nome="Bistrô Alpha", plano="pro", slug="bistro-alpha")
    rest_b = Restaurante(id=2, nome="Bistrô Beta", plano="pro", slug="bistro-beta")
    db.add_all([rest_a, rest_b])
    db.flush()

    user_a = Usuario(
        id=10,
        restaurante_id=1,
        nome="Operador Alpha",
        email="op.alpha@example.com",
        cargo="caixa",
        status="ativo",
    )
    user_b = Usuario(
        id=20,
        restaurante_id=2,
        nome="Operador Beta",
        email="op.beta@example.com",
        cargo="caixa",
        status="ativo",
    )
    db.add_all([user_a, user_b])
    db.flush()

    comanda_a = Comanda(
        id="comanda-101",
        restaurante_id=1,
        garcom_id="10",
        numero_pedido=1048,
        tipo="Delivery",
        delivery_status="pendente",
        idempotency_key="idemp-key-101",
    )
    comanda_b = Comanda(
        id="comanda-201",
        restaurante_id=2,
        garcom_id="20",
        numero_pedido=2001,
        tipo="Retirada",
        delivery_status="pendente",
        idempotency_key="idemp-key-201",
    )
    db.add_all([comanda_a, comanda_b])
    db.flush()

    cat = Categoria(id=1, restaurante_id=1, nome="Pratos Principais")
    db.add(cat)
    db.flush()

    prod = Produto(id=1, restaurante_id=1, categoria_id=1, nome="Risoto Trufado", preco=85.50)
    db.add(prod)
    db.flush()

    lanc = Lancamento(
        id="lanc-101",
        restaurante_id=1,
        comanda_id="comanda-101",
        garcom_id="10",
        origem="cardapio",
        status="pendente",
    )
    db.add(lanc)
    db.flush()

    item = Item(
        id="item-101",
        restaurante_id=1,
        comanda_id="comanda-101",
        lancamento_id="lanc-101",
        produto_id="1",
        preco_unit=85.50,
    )
    db.add(item)
    db.commit()

    return rest_a, rest_b, user_a, user_b, comanda_a, comanda_b


def _staff_headers(user: Usuario) -> dict[str, str]:
    token = create_access_token(subject=str(user.id), restaurante_id=user.restaurante_id, role="caixa")
    return {"Authorization": f"Bearer {token}"}


def test_create_conversation_is_unique_per_order(client_and_session):
    _client, session = client_and_session
    _seed_data(session)

    conv1, token1 = create_conversation_for_order(session, 1, "comanda-101")
    assert conv1 is not None
    assert token1 is not None
    assert len(token1) >= 32
    assert conv1.pedido_id == "comanda-101"
    assert conv1.restaurante_id == 1

    conv2, token2 = create_conversation_for_order(session, 1, "comanda-101")
    assert conv2.id == conv1.id
    assert token2 is None

    # Status inicial pertence ao pedido, não é forçado como mensagem de chat.
    msgs = session.query(OrderMessage).filter(OrderMessage.conversation_id == conv1.id).all()
    assert msgs == []


def test_public_tracking_resolution_and_anti_enumeration(client_and_session):
    client, session = client_and_session
    _seed_data(session)
    _conv, raw_token = create_conversation_for_order(session, 1, "comanda-101")
    session.commit()

    resp = client.get(f"/api/cardapio/pedidos/acompanhar/{raw_token}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "comanda-101"
    assert data["numero_pedido"] == 1048
    assert data["status"] == "pendente"
    assert data["tipo"] == "Delivery"
    assert data["total"] == 85.50
    assert len(data["itens"]) == 1
    assert data["itens"][0]["nome"] == "Risoto Trufado"
    assert data["restaurante"]["nome"] == "Bistrô Alpha"

    resp_invalid = client.get("/api/cardapio/pedidos/acompanhar/invalid-token-123456789")
    assert resp_invalid.status_code == 404
    assert resp_invalid.json()["detail"] == "Pedido não encontrado."

    resp_enum = client.get("/api/cardapio/pedidos/acompanhar/comanda-101")
    assert resp_enum.status_code == 404
    resp_enum_num = client.get("/api/cardapio/pedidos/acompanhar/1048")
    assert resp_enum_num.status_code == 404


def test_chat_messaging_bidirectional_and_read_tracking(client_and_session):
    client, session = client_and_session
    _rest_a, _rest_b, user_a, _user_b, _comanda_a, _comanda_b = _seed_data(session)
    conv, raw_token = create_conversation_for_order(session, 1, "comanda-101")
    session.commit()
    headers_staff = _staff_headers(user_a)

    resp_client_msg = client.post(
        f"/api/cardapio/pedidos/acompanhar/{raw_token}/messages",
        json={"body": "Olá! Poderia caprichar no queijo, por favor?"},
    )
    assert resp_client_msg.status_code == 200
    msg_data = resp_client_msg.json()
    assert msg_data["sender_type"] == "customer"
    assert "queijo" in msg_data["body"]

    resp_caixa_list = client.get("/api/caixa/conversas", headers=headers_staff)
    assert resp_caixa_list.status_code == 200
    conversas = resp_caixa_list.json()
    assert len(conversas) == 1
    assert conversas[0]["id"] == conv.id
    assert conversas[0]["numero_pedido"] == 1048
    assert conversas[0]["unread_count"] == 1
    assert conversas[0]["last_message"]["sender_type"] == "customer"

    resp_badge = client.get("/api/caixa/conversas/unread-count", headers=headers_staff)
    assert resp_badge.status_code == 200
    assert resp_badge.json()["total_unread"] == 1

    resp_caixa_msgs = client.get(f"/api/caixa/conversas/{conv.id}/messages", headers=headers_staff)
    assert resp_caixa_msgs.status_code == 200
    assert len(resp_caixa_msgs.json()) == 1

    resp_read = client.post(f"/api/caixa/conversas/{conv.id}/read", headers=headers_staff)
    assert resp_read.status_code == 200
    resp_badge_after = client.get("/api/caixa/conversas/unread-count", headers=headers_staff)
    assert resp_badge_after.json()["total_unread"] == 0

    resp_reply = client.post(
        f"/api/caixa/conversas/{conv.id}/messages",
        headers=headers_staff,
        json={"body": "Com certeza! Já avisamos a cozinha."},
    )
    assert resp_reply.status_code == 200
    assert resp_reply.json()["sender_type"] == "staff"

    resp_client_msgs = client.get(f"/api/cardapio/pedidos/acompanhar/{raw_token}/messages")
    assert resp_client_msgs.status_code == 200
    msgs = resp_client_msgs.json()
    assert len(msgs) == 2
    assert msgs[-1]["sender_type"] == "staff"
    assert "avisamos a cozinha" in msgs[-1]["body"]


def test_terminal_status_closes_chat_without_persisting_status_as_message(client_and_session):
    client, session = client_and_session
    _rest_a, _rest_b, user_a, _user_b, _comanda_a, _comanda_b = _seed_data(session)
    conv, raw_token = create_conversation_for_order(session, 1, "comanda-101")
    session.commit()
    headers_staff = _staff_headers(user_a)

    customer_message = client.post(
        f"/api/cardapio/pedidos/acompanhar/{raw_token}/messages",
        json={"body": "Mensagem antes do encerramento", "client_message_id": "customer-terminal-1"},
    )
    assert customer_message.status_code == 200
    assert get_caixa_unread_summary(session, 1) == 1

    for status_name in ("producao", "pronto", "transito"):
        payload = post_system_order_event(session, 1, "comanda-101", status_name)
        session.commit()
        assert payload is not None
        assert payload["status"] == status_name

    before_close = datetime.datetime.now(datetime.timezone.utc)
    payload = post_system_order_event(session, 1, "comanda-101", "finalizado")
    session.commit()
    assert payload is not None
    assert payload["status"] == "finalizado"
    session.refresh(conv)
    assert conv.closed_at is not None
    closed_at = conv.closed_at
    if closed_at.tzinfo is None:
        closed_at = closed_at.replace(tzinfo=datetime.timezone.utc)
    assert closed_at >= before_close - datetime.timedelta(seconds=1)
    assert closed_at <= datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=1)

    # Transições de status nunca poluem a entidade OrderMessage.
    stored_messages = (
        session.query(OrderMessage)
        .filter(OrderMessage.conversation_id == conv.id)
        .all()
    )
    assert len(stored_messages) == 1
    assert stored_messages[0].sender_type == "customer"

    resp_customer = client.post(
        f"/api/cardapio/pedidos/acompanhar/{raw_token}/messages",
        json={"body": "Ainda consigo escrever?", "client_message_id": "customer-terminal-2"},
    )
    assert resp_customer.status_code == 409

    resp_staff = client.post(
        f"/api/caixa/conversas/{conv.id}/messages",
        headers=headers_staff,
        json={"body": "Resposta depois de finalizado", "client_message_id": "staff-terminal-1"},
    )
    assert resp_staff.status_code == 409

    assert list_caixa_conversations(session, 1) == []
    assert get_caixa_unread_summary(session, 1) == 0

    tracking = client.get(f"/api/cardapio/pedidos/acompanhar/{raw_token}")
    assert tracking.status_code == 200
    assert tracking.json()["conversa"]["can_chat"] is False

    history = client.get(f"/api/cardapio/pedidos/acompanhar/{raw_token}/messages")
    assert history.status_code == 200
    assert len(history.json()) == 1


def test_human_message_retry_is_idempotent(client_and_session):
    client, session = client_and_session
    _seed_data(session)
    conv, raw_token = create_conversation_for_order(session, 1, "comanda-101")
    session.commit()

    payload = {
        "body": "Pode mandar sem cebola?",
        "client_message_id": "customer-retry-001",
    }
    first = client.post(
        f"/api/cardapio/pedidos/acompanhar/{raw_token}/messages",
        json=payload,
    )
    second = client.post(
        f"/api/cardapio/pedidos/acompanhar/{raw_token}/messages",
        json=payload,
    )
    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]

    persisted = (
        session.query(OrderMessage)
        .filter(
            OrderMessage.conversation_id == conv.id,
            OrderMessage.client_message_id == "customer-retry-001",
        )
        .all()
    )
    assert len(persisted) == 1


def test_local_realtime_is_emitted_only_after_commit(client_and_session, monkeypatch):
    _client, session = client_and_session
    _seed_data(session)
    conv, _raw_token = create_conversation_for_order(session, 1, "comanda-101")
    session.commit()

    emitted: list[tuple[int, str, str, dict]] = []

    def capture(restaurante_id, conversation_id, event_type, data):
        emitted.append((restaurante_id, conversation_id, event_type, data))

    monkeypatch.setattr(order_chat_hub, "publish_event", capture)

    send_customer_message(
        session,
        restaurante_id=1,
        conversation_id=conv.id,
        pedido_id="comanda-101",
        raw_body="Commit primeiro, realtime depois.",
        client_message_id="commit-safe-001",
    )
    assert emitted == []

    session.commit()
    assert len(emitted) == 1
    assert emitted[0][0:3] == (1, conv.id, "message")
    assert emitted[0][3]["message_id"]

    send_customer_message(
        session,
        restaurante_id=1,
        conversation_id=conv.id,
        pedido_id="comanda-101",
        raw_body="Esta mensagem sofrerá rollback.",
        client_message_id="rollback-safe-001",
    )
    session.rollback()
    assert len(emitted) == 1

def test_message_body_is_plain_text_and_legacy_rows_are_decoded_at_boundary(client_and_session):
    client, session = client_and_session
    _seed_data(session)
    conv, raw_token = create_conversation_for_order(session, 1, "comanda-101")
    session.commit()

    xss_payload = "<script>alert('xss')</script><b>Negrito</b> & café"
    resp = client.post(
        f"/api/cardapio/pedidos/acompanhar/{raw_token}/messages",
        json={"body": xss_payload},
    )
    assert resp.status_code == 200
    assert resp.json()["body"] == xss_payload

    persisted = (
        session.query(OrderMessage)
        .filter(OrderMessage.id == resp.json()["id"])
        .one()
    )
    assert persisted.body == xss_payload
    assert persisted.body_format == PLAIN_TEXT_BODY_FORMAT

    legacy = OrderMessage(
        id="legacy-message-1",
        restaurante_id=1,
        conversation_id=conv.id,
        pedido_id="comanda-101",
        sender_type="staff",
        body="5 &lt; 7 &amp; café",
        body_format=LEGACY_ESCAPED_BODY_FORMAT,
        created_at=datetime.datetime.now(datetime.timezone.utc),
    )
    session.add(legacy)
    session.commit()
    assert serialize_message(legacy)["body"] == "5 < 7 & café"

    resp_empty = client.post(
        f"/api/cardapio/pedidos/acompanhar/{raw_token}/messages",
        json={"body": "    "},
    )
    assert resp_empty.status_code == 422
    resp_huge = client.post(
        f"/api/cardapio/pedidos/acompanhar/{raw_token}/messages",
        json={"body": "A" * 1001},
    )
    assert resp_huge.status_code == 422


def test_tenant_isolation_staff_cannot_access_other_tenant_conversation(client_and_session):
    client, session = client_and_session
    _rest_a, _rest_b, user_a, _user_b, _comanda_a, _comanda_b = _seed_data(session)
    _conv_a, _token_a = create_conversation_for_order(session, 1, "comanda-101")
    conv_b, _token_b = create_conversation_for_order(session, 2, "comanda-201")
    session.commit()
    headers_a = _staff_headers(user_a)

    resp = client.get(f"/api/caixa/conversas/{conv_b.id}/messages", headers=headers_a)
    assert resp.status_code == 404
    resp_reply = client.post(
        f"/api/caixa/conversas/{conv_b.id}/messages",
        headers=headers_a,
        json={"body": "Invasão indevida"},
    )
    assert resp_reply.status_code == 404


def test_any_existing_closed_at_is_read_only_for_customer_and_staff(client_and_session):
    client, session = client_and_session
    _rest_a, _rest_b, user_a, _user_b, _comanda_a, _comanda_b = _seed_data(session)
    conv, raw_token = create_conversation_for_order(session, 1, "comanda-101")
    # Compatibilidade: versões antigas agendavam closed_at duas horas no futuro.
    # Qualquer closed_at existente agora significa histórico read-only.
    conv.closed_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=2)
    session.commit()
    headers_staff = _staff_headers(user_a)

    resp_customer = client.post(
        f"/api/cardapio/pedidos/acompanhar/{raw_token}/messages",
        json={"body": "Ainda posso alterar o pedido?"},
    )
    assert resp_customer.status_code == 409
    assert "encerrado" in resp_customer.json()["detail"].lower()

    resp_staff = client.post(
        f"/api/caixa/conversas/{conv.id}/messages",
        headers=headers_staff,
        json={"body": "Ainda posso responder?"},
    )
    assert resp_staff.status_code == 409
    assert "encerrado" in resp_staff.json()["detail"].lower()
