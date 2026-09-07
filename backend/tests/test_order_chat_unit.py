from __future__ import annotations

import datetime
import uuid
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db, tenant_session_scope
from app.models import Categoria, Cliente, Comanda, Item, Lancamento, Produto, Restaurante, Usuario
from app.order_chat_models import OrderConversation, OrderMessage
from app.routes.caixa_chat import router as caixa_chat_router
from app.routes.order_tracking import router as order_tracking_router
from app.security import create_access_token
from app.session_models import UserSessionVersion
from app.services.order_chat_service import (
    create_conversation_for_order,
    get_caixa_unread_summary,
    list_caixa_conversations,
    mark_customer_read,
    mark_staff_read,
    post_system_order_event,
    resolve_public_tracking,
    send_customer_message,
    send_staff_message,
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


def test_create_conversation_is_unique_per_order(client_and_session):
    client, session = client_and_session
    _seed_data(session)

    conv1, token1 = create_conversation_for_order(session, 1, "comanda-101")
    assert conv1 is not None
    assert token1 is not None
    assert len(token1) >= 32
    assert conv1.pedido_id == "comanda-101"
    assert conv1.restaurante_id == 1

    # Segunda tentativa para o mesmo pedido retorna a mesma conversa e token=None
    conv2, token2 = create_conversation_for_order(session, 1, "comanda-101")
    assert conv2.id == conv1.id
    assert token2 is None

    # Mensagem de sistema inicial deve existir
    msgs = session.query(OrderMessage).filter(OrderMessage.conversation_id == conv1.id).all()
    assert len(msgs) == 1
    assert msgs[0].sender_type == "system"
    assert "recebido" in msgs[0].body.lower()


def test_public_tracking_resolution_and_anti_enumeration(client_and_session):
    client, session = client_and_session
    _seed_data(session)
    _conv, raw_token = create_conversation_for_order(session, 1, "comanda-101")
    session.commit()

    # 1. Token válido -> retorna dados públicos do pedido sem expor segredos
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

    # 2. Token inválido -> 404 sem revelar existência do pedido
    resp_invalid = client.get("/api/cardapio/pedidos/acompanhar/invalid-token-123456789")
    assert resp_invalid.status_code == 404
    assert resp_invalid.json()["detail"] == "Pedido não encontrado."

    # 3. Enumeração por ID sequencial ou ID de comanda deve falhar (404)
    resp_enum = client.get("/api/cardapio/pedidos/acompanhar/comanda-101")
    assert resp_enum.status_code == 404

    resp_enum_num = client.get("/api/cardapio/pedidos/acompanhar/1048")
    assert resp_enum_num.status_code == 404


def test_chat_messaging_bidirectional_and_read_tracking(client_and_session):
    client, session = client_and_session
    _rest_a, _rest_b, user_a, _user_b, _comanda_a, _comanda_b = _seed_data(session)
    conv, raw_token = create_conversation_for_order(session, 1, "comanda-101")
    session.commit()

    # Staff token para Caixa (restaurante 1, user_id=10)
    staff_token = create_access_token(subject=str(user_a.id), restaurante_id=1, role="caixa")
    headers_staff = {"Authorization": f"Bearer {staff_token}"}

    # 1. Cliente envia mensagem
    resp_client_msg = client.post(
        f"/api/cardapio/pedidos/acompanhar/{raw_token}/messages",
        json={"body": "Olá! Poderia caprichar no queijo, por favor?"},
    )
    assert resp_client_msg.status_code == 200
    msg_data = resp_client_msg.json()
    assert msg_data["sender_type"] == "customer"
    assert "queijo" in msg_data["body"]

    # 2. Caixa lista conversas e verifica não lida
    resp_caixa_list = client.get("/api/caixa/conversas", headers=headers_staff)
    assert resp_caixa_list.status_code == 200
    conversas = resp_caixa_list.json()
    assert len(conversas) == 1
    assert conversas[0]["id"] == conv.id
    assert conversas[0]["numero_pedido"] == 1048
    assert conversas[0]["unread_count"] == 1
    assert conversas[0]["last_message"]["sender_type"] == "customer"

    # Badge global de não lidas no Caixa
    resp_badge = client.get("/api/caixa/conversas/unread-count", headers=headers_staff)
    assert resp_badge.status_code == 200
    assert resp_badge.json()["total_unread"] == 1

    # 3. Operador do Caixa visualiza mensagens e marca como lida
    resp_caixa_msgs = client.get(f"/api/caixa/conversas/{conv.id}/messages", headers=headers_staff)
    assert resp_caixa_msgs.status_code == 200
    # Inicial de sistema + mensagem do cliente = 2
    assert len(resp_caixa_msgs.json()) == 2

    resp_read = client.post(f"/api/caixa/conversas/{conv.id}/read", headers=headers_staff)
    assert resp_read.status_code == 200

    # Badge zera após leitura da equipe
    resp_badge_after = client.get("/api/caixa/conversas/unread-count", headers=headers_staff)
    assert resp_badge_after.json()["total_unread"] == 0

    # 4. Operador responde ao cliente
    resp_reply = client.post(
        f"/api/caixa/conversas/{conv.id}/messages",
        headers=headers_staff,
        json={"body": "Com certeza! Já avisamos a cozinha."},
    )
    assert resp_reply.status_code == 200
    assert resp_reply.json()["sender_type"] == "staff"

    # 5. Cliente lista mensagens e vê a resposta
    resp_client_msgs = client.get(f"/api/cardapio/pedidos/acompanhar/{raw_token}/messages")
    assert resp_client_msgs.status_code == 200
    msgs = resp_client_msgs.json()
    assert len(msgs) == 3
    assert msgs[-1]["sender_type"] == "staff"
    assert "avisamos a cozinha" in msgs[-1]["body"]


def test_system_status_messages_and_idempotency(client_and_session):
    client, session = client_and_session
    _seed_data(session)
    conv, raw_token = create_conversation_for_order(session, 1, "comanda-101")
    session.commit()

    # 1. Simula transição para 'producao'
    msg1 = post_system_order_event(session, 1, "comanda-101", "producao")
    session.commit()
    assert msg1 is not None
    assert msg1.sender_type == "system"
    assert "preparo" in msg1.body.lower()

    # 2. Retry / idempotência: chamar novamente com 'producao' não duplica a mensagem
    msg1_dup = post_system_order_event(session, 1, "comanda-101", "producao")
    session.commit()
    assert msg1_dup.id == msg1.id

    # 3. Transição para 'pronto'
    msg2 = post_system_order_event(session, 1, "comanda-101", "pronto")
    session.commit()
    assert "pronto" in msg2.body.lower()

    # 4. Transição para 'transito'
    msg3 = post_system_order_event(session, 1, "comanda-101", "transito")
    session.commit()
    assert "saiu para entrega" in msg3.body.lower()

    # 5. Transição para 'finalizado' (define closed_at)
    msg4 = post_system_order_event(session, 1, "comanda-101", "finalizado")
    session.commit()
    assert "concluído" in msg4.body.lower()

    session.refresh(conv)
    assert conv.closed_at is not None

    # Consulta mensagens pelo cliente
    resp = client.get(f"/api/cardapio/pedidos/acompanhar/{raw_token}/messages")
    assert resp.status_code == 200
    msgs = resp.json()
    # order_created + producao + pronto + transito + finalizado = 5 mensagens
    assert len(msgs) == 5


def test_xss_sanitization_and_input_limits(client_and_session):
    client, session = client_and_session
    _seed_data(session)
    _conv, raw_token = create_conversation_for_order(session, 1, "comanda-101")
    session.commit()

    # 1. Mensagem com HTML e script malicioso é escapada
    xss_payload = "<script>alert('xss')</script><b>Negrito</b>"
    resp = client.post(
        f"/api/cardapio/pedidos/acompanhar/{raw_token}/messages",
        json={"body": xss_payload},
    )
    assert resp.status_code == 200
    saved_body = resp.json()["body"]
    assert "<script>" not in saved_body
    assert "&lt;script&gt;" in saved_body
    assert "&lt;b&gt;Negrito&lt;/b&gt;" in saved_body

    # 2. Mensagem vazia ou apenas espaços é rejeitada (422)
    resp_empty = client.post(
        f"/api/cardapio/pedidos/acompanhar/{raw_token}/messages",
        json={"body": "    "},
    )
    assert resp_empty.status_code == 422

    # 3. Mensagem excedendo 1000 caracteres é rejeitada (422)
    resp_huge = client.post(
        f"/api/cardapio/pedidos/acompanhar/{raw_token}/messages",
        json={"body": "A" * 1001},
    )
    assert resp_huge.status_code == 422


def test_tenant_isolation_staff_cannot_access_other_tenant_conversation(client_and_session):
    client, session = client_and_session
    _rest_a, _rest_b, user_a, _user_b, _comanda_a, _comanda_b = _seed_data(session)
    conv_a, _token_a = create_conversation_for_order(session, 1, "comanda-101")
    conv_b, _token_b = create_conversation_for_order(session, 2, "comanda-201")
    session.commit()

    # Operador do Restaurante 1 (Alpha, user_id=10)
    staff_token_a = create_access_token(subject=str(user_a.id), restaurante_id=1, role="caixa")
    headers_a = {"Authorization": f"Bearer {staff_token_a}"}

    # Operador A tenta acessar a conversa do Restaurante 2 (Beta) -> 404
    resp = client.get(f"/api/caixa/conversas/{conv_b.id}/messages", headers=headers_a)
    assert resp.status_code == 404

    # Operador A tenta responder na conversa do Restaurante 2 -> 404
    resp_reply = client.post(
        f"/api/caixa/conversas/{conv_b.id}/messages",
        headers=headers_a,
        json={"body": "Invasão indevida"},
    )
    assert resp_reply.status_code == 404


def test_closed_conversation_rejects_new_customer_messages(client_and_session):
    client, session = client_and_session
    _seed_data(session)
    conv, raw_token = create_conversation_for_order(session, 1, "comanda-101")
    # Força conversa como já encerrada
    conv.closed_at = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=10)
    session.commit()

    resp = client.post(
        f"/api/cardapio/pedidos/acompanhar/{raw_token}/messages",
        json={"body": "Ainda posso alterar o pedido?"},
    )
    assert resp.status_code == 409
    assert "encerrado" in resp.json()["detail"].lower()
