"""Testes PostgreSQL reais de isolamento tenant para dados sensíveis por pedido."""

from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import create_engine, text

from app.application.orders.commands import DeliveryAddressInput
from app.database import SessionLocal, tenant_session_scope
from app.delivery_address_snapshot import (
    ComandaDeliveryAddressSnapshot,
    persist_delivery_address_snapshot,
)
from app.models import Comanda, Restaurante, Usuario
from app.order_chat_models import OrderConversation, OrderMessage

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
                db.add(
                    Usuario(
                        id="chat-rls-staff-a",
                        restaurante_id=TENANT_A,
                        nome="Staff A",
                        cargo="caixa",
                        role="caixa",
                        status="ativo",
                    )
                )
                db.flush()
                db.add(
                    Comanda(
                        id="comanda-rls-a",
                        restaurante_id=TENANT_A,
                        garcom_id="chat-rls-staff-a",
                        numero_pedido=101,
                        tipo="Delivery",
                    )
                )
                db.flush()
            db.commit()

        with tenant_session_scope(db, TENANT_B):
            if not db.query(Restaurante).filter(Restaurante.id == TENANT_B).first():
                db.add(Restaurante(id=TENANT_B, nome="Restaurante RLS B", slug="rls-b"))
                db.flush()
                db.add(
                    Usuario(
                        id="chat-rls-staff-b",
                        restaurante_id=TENANT_B,
                        nome="Staff B",
                        cargo="caixa",
                        role="caixa",
                        status="ativo",
                    )
                )
                db.flush()
                db.add(
                    Comanda(
                        id="comanda-rls-b",
                        restaurante_id=TENANT_B,
                        garcom_id="chat-rls-staff-b",
                        numero_pedido=201,
                        tipo="Retirada",
                    )
                )
                db.flush()
            db.commit()


def test_postgres_tenant_tables_have_rls_or_no_direct_runtime_access():
    """Falha se uma tabela ligada a restaurante ficar exposta sem isolamento.

    O KÔMA possui dois modelos legítimos de segurança para tabelas que carregam
    ``restaurante_id``:

    * tabelas tenant-owned: ENABLE + FORCE RLS e policy tenant-aware para o
      runtime ``koma_app``;
    * tabelas de control-plane/pré-tenant: nenhum acesso DML direto para
      ``koma_app``/PUBLIC, sendo acessadas apenas por superfícies privilegiadas
      estreitas (por exemplo, funções SECURITY DEFINER).

    Assim o gate detecta novas tabelas expostas sem exigir RLS de objetos que,
    por desenho, nem sequer são consultáveis diretamente pelo runtime.
    """

    admin_url = os.environ["MIGRATION_DATABASE_URL"]
    engine = create_engine(admin_url, pool_pre_ping=True)
    try:
        with engine.connect() as conn:
            tables = conn.execute(
                text(
                    """
                    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
                    FROM pg_class AS c
                    JOIN pg_namespace AS n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public'
                      AND c.relkind = 'r'
                      AND EXISTS (
                          SELECT 1
                          FROM information_schema.columns AS col
                          WHERE col.table_schema = 'public'
                            AND col.table_name = c.relname
                            AND col.column_name = 'restaurante_id'
                      )
                    ORDER BY c.relname
                    """
                )
            ).all()
            assert tables, "nenhuma tabela ligada a restaurante encontrada"

            policy_rows = conn.execute(
                text(
                    """
                    SELECT tablename,
                           roles::text,
                           lower(
                               coalesce(qual, '') || ' ' || coalesce(with_check, '')
                           ) AS expressions
                    FROM pg_policies
                    WHERE schemaname = 'public'
                    ORDER BY tablename, policyname
                    """
                )
            ).all()
            policies_by_table: dict[str, list[tuple[str, str]]] = {}
            for table, roles, expressions in policy_rows:
                policies_by_table.setdefault(table, []).append((roles, expressions))

            grant_rows = conn.execute(
                text(
                    """
                    SELECT table_name, grantee, privilege_type
                    FROM information_schema.role_table_grants
                    WHERE table_schema = 'public'
                      AND grantee IN ('koma_app', 'PUBLIC')
                      AND privilege_type IN (
                          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'
                      )
                    ORDER BY table_name, grantee, privilege_type
                    """
                )
            ).all()
            grants_by_table: dict[str, dict[str, set[str]]] = {}
            for table, grantee, privilege in grant_rows:
                grants_by_table.setdefault(table, {}).setdefault(grantee, set()).add(
                    privilege
                )

            errors: list[str] = []
            for table, enabled, forced in tables:
                grants = grants_by_table.get(table, {})
                runtime_grants = grants.get("koma_app", set())
                public_grants = grants.get("PUBLIC", set())

                if enabled != forced:
                    errors.append(
                        f"{table}: RLS inconsistente enabled={enabled} forced={forced}"
                    )
                    continue

                if not enabled:
                    if runtime_grants or public_grants:
                        errors.append(
                            f"{table}: sem RLS mas exposta; "
                            f"koma_app={sorted(runtime_grants)} "
                            f"PUBLIC={sorted(public_grants)}"
                        )
                    continue

                # Se o runtime possui acesso direto, pelo menos uma policy para
                # koma_app deve ser explicitamente tenant-aware e fail-scoped.
                if runtime_grants:
                    policies = policies_by_table.get(table, [])
                    has_tenant_policy = any(
                        "koma_app" in roles
                        and "restaurante_id" in expressions
                        and "current_setting" in expressions
                        for roles, expressions in policies
                    )
                    if not has_tenant_policy:
                        errors.append(
                            f"{table}: RLS ativo com grants ao koma_app, "
                            "mas sem policy tenant-aware"
                        )

                if public_grants:
                    errors.append(
                        f"{table}: DML tenant exposto a PUBLIC={sorted(public_grants)}"
                    )

            assert not errors, "; ".join(errors)
    finally:
        engine.dispose()


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
            assert all(c.restaurante_id == TENANT_B for c in conversas_visiveis_b)
            assert not any(c.id == conv_a.id for c in conversas_visiveis_b)

            mensagens_visiveis_b = db.query(OrderMessage).all()
            assert all(m.restaurante_id == TENANT_B for m in mensagens_visiveis_b)
            assert not any(m.id == msg_a.id for m in mensagens_visiveis_b)


def test_postgres_rls_delivery_address_snapshot_isolated_between_tenants():
    """PII do endereço precisa continuar isolada mesmo sem filtro na consulta ORM."""

    _seed_tenants()
    address = DeliveryAddressInput(
        street="Rua Privada A",
        number="123",
        neighborhood="Centro",
        city="Fortaleza",
        state="CE",
        postal_code="60000000",
        complement="Apto 10",
        reference="Portaria lateral",
    )

    with SessionLocal() as db:
        with tenant_session_scope(db, TENANT_A):
            persist_delivery_address_snapshot(
                db,
                restaurante_id=TENANT_A,
                comanda_id="comanda-rls-a",
                address=address,
            )
            db.commit()

            own_snapshot = (
                db.query(ComandaDeliveryAddressSnapshot)
                .filter(ComandaDeliveryAddressSnapshot.comanda_id == "comanda-rls-a")
                .one()
            )
            assert own_snapshot.restaurante_id == TENANT_A

        with tenant_session_scope(db, TENANT_B):
            # Intencionalmente sem restaurante_id no filtro: PostgreSQL deve barrar.
            leaked = (
                db.query(ComandaDeliveryAddressSnapshot)
                .filter(ComandaDeliveryAddressSnapshot.comanda_id == "comanda-rls-a")
                .all()
            )
            assert leaked == []

            raw_count = db.execute(
                text(
                    """
                    SELECT count(*)
                    FROM public.comanda_delivery_address_snapshots
                    WHERE comanda_id = 'comanda-rls-a'
                    """
                )
            ).scalar_one()
            assert raw_count == 0
