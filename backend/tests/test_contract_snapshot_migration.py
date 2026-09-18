from __future__ import annotations

import importlib.util
from pathlib import Path


SNAPSHOT_MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "e4f5a6b7c8d9_expose_tenant_contract_snapshots.py"
)
AUTHORITY_ORDERING_MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "f5a6b7c8d9e0_deterministic_contract_authority.py"
)


def _load_migration_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_contract_snapshot_migration_is_linear_into_deterministic_authority_head():
    snapshot = _load_migration_module(
        SNAPSHOT_MIGRATION,
        "contract_snapshot_migration",
    )
    authority = _load_migration_module(
        AUTHORITY_ORDERING_MIGRATION,
        "contract_authority_ordering_migration",
    )
    assert snapshot.revision == "e4f5a6b7c8d9"
    assert snapshot.down_revision == "d3e4f5a6b7c8"
    assert authority.revision == "f5a6b7c8d9e0"
    assert authority.down_revision == snapshot.revision


def test_contract_snapshot_function_remains_tenant_scoped_and_execute_only():
    source = SNAPSHOT_MIGRATION.read_text(encoding="utf-8")
    assert "current_contract_documents()" in source
    assert "current_setting('app.current_restaurante_id', true)" in source
    assert "SECURITY DEFINER" in source
    assert "SET search_path = pg_catalog" in source
    assert "REVOKE ALL ON FUNCTION koma_internal.current_contract_documents() FROM PUBLIC" in source
    assert "GRANT EXECUTE ON FUNCTION koma_internal.current_contract_documents() TO koma_app" in source
    assert "GRANT SELECT ON TABLE public.contract_acceptances" not in source
    assert "UPDATE public.contract_acceptances" not in source
    assert "DELETE FROM public.contract_acceptances" not in source


def test_contract_authority_ordering_is_deterministic_and_tenant_scoped():
    source = AUTHORITY_ORDERING_MIGRATION.read_text(encoding="utf-8")
    assert "current_contract_receipt()" in source
    assert "current_contract_documents()" in source
    assert "current_setting('app.current_restaurante_id', true)" in source
    assert "ORDER BY {order_by}" in source
    assert "link.linked_at DESC, a.accepted_at DESC, link.id DESC" in source
    assert "SECURITY DEFINER" in source
    assert "SET search_path = pg_catalog" in source
    assert "GRANT SELECT ON TABLE public.contract_acceptances" not in source
