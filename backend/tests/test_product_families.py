"""Family membership preserves each SKU's fiscal/operational identity and tenant isolation."""
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.database import Base, current_restaurante_id
from app.models import Categoria, Produto, ProdutoFamilia, Restaurante
from app.routes.product_families import FamilyWrite, _write_family
from app.services.catalog_family_metadata import family_metadata_for_products


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    token = current_restaurante_id.set(91)
    try:
        Base.metadata.create_all(engine)
        with Session(engine) as session:
            session.add_all([
                Restaurante(id=91, nome="Loja 91", plano="pocket"),
                Restaurante(id=92, nome="Loja 92", plano="pocket"),
            ])
            session.flush()
            session.add_all([
                Categoria(id="batatas-91", restaurante_id=91, nome="Batatas Fritas"),
                Categoria(id="batatas-92", restaurante_id=92, nome="Batatas Fritas"),
            ])
            session.flush()
            session.add_all([
                Produto(id="batata-300", restaurante_id=91, categoria_id="batatas-91",
                        nome="Batata 300 g", preco=15),
                Produto(id="batata-400", restaurante_id=91, categoria_id="batatas-91",
                        nome="Batata 400 g", preco=18),
                Produto(id="batata-loja-92", restaurante_id=92, categoria_id="batatas-92",
                        nome="Outra loja 300 g", preco=25),
            ])
            session.commit()
            yield session
    finally:
        current_restaurante_id.reset(token)
        engine.dispose()


def family(*variants):
    return FamilyWrite(
        nome="Batata Frita Tradicional",
        categoria_id="batatas-91",
        eixo="tamanho",
        variantes=list(variants),
    )


def option(sku, label, price):
    return {"produto_id": sku, "rotulo": label, "preco": price}


def test_sizes_reuse_real_skus_with_distinct_names_and_prices(db):
    saved = _write_family(db, 91, family(
        option("batata-300", "Média · 300 g", "15.00"),
        option("batata-400", "Grande · 400 g", "18.00"),
    ), None)
    assert {v["produto_id"] for v in saved["variantes"]} == {"batata-300", "batata-400"}
    assert {v["preco"] for v in saved["variantes"]} == {15, 18}
    assert db.query(Produto).filter_by(restaurante_id=91).count() == 2
    products = db.query(Produto).filter_by(restaurante_id=91).all()
    assert {p.familia_id for p in products} == {saved["id"]}
    assert {p.variacao_rotulo for p in products} == {"Média · 300 g", "Grande · 400 g"}
    metadata = family_metadata_for_products(db, 91, products)
    assert set(metadata) == {"batata-300", "batata-400"}
    assert {x["familia_nome"] for x in metadata.values()} == {"Batata Frita Tradicional"}


def test_edit_price_preserves_ids_and_rejects_implicit_variant_removal(db):
    saved = _write_family(db, 91, family(
        option("batata-300", "300 g", "15.00"),
        option("batata-400", "400 g", "18.00"),
    ), None)
    existing = db.query(ProdutoFamilia).filter_by(id=saved["id"], restaurante_id=91).one()
    edited = _write_family(db, 91, family(
        option("batata-300", "300 g", "16.00"),
        option("batata-400", "400 g", "18.00"),
    ), existing)
    assert edited["id"] == saved["id"]
    assert db.query(Produto).filter_by(restaurante_id=91).count() == 2
    assert db.query(Produto).filter_by(id="batata-300").one().preco == 16
    assert db.query(Produto).filter_by(id="batata-400").one().preco == 18
    with pytest.raises(HTTPException) as exc:
        _write_family(db, 91, family(option("batata-300", "300 g", "16.00")), existing)
    assert exc.value.status_code == 409
    db.rollback()
    assert db.query(Produto).filter_by(restaurante_id=91).count() == 2


def test_cross_tenant_variant_is_never_linked(db):
    with pytest.raises(HTTPException) as exc:
        _write_family(db, 91, family(option("batata-loja-92", "300 g", "15.00")), None)
    assert exc.value.status_code == 404
    db.rollback()
    assert db.query(ProdutoFamilia).filter_by(restaurante_id=91).count() == 0
    # Tenant 91's ORM scope must not expose tenant 92's SKU.
    assert db.query(Produto).filter_by(id="batata-loja-92").count() == 0
    # Inspect isolated SQLite fixture state without disabling the ORM tenant guard.
    assert db.execute(text("SELECT familia_id FROM produtos WHERE id = 'batata-loja-92'")).scalar_one() is None


def test_new_variant_is_real_purchasable_sku(db):
    saved = _write_family(db, 91, family({"rotulo": "Pequena · 200 g", "preco": "12.00"}), None)
    product = db.query(Produto).filter_by(id=saved["variantes"][0]["produto_id"], restaurante_id=91).one()
    assert product.nome == "Batata Frita Tradicional - Pequena · 200 g"
    assert product.preco == 12
    assert product.familia_id == saved["id"]
    # ORM queries under tenant 91 intentionally hide tenant 92.
    assert db.query(Produto).filter_by(restaurante_id=92).count() == 0
    assert db.execute(text("SELECT count(*) FROM produtos WHERE restaurante_id = 92")).scalar_one() == 1


def test_family_model_respects_tenant_context():
    assert ProdutoFamilia.__table__.c.restaurante_id.default is not None
