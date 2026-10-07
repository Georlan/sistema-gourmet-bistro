"""Operational demand does not follow payments or duplicate item counts."""
import datetime as dt
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
import pytest
from app.database import Base
from app.models import Restaurante, Usuario, Comanda, Categoria, Produto, Lancamento, Item, Insumo, ProdutoInsumo
from app.services.financial_read import resolve_financial_period
from app.services.menu_intelligence import menu_intelligence, order_entry_hour_rows

@pytest.fixture
def db():
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        for tenant in (9917, 9918):
            session.add(Restaurante(id=tenant, nome='Test', plano='bistro'))
            session.flush()
            session.add(Usuario(id=f'u{tenant}', restaurante_id=tenant, nome='User', usuario=f'u{tenant}', senha_hash='unused', role='admin', status='ativo'))
            session.add(Categoria(id=f'cat{tenant}', restaurante_id=tenant, nome='Bebidas'))
            session.flush()
            session.add(Comanda(id=f'c{tenant}', restaurante_id=tenant, garcom_id=f'u{tenant}', tipo='Consumo no Local', numero_pedido=1))
        session.flush()
        for pid, price, active in [('acerola', 7, True), ('sem-saida', 10, True), ('pausado', 10, False), ('margem', 8, True)]:
            session.add(Produto(id=pid, restaurante_id=9917, nome=pid, categoria_id='cat9917', preco=price, ativo=active))
        session.add(Produto(id='outro', restaurante_id=9918, nome='outro', categoria_id='cat9918', preco=20))
        session.flush()
        session.add(Insumo(id='custo', restaurante_id=9917, nome='Polpa', unidade_medida='un', preco_medio_custo=9))
        session.flush()
        session.add(ProdutoInsumo(restaurante_id=9917, produto_id='margem', insumo_id='custo', quantidade=1))
        session.commit()
        yield session
    engine.dispose()

def launch(db, lid, timestamp, items, tenant=9917, status='pendente', test=False):
    cid = f'c{tenant}'
    if test:
        cid = 'test-command'
        db.add(Comanda(id=cid, restaurante_id=tenant, garcom_id=f'u{tenant}', tipo='Consumo no Local', numero_pedido=2, onboarding_test=True))
        db.flush()
    db.add(Lancamento(id=lid, restaurante_id=tenant, comanda_id=cid, garcom_id=f'u{tenant}', timestamp=timestamp, status=status))
    db.flush()
    for index, (pid, price, item_status) in enumerate(items):
        db.add(Item(id=f'{lid}-{index}', restaurante_id=tenant, comanda_id=cid, lancamento_id=lid, produto_id=pid, preco_unit=price, status=item_status))
    db.commit()

def test_unpaid_entry_count_once_and_local_day_bounds(db):
    launch(db, 'before', dt.datetime(2026, 10, 2, 2, 59), [('acerola', 7, 'pronto')])
    launch(db, 'midnight', dt.datetime(2026, 10, 2, 3), [('acerola', 7, 'pronto')])
    launch(db, 'peak', dt.datetime(2026, 10, 2, 14), [('acerola', 7, 'pronto')] * 3)
    launch(db, 'cancelled', dt.datetime(2026, 10, 2, 14, 30), [('acerola', 7, 'cancelado')], status='cancelado')
    launch(db, 'empty', dt.datetime(2026, 10, 2, 14), [])
    launch(db, 'onboarding', dt.datetime(2026, 10, 2, 14), [('acerola', 7, 'pronto')], test=True)
    launch(db, 'foreign', dt.datetime(2026, 10, 2, 14), [('outro', 20, 'pronto')], tenant=9918)
    launch(db, 'after', dt.datetime(2026, 10, 3, 3), [('acerola', 7, 'pronto')])
    period = resolve_financial_period(db, 9917, '2026-10-02', '2026-10-02')
    rows = order_entry_hour_rows(db, 9917, period)
    assert rows[0]['total_pedidos'] == 1
    assert rows[11]['total_pedidos'] == 2  # two orders, regardless of four item rows
    assert sum(row['total_pedidos'] for row in rows) == 3

def test_comparison_costs_cancellations_and_constant_queries(db):
    launch(db, 'previous', dt.datetime(2026, 10, 1, 14), [('acerola', 7, 'pronto')] * 4)
    launch(db, 'current', dt.datetime(2026, 10, 2, 14), [('acerola', 7, 'pronto')] * 2 + [('margem', 6, 'pronto'), ('acerola', 7, 'cancelado')])
    launch(db, 'refused', dt.datetime(2026, 10, 2, 14), [('acerola', 7, 'pronto')], status='recusado')
    launch(db, 'other-tenant', dt.datetime(2026, 10, 2, 14), [('outro', 20, 'pronto')], tenant=9918)
    selects = []
    def count(_c, _cursor, statement, *_rest):
        if statement.lstrip().upper().startswith('SELECT'):
            selects.append(statement)
    event.listen(db.bind, 'before_cursor_execute', count)
    try:
        report = menu_intelligence(db, 9917, '2026-10-02', '2026-10-02')
    finally:
        event.remove(db.bind, 'before_cursor_execute', count)
    assert len(selects) == 3  # aggregate + catalog with recipes + categories; no per-product reads
    assert report['unidades'] == 3
    assert report['inicio_anterior'] == report['fim_anterior'] == '2026-10-01'
    rows = {p['produto_id']: p for p in report['produtos']}
    assert 'outro' not in rows
    assert rows['acerola']['unidades'] == 2
    assert rows['acerola']['unidades_anteriores'] == 4
    assert rows['acerola']['variacao_pct'] == -50
    assert rows['acerola']['custo_unitario'] is None
    assert rows['sem-saida']['variacao_pct'] is None
    assert any(s['tipo'] == 'sem_saida' for s in rows['sem-saida']['sugestoes'])
    assert not any(s['tipo'] == 'sem_saida' for s in rows['pausado']['sugestoes'])
    assert rows['margem']['custo_unitario'] == 9
    assert rows['margem']['margem_unitaria_cardapio'] == -1
    assert rows['margem']['preco_medio'] == 6
    assert any(s['tipo'] == 'rever_preco' for s in rows['margem']['sugestoes'])
