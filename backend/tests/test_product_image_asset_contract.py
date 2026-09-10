from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _source(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def test_product_image_upload_is_single_tenant_scoped_asset():
    source = _source("backend/app/routes/cardapio_digital.py")

    assert '@router.post("/assets/product/{produto_id}")' in source
    assert 'Depends(require_permission("catalogo:administrar"))' in source
    assert "Produto.restaurante_id == rest_id" in source
    assert 'object_path = f"{rest_id}/products/{uuid.uuid4().hex}.{extension}"' in source
    assert 'previous_path = _storage_object_path(previous_url, rest_id, "products")' in source
    assert "produto.imagens_galeria = []" in source
    assert 'notify_catalog_update(background_tasks, "Foto do produto atualizada", rest_id)' in source


def test_product_image_delete_clears_public_reference_and_keeps_tenant_scope():
    source = _source("backend/app/routes/cardapio_digital.py")

    assert '@router.delete("/assets/product/{produto_id}")' in source
    assert 'object_path = _storage_object_path(current_url, rest_id, "products")' in source
    assert 'produto.imagem = ""' in source
    assert 'notify_catalog_update(background_tasks, "Foto do produto removida", rest_id)' in source
