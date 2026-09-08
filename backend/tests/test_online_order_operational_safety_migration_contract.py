from pathlib import Path
import importlib.util
from types import SimpleNamespace
from unittest.mock import Mock


MIGRATION = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "2a3b4c5d6e7f_add_online_order_operational_safety.py"


def test_operational_safety_migration_enforces_rls_and_runtime_grants():
    spec = importlib.util.spec_from_file_location("operational_safety_migration", MIGRATION)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    operations = Mock()
    operations.get_bind.return_value = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))
    migration.op = operations
    migration.upgrade()
    source = "\n".join(str(call.args[0]) for call in operations.execute.call_args_list)
    for table in (
        "online_order_controls",
        "online_order_customer_blocks",
        "online_order_operational_audit",
    ):
        assert f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY" in source
        assert f"ALTER TABLE public.{table} FORCE ROW LEVEL SECURITY" in source
        assert f"CREATE POLICY {table}_select" in source
        assert f"CREATE POLICY {table}_insert" in source
    assert "current_setting('app.current_restaurante_id', true)" in source
    assert "GRANT SELECT, INSERT, UPDATE ON TABLE public.online_order_controls TO koma_app" in source
    assert "GRANT SELECT, INSERT, UPDATE ON TABLE public.online_order_customer_blocks TO koma_app" in source
    assert "GRANT SELECT, INSERT ON TABLE public.online_order_operational_audit TO koma_app" in source
    assert "GRANT USAGE, SELECT ON SEQUENCE public.online_order_operational_audit_id_seq TO koma_app" in source


def test_operational_audit_is_not_granted_update_or_delete():
    source = MIGRATION.read_text(encoding="utf-8")
    assert "GRANT SELECT, INSERT, UPDATE ON TABLE public.online_order_operational_audit" not in source
    assert "GRANT SELECT, INSERT, DELETE ON TABLE public.online_order_operational_audit" not in source
