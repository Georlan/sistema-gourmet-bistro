from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.catalog_addons import (
    CategoriaGrupoModificador,
    CategoriaRelacao,
    effective_modifier_payloads_by_product,
    ensure_hamburger_addon_suggestions,
)
from app.database import Base
from app.models import (
    Categoria,
    GrupoModificador,
    OpcaoModificador,
    Produto,
    Restaurante,
)


def _session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)()


def _seed_restaurant(db, restaurant_id: int, slug: str):
    db.add(Restaurante(id=restaurant_id, nome=f"Restaurante {restaurant_id}", slug=slug))
    db.flush()


def test_hamburger_suggestions_are_idempotent_and_inherited_by_children():
    db = _session()
    try:
        _seed_restaurant(db, 771, "addons-771")
        bovinos = Categoria(
            id="cat-bovinos",
            restaurante_id=771,
            nome="Hambúrgueres Bovinos",
            destino_impressao="COZINHA",
        )
        suinos = Categoria(
            id="cat-suinos",
            restaurante_id=771,
            nome="Hambúrgueres Suínos",
            destino_impressao="COZINHA",
        )
        db.add_all([bovinos, suinos])
        db.flush()
        product = Produto(
            id="burger-bovino-1",
            restaurante_id=771,
            categoria_id=bovinos.id,
            nome="Cheese Bacon",
            preco=32.0,
        )
        db.add(product)
        db.flush()

        first = ensure_hamburger_addon_suggestions(db, 771)
        db.commit()

        assert first["total_sugestoes"] == 21
        assert first["grupos_criados"] == 5
        assert first["opcoes_criadas"] == 21
        assert db.query(GrupoModificador).filter_by(restaurante_id=771).count() == 5
        assert db.query(OpcaoModificador).filter_by(restaurante_id=771).count() == 21

        parent = db.query(Categoria).filter_by(
            restaurante_id=771,
            nome="Hambúrgueres",
        ).one()
        assert db.query(CategoriaRelacao).filter_by(
            restaurante_id=771,
            categoria_id=bovinos.id,
            categoria_pai_id=parent.id,
        ).count() == 1
        assert db.query(CategoriaRelacao).filter_by(
            restaurante_id=771,
            categoria_id=suinos.id,
            categoria_pai_id=parent.id,
        ).count() == 1
        assert db.query(CategoriaGrupoModificador).filter_by(
            restaurante_id=771,
            categoria_id=parent.id,
        ).count() == 5

        payload = effective_modifier_payloads_by_product(db, 771, [product])
        groups = payload[product.id]
        assert {group["nome"] for group in groups} == {
            "Queijos e Cremosos",
            "Carnes e Proteínas",
            "Molhos e Sabores",
            "Vegetais e Extras",
            "Pães",
        }
        meat_group = next(group for group in groups if group["nome"] == "Carnes e Proteínas")
        assert {option["nome"] for option in meat_group["opcoes"]} >= {
            "Bacon Fatiado",
            "Bacon Cubos",
        }

        second = ensure_hamburger_addon_suggestions(db, 771)
        db.commit()
        assert second["grupos_criados"] == 0
        assert second["opcoes_criadas"] == 0
        assert db.query(GrupoModificador).filter_by(restaurante_id=771).count() == 5
        assert db.query(OpcaoModificador).filter_by(restaurante_id=771).count() == 21
        assert db.query(CategoriaGrupoModificador).filter_by(
            restaurante_id=771,
            categoria_id=parent.id,
        ).count() == 5
    finally:
        db.close()


def test_category_addons_do_not_cross_tenants():
    db = _session()
    try:
        _seed_restaurant(db, 781, "addons-781")
        _seed_restaurant(db, 782, "addons-782")
        cat_a = Categoria(
            id="cat-hamburgueres-bovinos",
            restaurante_id=781,
            nome="Hambúrgueres Bovinos",
            destino_impressao="COZINHA",
        )
        cat_b = Categoria(
            id="cat-hamburgueres-bovinos",
            restaurante_id=782,
            nome="Hambúrgueres Bovinos",
            destino_impressao="COZINHA",
        )
        db.add_all([cat_a, cat_b])
        db.flush()
        product_a = Produto(
            id="burger-a",
            restaurante_id=781,
            categoria_id=cat_a.id,
            nome="Burger A",
            preco=20.0,
        )
        product_b = Produto(
            id="burger-b",
            restaurante_id=782,
            categoria_id=cat_b.id,
            nome="Burger B",
            preco=21.0,
        )
        db.add_all([product_a, product_b])
        db.flush()

        ensure_hamburger_addon_suggestions(db, 781)
        db.commit()

        payload_a = effective_modifier_payloads_by_product(db, 781, [product_a])
        payload_b = effective_modifier_payloads_by_product(db, 782, [product_b])

        assert len(payload_a[product_a.id]) == 5
        assert payload_b[product_b.id] == []
        assert db.query(GrupoModificador).filter_by(restaurante_id=782).count() == 0
    finally:
        db.close()
