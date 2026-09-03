from pathlib import Path


MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic/versions/2b3c4d5e6f7a_add_saas_status_and_super_admin_audit_logs.py"
)


def _migration_source() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def test_super_admin_audit_rls_uses_runtime_tenant_setting():
    source = _migration_source()
    assert "app.current_restaurante_id" in source
    assert "koma.current_restaurante_id" not in source


def test_super_admin_audit_rls_has_no_global_tenant_zero_bypass():
    source = _migration_source()
    assert "current_restaurante_id', true), '')::integer = 0" not in source


def test_super_admin_audit_rls_is_append_only_for_koma_app():
    source = _migration_source()
    assert "GRANT SELECT, INSERT ON TABLE public.super_admin_audit_logs TO koma_app" in source
    assert "GRANT USAGE, SELECT ON SEQUENCE public.super_admin_audit_logs_id_seq TO koma_app" in source
    assert "FOR SELECT" in source
    assert "FOR INSERT" in source
    assert "AS RESTRICTIVE" not in source
    assert "FOR UPDATE" not in source
    assert "FOR DELETE" not in source
