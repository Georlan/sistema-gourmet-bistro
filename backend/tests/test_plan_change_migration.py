from __future__ import annotations

import importlib.util
from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "g6b7c8d9e0f1_add_saas_plan_changes.py"
)


def _load_migration_module():
    spec = importlib.util.spec_from_file_location("saas_plan_change_migration", MIGRATION)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_plan_change_migration_extends_current_contract_authority_head():
    mod = _load_migration_module()
    assert mod.revision == "g6b7c8d9e0f1"
    assert mod.down_revision == "f5a6b7c8d9e0"


def test_plan_change_migration_is_tenant_scoped_and_fail_closed():
    source = MIGRATION.read_text(encoding="utf-8")
    assert 'op.create_table(\n        "saas_plan_changes"' in source
    assert "ALTER TABLE public.saas_plan_changes ENABLE ROW LEVEL SECURITY" in source
    assert "ALTER TABLE public.saas_plan_changes FORCE ROW LEVEL SECURITY" in source
    assert "GRANT SELECT, INSERT, UPDATE ON TABLE public.saas_plan_changes TO koma_app" in source
    assert "GRANT DELETE" not in source
    assert "current_setting('app.current_restaurante_id', true)" in source
    assert "uq_saas_plan_changes_one_active_per_tenant" in source
    assert "status IN ('pending', 'provider_syncing', 'provider_synced')" in source


def test_plan_change_acceptance_owner_helper_exposes_only_tenant_id():
    source = MIGRATION.read_text(encoding="utf-8")
    assert "koma_internal.plan_change_owner_for_acceptance" in source
    assert "RETURNS integer" in source
    assert "SECURITY DEFINER" in source
    assert "SET search_path = pg_catalog" in source
    assert "SELECT c.restaurante_id" in source
    assert "WHERE c.acceptance_id = p_acceptance_id" in source
    assert (
        "REVOKE ALL ON FUNCTION koma_internal.plan_change_owner_for_acceptance(text) FROM PUBLIC"
        in source
    )
    assert (
        "GRANT EXECUTE ON FUNCTION koma_internal.plan_change_owner_for_acceptance(text) TO koma_app"
        in source
    )
