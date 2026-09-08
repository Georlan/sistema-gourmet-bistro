from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
MAIN_SOURCE = (BACKEND_ROOT / "app" / "main.py").read_text(encoding="utf-8")
EMERGENCY_MIGRATION = (
    BACKEND_ROOT
    / "alembic"
    / "versions"
    / "8f3a2d1c9e7b_add_missing_columns_emergency.py"
).read_text(encoding="utf-8")


# Regressão: startup não pode voltar a atuar como uma segunda ferramenta de migration.
def test_startup_does_not_patch_schema_with_manual_alter_table():
    assert "ALTER TABLE comandas ADD COLUMN mesa_transferida_de" not in MAIN_SOURCE
    assert "Adicionando coluna 'mesa_transferida_de'" not in MAIN_SOURCE


def test_mesa_transferida_de_is_owned_by_alembic_revision():
    assert "safe_add_column('comandas', 'mesa_transferida_de', sa.Integer())" in EMERGENCY_MIGRATION
    assert "command.upgrade(alembic_cfg, \"heads\")" in MAIN_SOURCE
