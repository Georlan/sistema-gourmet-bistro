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


def test_explicit_range_preserves_existing_tables_other_tenants_and_map_setting():
    db = _session()
    try:
        db.add(Restaurante(id=2, nome="Outra loja", plano="pro"))
        db.add(Mesa(restaurante_id=2, id=9, nome="Outra varanda", capacidade=7))
        for number in range(1, 9):
            db.add(Mesa(restaurante_id=1, id=number, nome=f"Personalizada {number}", capacidade=2))
        db.commit()
        result = bootstrap_standard_tables(db, tenant_id=1, first_number=9, count=30,
                                           default_capacity=4, activate_map=False)
        db.commit()
        assert result.created_ids == tuple(range(9,31))
        assert result.total_after == 30
        assert result.table_map_enabled is False
        assert [(row.nome, row.capacidade) for row in db.query(Mesa).filter(Mesa.restaurante_id==1, Mesa.id<=8).order_by(Mesa.id)] == [(f"Personalizada {n}",2) for n in range(1,9)]
        assert db.query(Mesa).filter_by(restaurante_id=2, id=9).one().nome == "Outra varanda"
        repeat = bootstrap_standard_tables(db, tenant_id=1, first_number=9, count=30,
                                           default_capacity=8, activate_map=False)
        db.commit()
        assert repeat.created_ids == ()
        assert db.query(Mesa).filter_by(restaurante_id=1, id=9).one().capacidade == 4
        assert db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=1).one().mapa_mesas_ativo is False
    finally:
        db.close()


def test_range_fills_gaps_without_creating_numbers_before_start():
    db = _session()
    try:
        db.add(Mesa(restaurante_id=1, id=12, nome="VIP", capacidade=8))
        db.commit()
        result = bootstrap_standard_tables(db, tenant_id=1, first_number=10, count=13,
                                           default_capacity=4, activate_map=False)
        db.commit()
        assert result.created_ids == (10,11,13)
        assert db.query(Mesa).filter_by(restaurante_id=1).count() == 4
        assert db.query(Mesa).filter_by(restaurante_id=1, id=12).one().nome == "VIP"
    finally:
        db.close()


def test_range_endpoint_commits_one_audit_and_one_notification(monkeypatch):
    from types import SimpleNamespace
    from fastapi import BackgroundTasks, HTTPException
    from sqlalchemy.exc import IntegrityError
    from app.models import ActivityLog, Usuario
    from app.routes import tables
    import pytest
    db = _session()
    Usuario.__table__.create(db.get_bind())
    ActivityLog.__table__.create(db.get_bind())
    db.add(Usuario(id="owner", nome="Dono", cargo="admin", restaurante_id=1))
    db.commit()
    monkeypatch.setattr(tables, "require_tenant_id", lambda: 1)
    try:
        tasks = BackgroundTasks()
        payload = tables.MesaRangeCreate(first_number=9,last_number=30,capacity=4)
        result = tables.create_mesas_lote(payload,tasks,db,SimpleNamespace(id="owner"))
        assert result == {"created_ids":list(range(9,31)),"preserved_count":0,"total_after":22}
        assert len(tasks.tasks) == 1
        assert tasks.tasks[0].args[1] == 1
        assert db.query(ActivityLog).one().action == "TABLES_RANGE_CREATE"
        repeat_tasks = BackgroundTasks()
        result = tables.create_mesas_lote(payload,repeat_tasks,db,SimpleNamespace(id="owner"))
        assert result["created_ids"] == [] and result["preserved_count"] == 22
        assert repeat_tasks.tasks == []
        real_commit = db.commit
        def fail_commit():
            raise IntegrityError("simulated competing table insert", {}, Exception("conflict"))
        monkeypatch.setattr(db, "commit", fail_commit)
        with pytest.raises(HTTPException) as error:
            tables.create_mesas_lote(tables.MesaRangeCreate(first_number=31,last_number=32),BackgroundTasks(),db,SimpleNamespace(id="owner"))
        assert error.value.status_code == 409
        monkeypatch.setattr(db, "commit", real_commit)
        assert db.query(Mesa).filter(Mesa.id>=31).count() == 0
        assert db.query(ActivityLog).count() == 2
    finally:
        db.close()


def test_range_route_requires_authentication_and_cashier_permission():
    from types import SimpleNamespace
    from fastapi.testclient import TestClient
    from app.main import app
    from app.security import get_current_user
    client = TestClient(app)
    assert client.post("/mesas/lote",json={"first_number":9,"last_number":30,"capacity":4}).status_code == 401
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(cargo="garcom")
    try:
        assert client.post("/mesas/lote",json={"first_number":9,"last_number":30,"capacity":4}).status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_invalid_range_is_rejected_without_writes(monkeypatch):
    from types import SimpleNamespace
    from fastapi import BackgroundTasks, HTTPException
    from pydantic import ValidationError
    from app.routes import tables
    import pytest
    for values in ({"first_number":0,"last_number":30},{"first_number":1,"last_number":301},{"first_number":1,"last_number":30,"capacity":51}):
        with pytest.raises(ValidationError):
            tables.MesaRangeCreate(**values)
    monkeypatch.setattr(tables, "require_tenant_id", lambda: 1)
    db = _session()
    try:
        with pytest.raises(HTTPException) as error:
            tables.create_mesas_lote(tables.MesaRangeCreate(first_number=30,last_number=9),BackgroundTasks(),db,SimpleNamespace(id="owner"))
        assert error.value.status_code == 422
        assert db.query(Mesa).count() == 0
    finally:
        db.close()
