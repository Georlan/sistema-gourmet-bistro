"""Restricted-runtime reproduction and real PostgreSQL migration/RLS regression.
Run only against a fresh, disposable, loopback PostgreSQL database.
"""
import importlib.util
import os
from pathlib import Path
import pytest
from sqlalchemy import create_engine, text, inspect
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session
from sqlalchemy.exc import ProgrammingError
from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.database import Base
from app import models, crm_models
from app.routes import __init__  # noqa: F401
from app.services.customer_crm import ensure_crm_tables, enrich_customer_crm_payloads


def test_restricted_runtime_migration_and_tenant_isolation():
    url = os.environ.get('CRM_POSTGRES_TEST_URL')
    if not url:
     pytest.skip('Requires isolated local PostgreSQL via CRM_POSTGRES_TEST_URL')
    assert make_url(url).host in {'127.0.0.1', 'localhost'}, 'Only local test PostgreSQL is allowed'
    admin=create_engine(url)
    names={'crm_clientes_preferencias','crm_campanhas','crm_contatos_clientes'}
    Base.metadata.create_all(admin, tables=[t for t in Base.metadata.sorted_tables if t.name not in names])
    with admin.begin() as c:
     if not c.execute(text("SELECT 1 FROM pg_roles WHERE rolname='koma_app'")).first():
      c.execute(text('CREATE ROLE koma_app LOGIN PASSWORD \'crm-runtime-test-only\' NOSUPERUSER NOBYPASSRLS'))
     c.execute(text('REVOKE CREATE ON SCHEMA public FROM PUBLIC'))
     c.execute(text('GRANT USAGE ON SCHEMA public TO koma_app'))
     c.execute(text('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO koma_app'))
    runtime=create_engine(make_url(url).set(username='koma_app',password='crm-runtime-test-only'))
    # Reproduce deployed request-time DDL with a restricted runtime role.
    try:
     crm_models.CrmClientePreferencia.__table__.create(runtime)
     raise AssertionError('Old DDL unexpectedly succeeded')
    except ProgrammingError as e:
     assert e.orig.pgcode=='42501', e.orig.pgcode
     print('REPRODUCED: deployed request-time CREATE fails with PostgreSQL 42501')
    with runtime.connect() as c:
     trans=c.begin(); c.execute(text('SET TRANSACTION READ ONLY'))
     with Session(bind=c) as db:
      assert enrich_customer_crm_payloads(db,restaurante_id=6,payloads=[{'id':'fixture-only','saldo_pontos':90}],loyalty_enabled=False)[0]['opt_out_marketing'] is True
     trans.rollback()
    print('PASS: missing schema keeps baseline list read-only and marketing blocked')
    path=Path(__file__).resolve().parents[1] / 'alembic/versions/c8a2d4e6f901_operational_crm.py'
    spec=importlib.util.spec_from_file_location('crm_migration',path); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    with admin.begin() as c:
     c.execute(text("SET LOCAL lock_timeout='3s'"))
     with Operations.context(MigrationContext.configure(c)): m.upgrade()
    with Session(admin) as db:
     db.add_all([models.Restaurante(id=6,nome='Fixture Six'),models.Restaurante(id=8,nome='Fixture Eight')]); db.commit()
    with admin.begin() as c:
     c.execute(text("INSERT INTO crm_campanhas (id,restaurante_id,nome,objetivo,segmento_filtro,abordagem_tipo,template_mensagem,janela_atribuicao_dias,status,criado_em,atualizado_em) VALUES ('six',6,'Fixture campaign','CUSTOM','CUSTOM','SEM_DESCONTO','Fixture message',14,'RASCUNHO',now(),now()),('eight',8,'Other fixture','CUSTOM','CUSTOM','SEM_DESCONTO','Fixture message',14,'RASCUNHO',now(),now())"))
    with runtime.connect() as c:
     trans=c.begin(); c.execute(text('SET TRANSACTION READ ONLY')); c.execute(text("SELECT set_config('app.current_restaurante_id','6',true)"))
     with Session(bind=c) as db: ensure_crm_tables(db)
     assert c.execute(text('SELECT id FROM crm_campanhas')).scalars().all()==['six']
     trans.rollback()
    with runtime.begin() as c:
     c.execute(text("SELECT set_config('app.current_restaurante_id','6',true)"))
     assert c.execute(text("UPDATE crm_campanhas SET nome='Blocked' WHERE id='eight'")).rowcount==0
    with runtime.connect() as c:
     assert c.execute(text('SELECT id FROM crm_campanhas')).all()==[]
    with admin.connect() as c:
     rows=c.execute(text("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('crm_clientes_preferencias','crm_campanhas','crm_contatos_clientes')")).all()
     assert len(rows)==3 and all(r[1] and r[2] for r in rows)
    print('PASS: migration installs schema, grants and FORCE RLS; read-only runtime works; cross-tenant read/update blocked; absent tenant sees zero')
    # Empty local-only new tables so downgrade/upgrade can be simulated safely.
    with admin.begin() as c:
     with Operations.context(MigrationContext.configure(c)): m.downgrade()
     assert not names & set(inspect(c).get_table_names())
     with Operations.context(MigrationContext.configure(c)): m.upgrade()
    print('PASS: local downgrade/upgrade round trip')
