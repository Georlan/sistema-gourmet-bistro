from __future__ import annotations

from pathlib import Path
import os
import pytest
from sqlalchemy import text


MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic/versions/fc3d4e5f6a7b_add_saas_billing_foundation.py"
)


def _migration_source() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def test_saas_billing_setups_zero_direct_grants_to_koma_app():
    source = _migration_source()
    assert "REVOKE ALL ON TABLE public.saas_billing_setups FROM PUBLIC;" in source
    assert "REVOKE ALL ON TABLE public.saas_billing_setups FROM koma_app;" in source
    # Não pode haver GRANT SELECT, INSERT, UPDATE on saas_billing_setups TO koma_app
    assert "GRANT SELECT ON TABLE public.saas_billing_setups TO koma_app" not in source
    assert "GRANT INSERT ON TABLE public.saas_billing_setups TO koma_app" not in source
    assert "GRANT UPDATE ON TABLE public.saas_billing_setups TO koma_app" not in source
    assert "GRANT ALL ON TABLE public.saas_billing_setups TO koma_app" not in source


def test_saas_subscriptions_strict_rls_policies():
    source = _migration_source()
    assert "ALTER TABLE public.saas_subscriptions ENABLE ROW LEVEL SECURITY" in source
    assert "ALTER TABLE public.saas_subscriptions FORCE ROW LEVEL SECURITY" in source
    assert "GRANT SELECT, INSERT, UPDATE ON TABLE public.saas_subscriptions TO koma_app;" in source
    assert "CREATE POLICY saas_subscriptions_select" in source
    assert "CREATE POLICY saas_subscriptions_insert" in source
    assert "CREATE POLICY saas_subscriptions_update" in source
    assert "app.current_restaurante_id" in source
    assert "koma.current_restaurante_id" not in source


def test_koma_internal_security_definer_functions_defined_and_granted():
    source = _migration_source()
    functions = [
        "list_contract_acceptances_for_admin",
        "resolve_contract_acceptance_for_activation",
        "get_saas_billing_setup",
        "get_saas_billing_setup_by_provider_sub",
        "link_saas_billing_setup_to_tenant",
        "upsert_saas_billing_setup",
    ]
    for fn in functions:
        assert f"koma_internal.{fn}" in source
        assert f"SECURITY DEFINER" in source
        assert f"GRANT EXECUTE ON FUNCTION koma_internal.{fn}" in source
        assert f"REVOKE ALL ON FUNCTION koma_internal.{fn}" in source


def test_downgrade_restores_prior_function_signatures_and_drops_policies():
    source = _migration_source()
    assert "DROP POLICY IF EXISTS saas_subscriptions_update" in source
    assert "DROP POLICY IF EXISTS saas_subscriptions_insert" in source
    assert "DROP POLICY IF EXISTS saas_subscriptions_select" in source
    assert "DROP FUNCTION IF EXISTS koma_internal.get_saas_billing_setup" in source
    assert "DROP FUNCTION IF EXISTS koma_internal.link_saas_billing_setup_to_tenant" in source
    assert "DROP FUNCTION IF EXISTS koma_internal.upsert_saas_billing_setup" in source
    assert "DROP FUNCTION IF EXISTS koma_internal.get_saas_billing_setup_by_provider_sub" in source
    # Confirma restauração da assinatura original de 24 colunas de list_contract_acceptances_for_admin
    assert "DROP FUNCTION IF EXISTS koma_internal.list_contract_acceptances_for_admin(integer);" in source
    # Confirma restauração da assinatura original de 11 colunas de resolve_contract_acceptance_for_activation
    assert "DROP FUNCTION IF EXISTS koma_internal.resolve_contract_acceptance_for_activation(text);" in source


@pytest.mark.skipif(
    os.getenv("KOMA_PYTEST_USE_EXTERNAL_DATABASE", "false").lower() != "true",
    reason="Teste dinâmico de RLS/grants exige PostgreSQL real configurado",
)
def test_postgres_runtime_koma_app_permission_denied_on_direct_billing_setups():
    from app.database import SessionLocal

    with SessionLocal() as db:
        db.execute(text("SET ROLE koma_app"))
        try:
            # Tenta executar SELECT direto na tabela saas_billing_setups como koma_app -> Deve falhar com PermissionDenied
            with pytest.raises(Exception) as excinfo:
                db.execute(text("SELECT * FROM public.saas_billing_setups LIMIT 1"))
            assert "permission denied" in str(excinfo.value).lower()
            db.rollback()

            db.execute(text("SET ROLE koma_app"))
            # Já a leitura via SECURITY DEFINER deve funcionar
            rows = db.execute(
                text("SELECT * FROM koma_internal.get_saas_billing_setup('NONEXISTENT')")
            ).mappings().all()
            assert rows == []
        finally:
            db.rollback()
            db.execute(text("RESET ROLE"))
