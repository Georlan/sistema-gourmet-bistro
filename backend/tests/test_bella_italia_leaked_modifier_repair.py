from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "alembic" / "versions" / "8a91b2c3d4e5_archive_bella_italia_leaked_modifiers.py"
ROUTE = ROOT / "app" / "routes" / "modificadores.py"


def test_repair_is_strictly_scoped_and_preserves_history():
    source = MIGRATION.read_text(encoding="utf-8")

    assert 'TENANT_ID = 2' in source
    assert 'CATEGORY_ID = "cat-2-hamburgueres"' in source
    for group_id in (
        "gmod-2-carnes-proteinas",
        "gmod-2-molhos-sabores",
        "gmod-2-paes",
        "gmod-2-queijos-cremosos",
        "gmod-2-vegetais-extras",
    ):
        assert group_id in source

    # O reparo não pode apagar opções/grupos referenciados por pedidos históricos.
    assert "DELETE FROM opcao_modificadores" not in source
    assert "DELETE FROM grupo_modificadores" not in source
    assert "UPDATE opcao_modificadores SET ativo = false" in source
    assert "UPDATE grupo_modificadores SET tipo = :archived_type" in source
    assert "historico_preservado" in source


def test_archived_groups_are_hidden_from_current_modifier_lists():
    source = ROUTE.read_text(encoding="utf-8")

    assert 'ARCHIVED_MODIFIER_TYPE = "__archived__"' in source
    assert source.count("GrupoModificador.tipo != ARCHIVED_MODIFIER_TYPE") >= 4
