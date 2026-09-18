from __future__ import annotations

import importlib.util
from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "e4f5a6b7c8d9_expose_tenant_contract_snapshots.py"
)


def _load_migration_module():
    spec = importlib.util.spec_from_file_location("contract_snapshot_migration", MIGRATION)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_contract_snapshot_migration_is_linear_from_current_head():
    mod = _load_migration_module()
    assert mod.revision == "e4f5a6b7c8d9"
    assert mod.down_revision == "d3e4f5a6b7c8"


def test_contract_snapshot_function_remains_tenant_scoped_and_execute_only():
    source = MIGRATION.read_text(encoding="utf-8")
    assert "current_contract_documents()" in source
    assert "current_setting('app.current_restaurante_id', true)" in source
    assert "SECURITY DEFINER" in source
    assert "SET search_path = pg_catalog" in source
    assert "REVOKE ALL ON FUNCTION koma_internal.current_contract_documents() FROM PUBLIC" in source
    assert "GRANT EXECUTE ON FUNCTION koma_internal.current_contract_documents() TO koma_app" in source
    assert "GRANT SELECT ON TABLE public.contract_acceptances" not in source
    assert "UPDATE public.contract_acceptances" not in source
    assert "DELETE FROM public.contract_acceptances" not in source
