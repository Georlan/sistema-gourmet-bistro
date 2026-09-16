from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import (
    Categoria,
    GrupoModificador,
    Mesa,
    ObservacaoPredefinida,
    OpcaoModificador,
    Produto,
    ProdutoGrupoModificador,
    Restaurante,
)
from tools.enrich_demo_restaurant import (
    DEMO_CATEGORIES,
    DEMO_PRODUCTS,
    DEMO_TABLE_COUNT,
    MODIFIER_GROUPS,
    apply_enrichment,
    build_plan,
)
from tools.provision_demo_restaurant import DEMO_USERS, _imports, apply_demo


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
    passwords = {
        str(spec["password_env"]): f"Demo-{index}-Senha-Segura!"
        for index, spec in enumerate(DEMO_USERS, start=1)
    }
    apply_demo(engine, expected_database=":memory:", passwords=passwords)
    return engine


def test_enrichment_dry_run_does_not_mutate_demo():
    engine = _engine()
    try:
        Session = sessionmaker(bind=engine)
        with Session() as db:
            before_tables = db.query(Mesa).filter_by(restaurante_id=2).count()
            before_products = db.query(Produto).filter_by(restaurante_id=2).count()

        plan = build_plan(engine)
        assert plan["mode"] == "dry-run"
        assert plan["restaurant_id"] == 2
        assert plan["will_create_or_update"]["tables"] == DEMO_TABLE_COUNT
        assert plan["will_create_or_update"]["products"] == len(DEMO_PRODUCTS)

        with Session() as db:
            assert db.query(Mesa).filter_by(restaurante_id=2).count() == before_tables
            assert db.query(Produto).filter_by(restaurante_id=2).count() == before_products
    finally:
        engine.dispose()


def test_enrichment_creates_rich_demo_and_is_idempotent():
    engine = _engine()
    try:
        first = apply_enrichment(engine, expected_database=":memory:")
        second = apply_enrichment(engine, expected_database=":memory:")
        assert first["validation"] == "passed"
        assert second["validation"] == "passed"

        Session = sessionmaker(bind=engine)
        with Session() as db:
            assert db.query(Mesa).filter_by(restaurante_id=2).count() == 30
            assert db.query(Categoria).filter_by(restaurante_id=2).count() == len(DEMO_CATEGORIES)
            assert db.query(Produto).filter_by(restaurante_id=2).count() == 30
            assert db.query(GrupoModificador).filter_by(restaurante_id=2).count() == len(MODIFIER_GROUPS)
            assert db.query(OpcaoModificador).filter_by(restaurante_id=2).count() == 30
            assert db.query(ObservacaoPredefinida).filter_by(restaurante_id=2).count() >= 23

            table_30 = db.query(Mesa).filter_by(restaurante_id=2, id=30).one()
            assert table_30.nome == "Mesa 30"
            assert table_30.capacidade == 6

            beverage_category = db.query(Categoria).filter_by(restaurante_id=2, id="demo-bebidas").one()
            assert beverage_category.destino_impressao == "BAR"

            fries = db.query(Produto).filter_by(restaurante_id=2, id="demo-batata").one()
            assert fries.categoria_id == "demo-porcoes"

            burger_group = db.query(GrupoModificador).filter_by(
                restaurante_id=2, id="demo-adicionais-burger"
            ).one()
            assert burger_group.max_selecoes == 5
            assert db.query(OpcaoModificador).filter_by(
                restaurante_id=2, grupo_id=burger_group.id
            ).count() == 8

            combo_group = db.query(GrupoModificador).filter_by(
                restaurante_id=2, id="demo-bebida-combo"
            ).one()
            assert combo_group.min_selecoes == 1
            assert combo_group.max_selecoes == 1
            assert db.query(ProdutoGrupoModificador).filter_by(
                restaurante_id=2,
                produto_id="demo-combo-classico",
                grupo_id=combo_group.id,
            ).count() == 1

            base = db.query(Restaurante).filter_by(id=1).one()
            assert base.nome == "KÔMA Base"
    finally:
        engine.dispose()


def test_enrichment_refuses_unexpected_tenant():
    engine = _engine()
    try:
        Session = sessionmaker(bind=engine)
        with Session.begin() as db:
            db.add(Restaurante(id=3, nome="Outro tenant", slug="outro", billing_mode="legacy"))

        try:
            apply_enrichment(engine, expected_database=":memory:")
        except RuntimeError as exc:
            assert "tenants inesperados" in str(exc)
        else:
            raise AssertionError("enriquecimento deveria falhar fechado com tenant inesperado")
    finally:
        engine.dispose()
