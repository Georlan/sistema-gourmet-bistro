from pathlib import Path

from app import main as app_main
from app.routes import super_admin_catalog_maintenance


def _snapshot(*, products=0, observations=0, uses=0, direct_links=0):
    return {
        "restaurante_id": 2,
        "categoria": {"id": "cat-orphan", "nome": "Órfã"},
        "categoria_produtos": products,
        "categoria_observacoes": observations,
        "categoria_grupos": ["g1"],
        "grupos": [
            {
                "id": "g1",
                "nome": "Grupo órfão",
                "produto_links": direct_links,
                "categoria_ids": ["cat-orphan"],
                "opcao_ids": ["o1"],
                "usos_historicos": uses,
            }
        ],
    }


def test_catalog_maintenance_routes_are_registered_under_superadmin_control_plane():
    source = Path(app_main.__file__).resolve().parent / "routes" / "__init__.py"
    content = source.read_text(encoding="utf-8")
    assert "super_admin_catalog_maintenance" in content
    assert "_super_admin.router.include_router(_super_admin_catalog_maintenance_router)" in content


def test_cleanup_requires_preview_fingerprint_and_explicit_confirmation():
    request_fields = super_admin_catalog_maintenance.OrphanPresetExecuteRequest.model_fields
    assert "preview_fingerprint" in request_fields
    assert "reason" in request_fields
    assert "confirm" in request_fields
    assert request_fields["confirm"].default is False


def test_cleanup_fingerprint_changes_when_catalog_state_changes():
    base = super_admin_catalog_maintenance._fingerprint(_snapshot())
    assert base == super_admin_catalog_maintenance._fingerprint(_snapshot())
    assert base != super_admin_catalog_maintenance._fingerprint(_snapshot(products=1))
    assert base != super_admin_catalog_maintenance._fingerprint(_snapshot(observations=1))
    assert base != super_admin_catalog_maintenance._fingerprint(_snapshot(uses=1))
    assert base != super_admin_catalog_maintenance._fingerprint(_snapshot(direct_links=1))


def test_cleanup_source_guards_products_links_history_and_toctou():
    source = Path(super_admin_catalog_maintenance.__file__).read_text(encoding="utf-8")
    assert "categoria_produtos" in source
    assert "categoria_observacoes" in source
    assert "ItemModificador" in source
    assert "ProdutoGrupoModificador" in source
    assert "linked_group_ids != requested_group_ids" in source
    assert "category_ids != [categoria_id]" in source
    assert "with_for_update" in source
    assert "preview_fingerprint" in source
    assert "SUPERADMIN_CATALOG_ORPHAN_PRESET_CLEANUP" in source
    assert "tenant_session_scope" in source
