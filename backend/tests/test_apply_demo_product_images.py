from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Categoria, Produto, Restaurante
from tools.apply_demo_product_images import IMAGE_PREFIX, apply_images, build_plan
from tools.enrich_demo_restaurant import DEMO_CATEGORIES, DEMO_PRODUCTS
from tools.provision_demo_restaurant import _imports


def _engine():
    _imports()
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session.begin() as db:
        base = db.query(Restaurante).filter_by(id=1).one_or_none()
        if base is None:
            db.add(Restaurante(id=1, nome="KÔMA Base", slug="base", billing_mode="legacy"))
        else:
            base.nome = "KÔMA Base"
            base.slug = "base"
            base.billing_mode = "legacy"

        demo = db.query(Restaurante).filter_by(id=2).one_or_none()
        if demo is None:
            db.add(Restaurante(id=2, nome="KÔMA Demo", slug="demo", billing_mode="legacy"))
        else:
            demo.nome = "KÔMA Demo"
            demo.slug = "demo"
            demo.billing_mode = "legacy"
        db.flush()

        for category_id, name, destination in DEMO_CATEGORIES:
            if db.query(Categoria).filter_by(restaurante_id=2, id=category_id).one_or_none() is None:
                db.add(
                    Categoria(
                        restaurante_id=2,
                        id=category_id,
                        nome=name,
                        destino_impressao=destination,
                    )
                )
        db.flush()

        for product_id, name, category_id, price, description in DEMO_PRODUCTS:
            if db.query(Produto).filter_by(restaurante_id=2, id=product_id).one_or_none() is None:
                db.add(
                    Produto(
                        restaurante_id=2,
                        id=product_id,
                        nome=name,
                        categoria_id=category_id,
                        preco=price,
                        descricao=description,
                        imagem="",
                        imagens_galeria=[],
                        ativo=True,
                    )
                )

        db.add(
            Produto(
                restaurante_id=1,
                id="base-produto-imagem",
                nome="Produto Base",
                categoria_id=None,
                preco=10,
                descricao="Preservar imagem",
                imagem="https://example.invalid/preserve.jpg",
                imagens_galeria=[],
                ativo=True,
            )
        )
    return engine


def test_demo_image_dry_run_is_non_mutating():
    engine = _engine()
    try:
        plan = build_plan(engine)
        assert plan["mode"] == "dry-run"
        assert plan["target_products"] == 30
        assert plan["found_products"] == 30
        assert plan["already_with_demo_image"] == 0

        Session = sessionmaker(bind=engine)
        with Session() as db:
            assert db.query(Produto).filter_by(restaurante_id=2).filter(Produto.imagem != "").count() == 0
    finally:
        engine.dispose()


def test_apply_demo_images_updates_all_products_and_is_idempotent():
    engine = _engine()
    try:
        first = apply_images(engine, expected_database=":memory:")
        assert first["validation"] == "passed"
        assert first["products_with_images"] == 30

        Session = sessionmaker(bind=engine)
        with Session() as db:
            demo_products = db.query(Produto).filter_by(restaurante_id=2).all()
            assert len(demo_products) == 30
            assert all(str(product.imagem).startswith(IMAGE_PREFIX) for product in demo_products)
            first_image = db.query(Produto).filter_by(restaurante_id=2, id="demo-smash").one().imagem
            base_image = db.query(Produto).filter_by(restaurante_id=1, id="base-produto-imagem").one().imagem
            assert base_image == "https://example.invalid/preserve.jpg"

        second = apply_images(engine, expected_database=":memory:")
        assert second["validation"] == "passed"

        with Session() as db:
            assert db.query(Produto).filter_by(restaurante_id=2, id="demo-smash").one().imagem == first_image
            assert db.query(Produto).filter_by(restaurante_id=1, id="base-produto-imagem").one().imagem == "https://example.invalid/preserve.jpg"
    finally:
        engine.dispose()


def test_demo_images_refuse_unexpected_third_tenant():
    engine = _engine()
    try:
        Session = sessionmaker(bind=engine)
        with Session.begin() as db:
            db.add(Restaurante(id=3, nome="Tenant inesperado", slug="tenant-3", billing_mode="legacy"))

        try:
            build_plan(engine)
        except RuntimeError as exc:
            assert "tenants inesperados" in str(exc)
        else:
            raise AssertionError("comando deveria falhar fechado com tenant inesperado")
    finally:
        engine.dispose()
