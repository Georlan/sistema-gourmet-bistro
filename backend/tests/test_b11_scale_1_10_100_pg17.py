from __future__ import annotations

import os
from urllib.parse import urlparse

import pytest
from sqlalchemy import create_engine, text


def _pg_url() -> str | None:
    url = os.getenv("KOMA_B11_PG17_TEST_URL") or os.getenv("DATABASE_URL") or ""
    if not url.startswith(("postgresql://", "postgres://")):
        return None
    host = (urlparse(url).hostname or "").lower()
    if host not in {"127.0.0.1", "localhost", "::1"}:
        return None
    return url


def test_b11_pg17_zero_non_initplan_policies_and_hotpath_indexes():
    url = _pg_url()
    if not url:
        pytest.skip("Defina DATABASE_URL/KOMA_B11_PG17_TEST_URL para PostgreSQL local.")

    engine = create_engine(url, future=True)
    try:
        with engine.connect() as conn:
            non_initplan = conn.execute(
                text(
                    """
                    SELECT tablename, policyname
                    FROM pg_policies
                    WHERE schemaname = 'public'
                      AND (
                        (qual IS NOT NULL AND qual ~ 'current_setting\\(' AND qual !~ '\\( SELECT current_setting\\(')
                        OR (with_check IS NOT NULL AND with_check ~ 'current_setting\\(' AND with_check !~ '\\( SELECT current_setting\\(')
                      )
                    """
                )
            ).all()
            assert non_initplan == [], f"Policies RLS sem InitPlan: {non_initplan}"

            indexes = {
                row[0]
                for row in conn.execute(
                    text("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")
                ).all()
            }
            for required in (
                "ix_print_agent_tokens_token_hash",
                "ix_comandas_tenant_open_delivery_status",
                "ix_online_payment_intents_reconcile_due",
                "ix_crm_contatos_tenant_criado",
                "ix_image_retirement_pending_due",
            ):
                assert required in indexes, f"Índice obrigatório ausente: {required}"

            for dropped in (
                "ix_contract_invites_token_hash",
                "ix_contract_invites_restaurante_id",
                "ix_cardapios_tenant",
            ):
                assert dropped not in indexes, f"Índice redundante ainda presente: {dropped}"
    finally:
        engine.dispose()
