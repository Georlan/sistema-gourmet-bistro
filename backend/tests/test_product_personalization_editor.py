"""Vínculos do produto não podem apagar escolhas de outra loja ou mudar regras por categoria."""
import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.catalog_addons import CategoriaGrupoModificador
from app.database import Base, current_restaurante_id
from app.models import (
    Restaurante, Categoria, Produto, GrupoModificador, ProdutoGrupoModificador,
)
from app.routes.products import (
    ProdutoPersonalizacoesUpdate, get_produto_personalizacoes,
    atualizar_produto_personalizacoes,
)


@pytest.fixture
def catalog_db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    token = current_restaurante_id.set(1)
    try:
        with Session(engine) as db:
            db.add_all([
                Restaurante(id=1, nome="Loja A", plano="pocket"),
                Restaurante(id=2, nome="Loja B", plano="pocket"),
            ])
            db.flush()
            db.add_all([
                Categoria(id="cat", nome="Lanches", restaurante_id=1),
                Categoria(id="cat", nome="Lanches", restaurante_id=2),
            ])
            db.flush()
            db.add_all([
                Produto(id="burger", restaurante_id=1, categoria_id="cat", nome="Hambúrguer", preco=15),
                Produto(id="burger", restaurante_id=2, categoria_id="cat", nome="Outra loja", preco=20),
                GrupoModificador(id="included", restaurante_id=1, nome="Ponto", tipo="obrigatorio",
                                 min_selecoes=1, max_selecoes=1),
                GrupoModificador(id="paid", restaurante_id=1, nome="Adicionais", tipo="opcional",
                                 min_selecoes=0, max_selecoes=1),
                GrupoModificador(id="other-tenant", restaurante_id=2, nome="Não visível", tipo="opcional"),
            ])
            db.flush()
            db.add(CategoriaGrupoModificador(
                restaurante_id=1, categoria_id="cat", grupo_id="included",
            ))
            db.commit()
            yield db
    finally:
        current_restaurante_id.reset(token)
        engine.dispose()


def _update(db, groups, before=()):
    return atualizar_produto_personalizacoes(
        "burger",
        ProdutoPersonalizacoesUpdate(
            grupo_ids=list(groups),
            grupos_diretos_anteriores=list(before),
        ),
        BackgroundTasks(), db=db, current_user=object(),
    )


def test_product_editor_links_only_direct_groups_preserving_inherited(catalog_db):
    before = get_produto_personalizacoes("burger", db=catalog_db, current_user=object())
    assert before == {
        "produto_id": "burger",
        "grupos_diretos": [],
        "grupos_herdados": ["included"],
    }

    saved = _update(catalog_db, ["paid"])
    assert saved["grupos_diretos"] == ["paid"]
    assert saved["grupos_herdados"] == ["included"]
    own = catalog_db.query(ProdutoGrupoModificador).filter_by(restaurante_id=1, produto_id="burger").all()
    assert {link.grupo_id for link in own} == {"paid"}

    cleared = _update(catalog_db, [], ["paid"])
    assert cleared["grupos_diretos"] == []
    assert cleared["grupos_herdados"] == ["included"]
    assert catalog_db.query(ProdutoGrupoModificador).filter_by(restaurante_id=2).count() == 0


def test_stale_edits_and_cross_tenant_link_are_rejected(catalog_db):
    _update(catalog_db, ["paid"])
    with pytest.raises(HTTPException) as stale:
        _update(catalog_db, [], [])
    assert stale.value.status_code == 409

    with pytest.raises(HTTPException) as forbidden:
        _update(catalog_db, ["other-tenant"], ["paid"])
    assert forbidden.value.status_code == 422
    assert {link.grupo_id for link in catalog_db.query(ProdutoGrupoModificador).filter_by(
        restaurante_id=1, produto_id="burger",
    ).all()} == {"paid"}


def test_marmitaria_size_uses_dedicated_editor(catalog_db):
    product = catalog_db.query(Produto).filter_by(restaurante_id=1, id="burger").one()
    product.marmitaria_tamanho = "p"
    catalog_db.commit()
    with pytest.raises(HTTPException) as rejected:
        _update(catalog_db, ["paid"])
    assert rejected.value.status_code == 409
