from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import ConfiguracaoRestaurante, Mesa, Restaurante
from app.services.table_bootstrap import bootstrap_standard_tables


def _session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Restaurante.__table__.create(engine)
    ConfiguracaoRestaurante.__table__.create(engine)
    Mesa.__table__.create(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    db = Session()
    db.add(Restaurante(id=1, nome="Pizzaria Teste", plano="pro"))
    db.add(
        ConfiguracaoRestaurante(
            restaurante_id=1,
            mapa_mesas_ativo=False,
            tipos_pedido_ativos=["consumo_local"],
        )
    )
    db.commit()
    return db


def test_bootstrap_tables_creates_standard_missing_range_and_enables_map():
    db = _session()
    try:
        result = bootstrap_standard_tables(db, tenant_id=1, count=5, default_capacity=4)
        db.commit()
        assert result.created_ids == (1, 2, 3, 4, 5)
        assert result.total_after == 5
        assert result.table_map_enabled is True
        rows = db.query(Mesa).filter(Mesa.restaurante_id == 1).order_by(Mesa.id).all()
        assert [(row.id, row.nome, row.capacidade) for row in rows] == [
            (1, "Mesa 1", 4),
            (2, "Mesa 2", 4),
            (3, "Mesa 3", 4),
            (4, "Mesa 4", 4),
            (5, "Mesa 5", 4),
        ]
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=1).one()
        assert config.mapa_mesas_ativo is True
    finally:
        db.close()


def test_bootstrap_tables_is_idempotent_and_never_overwrites_or_deletes_existing_tables():
    db = _session()
    try:
        bootstrap_standard_tables(db, tenant_id=1, count=5, default_capacity=4)
        db.commit()
        custom = db.query(Mesa).filter_by(restaurante_id=1, id=2).one()
        custom.nome = "Varanda VIP"
        custom.capacidade = 8
        db.commit()

        expanded = bootstrap_standard_tables(db, tenant_id=1, count=7, default_capacity=6)
        db.commit()
        assert expanded.created_ids == (6, 7)
        custom = db.query(Mesa).filter_by(restaurante_id=1, id=2).one()
        assert custom.nome == "Varanda VIP"
        assert custom.capacidade == 8
        assert db.query(Mesa).filter_by(restaurante_id=1, id=6).one().capacidade == 6

        reduced = bootstrap_standard_tables(db, tenant_id=1, count=3, default_capacity=4)
        db.commit()
        assert reduced.created_ids == ()
        assert reduced.total_after == 7
        assert db.query(Mesa).filter_by(restaurante_id=1).count() == 7
    finally:
        db.close()
