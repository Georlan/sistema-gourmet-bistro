"""Testes de isolamento PostgreSQL RLS para order_conversations e order_messages."""

from __future__ import annotations

import os
import uuid
import pytest
from sqlalchemy import text

from app.database import SessionLocal, tenant_session_scope
from app.models import Comanda, Restaurante
from app.order_chat_models import OrderConversation, OrderMessage
from app.security import create_access_token

TENANT_A = 9401
TENANT_B = 9402

pytestmark = pytest.mark.skipif(
    os.getenv("KOMA_PYTEST_USE_EXTERNAL_DATABASE", "false").lower() != "true",
    reason="Regressão RLS exige o PostgreSQL efêmero do quality gate.",
)


def _seed_tenants():
    with SessionLocal() as db:
        # Cria Restaurante A e B
        with tenant_session_scope(db, TENANT_A):
            if not db.query(Restaurante).filter(Restaurante.id == TENANT_A).first():
                db.add(Restaurante(id=TENANT_A, nome="Restaurante RLS A", slug="rls-a"))
                db.flush()
                db.add(Comanda(id="comanda-rls-a", restaurante_id=TENANT_A, numero_pedido=101, tipo="Delivery"))
                db.flush()
            db.commit()

        with tenant_session_scope(db, TENANT_B):
            if not db.query(Restaurante).filter(Restaurante.id == TENANT_B).first():
                db.add(Restaurante(id=TENANT_B, nome="Restaurante RLS B", slug="rls-b"))
                db.flush()
                db.add(Comanda(id="comanda-rls-b", restaurante_id=TENANT_B, numero_pedido=201, tipo="Retirada"))
                db.flush()
            db.commit()


def test_postgres_rls_tenant_cannot_query_other_tenant_conversations_or_messages():
    _seed_tenants()

    with SessionLocal() as db:
        # Tenant A cria conversa e mensagem
        with tenant_session_scope(db, TENANT_A):
            conv_a = OrderConversation(
                id=str(uuid.uuid4()),
                restaurante_id=TENANT_A,
                pedido_id="comanda-rls-a",
                public_access_token_hash="hash-rls-tenant-a-1234567890",
            )
            db.add(conv_a)
            db.flush()

            msg_a = OrderMessage(
                id=str(uuid.uuid4()),
                restaurante_id=TENANT_A,
                conversation_id=conv_a.id,
                pedido_id="comanda-rls-a",
                sender_type="customer",
                body="Mensagem confidencial do Tenant A",
            )
            db.add(msg_a)
            db.commit()

        # Tenant B tenta consultar order_conversations sob sua sessão RLS
        with tenant_session_scope(db, TENANT_B):
            conversas_visiveis_b = db.query(OrderConversation).all()
            # Tenant B jamais pode ver a conversa de Tenant A
            assert all(c.restaurante_id == TENANT_B for c in conversas_visiveis_b)
            assert not any(c.id == conv_a.id for c in conversas_visiveis_b)

            # Tenant B tenta consultar mensagens sob sua sessão RLS
            mensagens_visiveis_b = db.query(OrderMessage).all()
            assert all(m.restaurante_id == TENANT_B for m in mensagens_visiveis_b)
            assert not any(m.id == msg_a.id for m in mensagens_visiveis_b)
