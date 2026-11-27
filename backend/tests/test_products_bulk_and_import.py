"""Regression tests for Wave 2 catalog bulk operations, duplication, and merge import."""
from fastapi.testclient import TestClient
import pytest

from app.database import SessionLocal, current_restaurante_id
from app.main import app
from app.models import (
    Categoria,
    ConfiguracaoRestaurante,
    GrupoModificador,
    OpcaoModificador,
    Produto,
    ProdutoGrupoModificador,
    Restaurante,
    Usuario,
)
from app.routes.auth import create_access_token

client = TestClient(app)

TENANT_A = 991
TENANT_B = 992


@pytest.fixture(autouse=True)
def setup_tenants():
    db = SessionLocal()
    try:
        for tid, nome in ((TENANT_A, "Restaurante Bulk A"), (TENANT_B, "Restaurante Bulk B")):
            token = current_restaurante_id.set(tid)
            try:
                if not db.query(Restaurante).filter_by(id=tid).first():
                    db.add(Restaurante(id=tid, nome=nome, slug=f"bulk-{tid}", plano="pro"))
                    db.flush()
                if not db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=tid).first():
                    db.add(ConfiguracaoRestaurante(restaurante_id=tid))
                    db.flush()
                uid = f"admin-{tid}"
                if not db.query(Usuario).filter_by(id=uid).first():
                    db.add(Usuario(
                        id=uid, restaurante_id=tid, nome=f"Admin {tid}",
                        email=f"admin{tid}@koma.test", cargo="admin", status="ativo",
                    ))
                    db.flush()
                db.query(ProdutoGrupoModificador).filter_by(restaurante_id=tid).delete()
                db.query(Produto).filter_by(restaurante_id=tid).delete()
                db.query(OpcaoModificador).filter_by(restaurante_id=tid).delete()
                db.query(GrupoModificador).filter_by(restaurante_id=tid).delete()
                db.query(Categoria).filter_by(restaurante_id=tid).delete()
                db.flush()
            finally:
                current_restaurante_id.reset(token)

        t_a = current_restaurante_id.set(TENANT_A)
        try:
            db.add(Categoria(id="cat-burgers-a", restaurante_id=TENANT_A, nome="Lanches", destino_impressao="COZINHA"))
            db.add(Categoria(id="cat-bebidas-a", restaurante_id=TENANT_A, nome="Bebidas", destino_impressao="NENHUM"))
            db.add(Produto(id="p-a1", restaurante_id=TENANT_A, nome="X-Burguer", categoria_id="cat-burgers-a", preco=20.0, ativo=True))
            db.add(Produto(id="p-a2", restaurante_id=TENANT_A, nome="X-Bacon", categoria_id="cat-burgers-a", preco=25.0, ativo=True))
            db.add(GrupoModificador(id="grp-a1", restaurante_id=TENANT_A, nome="Adicionais", min_selecoes=0, max_selecoes=3))
            db.add(OpcaoModificador(id="opt-a1", restaurante_id=TENANT_A, grupo_id="grp-a1", nome="Bacon Extra", preco_adicional=4.0))
        finally:
            current_restaurante_id.reset(t_a)

        t_b = current_restaurante_id.set(TENANT_B)
        try:
            db.add(Categoria(id="cat-b", restaurante_id=TENANT_B, nome="Outros", destino_impressao="COZINHA"))
            db.add(Produto(id="p-b1", restaurante_id=TENANT_B, nome="Produto B", categoria_id="cat-b", preco=30.0, ativo=True))
            db.add(GrupoModificador(id="grp-b1", restaurante_id=TENANT_B, nome="Grupo B", min_selecoes=0, max_selecoes=1))
        finally:
            current_restaurante_id.reset(t_b)

        db.commit()
    finally:
        db.close()
    yield


def _headers(tid: int) -> dict[str, str]:
    tok = create_access_token(subject=f"admin-{tid}", restaurante_id=tid, role="admin")
    return {"Authorization": f"Bearer {tok}"}


def test_batch_edit_fixed_price_delta_highlight_and_modifier_groups_idempotent():
    headers_a = _headers(TENANT_A)

    # Delta +2.50, destaque=True, add grp-a1
    res = client.patch(
        "/produtos/edicao-lote",
        headers=headers_a,
        json={
            "produto_ids": ["p-a1", "p-a2"],
            "reajuste_valor": 2.5,
            "destaque": True,
            "adicionar_grupos_modificadores_ids": ["grp-a1"],
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["atualizados"] == 2
    assert body["grupos_adicionados"] == 2

    # Idempotent re-add of same group does not duplicate
    res_again = client.patch(
        "/produtos/edicao-lote",
        headers=headers_a,
        json={
            "produto_ids": ["p-a1"],
            "adicionar_grupos_modificadores_ids": ["grp-a1"],
        },
    )
    assert res_again.status_code == 200
    assert res_again.json()["grupos_adicionados"] == 0

    # Fixed price + remove group
    res_fixed = client.patch(
        "/produtos/edicao-lote",
        headers=headers_a,
        json={
            "produto_ids": ["p-a1"],
            "preco_fixo": 19.9,
            "remover_grupos_modificadores_ids": ["grp-a1"],
        },
    )
    assert res_fixed.status_code == 200
    assert res_fixed.json()["grupos_removidos"] == 1

    # Negative resulting price is rejected atomically
    res_neg = client.patch(
        "/produtos/edicao-lote",
        headers=headers_a,
        json={"produto_ids": ["p-a1", "p-a2"], "reajuste_valor": -25.0},
    )
    assert res_neg.status_code == 422

    # Cross-tenant modifier group cannot be attached
    res_cross = client.patch(
        "/produtos/edicao-lote",
        headers=headers_a,
        json={"produto_ids": ["p-a1"], "adicionar_grupos_modificadores_ids": ["grp-b1"]},
    )
    assert res_cross.status_code == 400


def test_duplicate_product_clones_modifiers_and_blocks_cross_tenant():
    headers_a = _headers(TENANT_A)
    headers_b = _headers(TENANT_B)

    client.patch(
        "/produtos/edicao-lote",
        headers=headers_a,
        json={"produto_ids": ["p-a1"], "adicionar_grupos_modificadores_ids": ["grp-a1"]},
    )

    dup = client.post("/produtos/p-a1/duplicar", headers=headers_a)
    assert dup.status_code == 201, dup.text
    dup_data = dup.json()
    assert dup_data["id"] != "p-a1"
    assert dup_data["nome"] == "X-Burguer (Cópia)"
    assert dup_data["preco"] == pytest.approx(20.0)
    assert dup_data["destaque"] is False

    pers = client.get(f"/produtos/{dup_data['id']}/personalizacoes", headers=headers_a)
    assert pers.status_code == 200
    assert "grp-a1" in pers.json()["grupos_diretos"]

    # Cross-tenant duplicate returns 404
    cross_dup = client.post("/produtos/p-a1/duplicar", headers=headers_b)
    assert cross_dup.status_code == 404


def test_import_merge_preserves_existing_and_assigns_smart_category_routes():
    headers_a = _headers(TENANT_A)
    res = client.post(
        "/produtos/importar",
        headers=headers_a,
        json={
            "mode": "merge",
            "categories": [
                {"id": "cat-sucos-naturais", "nome": "Sucos Naturais", "destino_impressao": "NENHUM"},
                {"id": "cat-porcoes", "nome": "Porções", "destino_impressao": "COZINHA"},
            ],
            "products": [
                {"id": "imp-suco-laranja", "nome": "Suco de Laranja", "preco": 9.5, "categoria_id": "cat-sucos-naturais"},
                {"id": "imp-batata", "nome": "Batata Frita", "preco": 18.0, "categoria_id": "cat-porcoes"},
            ],
        },
    )
    assert res.status_code == 200, res.text

    # Re-import same IDs updates idempotently without duplicating and keeps p-a1/p-a2 active
    res2 = client.post(
        "/produtos/importar",
        headers=headers_a,
        json={
            "mode": "merge",
            "products": [
                {"id": "imp-suco-laranja", "nome": "Suco de Laranja 500ml", "preco": 11.0, "categoria_id": "cat-sucos-naturais"},
            ],
        },
    )
    assert res2.status_code == 200

    t_a = current_restaurante_id.set(TENANT_A)
    try:
        with SessionLocal() as db:
            all_prods = db.query(Produto).filter_by(restaurante_id=TENANT_A).all()
            by_id = {p.id: p for p in all_prods}
            assert by_id["p-a1"].ativo is True
            assert by_id["p-a2"].ativo is True
            assert by_id["imp-suco-laranja"].nome == "Suco de Laranja 500ml"
            assert by_id["imp-suco-laranja"].preco == pytest.approx(11.0)
            cat_sucos = db.query(Categoria).filter_by(restaurante_id=TENANT_A, id="cat-sucos-naturais").one()
            assert cat_sucos.destino_impressao == "NENHUM"
    finally:
        current_restaurante_id.reset(t_a)
