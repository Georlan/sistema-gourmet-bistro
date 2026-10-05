"""Isolated read-model regression: no HTTP auth or shared SQLite files."""
import datetime

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app.database import Base, current_restaurante_id
from app.models import Restaurante, Usuario, CaixaTurno, Comanda, Pagamento, Categoria, Produto, Lancamento, Item
from app.financial_models import PagamentoAlocacao
from app.services.financial_read import load_financial_snapshot, daily_financial_rows


def test_civil_selection_is_tenant_scoped_and_query_count_is_constant():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    token = current_restaurante_id.set(9917)
    try:
        with Session(engine) as db:
            for tenant in (9917, 9918):
                db.add(Restaurante(id=tenant, nome=f"Reports {tenant}", plano="bistro"))
                db.flush()
                user_id = f"report-user-{tenant}"
                command_id = f"report-command-{tenant}"
                db.add(Usuario(id=user_id, restaurante_id=tenant, nome="Reports", usuario=user_id,
                               senha_hash="unused", role="admin", status="ativo"))
                db.flush()
                db.add(CaixaTurno(id=tenant, restaurante_id=tenant, aberto_por_id=user_id,
                                 aberto_em=datetime.datetime(2026, 10, 2, 15), status="aberto", saldo_inicial=0))
                db.add(Comanda(id=command_id, restaurante_id=tenant, garcom_id=user_id,
                               tipo="Consumo no Local", numero_pedido=1))
                db.flush()
                for number in range(30):
                    payment_id = f"report-payment-{tenant}-{number}"
                    db.add(Pagamento(id=payment_id, restaurante_id=tenant, comanda_id=command_id,
                                     turno_id=tenant, status="aprovado", valor=10, metodo="pix",
                                     criado_em=datetime.datetime(2026, 10, 3, 15), idempotency_key=payment_id))
                    db.flush()
                    db.add(PagamentoAlocacao(restaurante_id=tenant, pagamento_id=payment_id,
                                            comanda_id=command_id, valor=10))
            db.add(Categoria(id="report-category", restaurante_id=9917, nome="Pratos"))
            db.flush()
            db.add(Produto(id="report-product", restaurante_id=9917, nome="Prato", categoria_id="report-category", preco=25))
            db.add(Lancamento(id="report-launch", restaurante_id=9917, comanda_id="report-command-9917", garcom_id="report-user-9917", timestamp=datetime.datetime(2026, 10, 2, 15)))
            db.flush()
            db.add(Item(id="report-item", restaurante_id=9917, comanda_id="report-command-9917", lancamento_id="report-launch", produto_id="report-product", preco_unit=25, status="entregue"))
            db.commit()
            selects = []
            def count_select(_connection, _cursor, statement, _parameters, _context, _many):
                if statement.lstrip().upper().startswith("SELECT"):
                    selects.append(statement)
            event.listen(engine, "before_cursor_execute", count_select)
            snapshot = load_financial_snapshot(db, 9917, "2026-10-03", "2026-10-03")
            assert len(selects) == 4
            assert len(snapshot.payments) == 30
            assert len(snapshot.sales) == 1
            assert daily_financial_rows(snapshot)[0]["total"] == 300
            selects.clear()
            load_financial_snapshot(db, 9917, "2026-10-03", "2026-10-03", include_refunds=False)
            assert len(selects) == 3
            event.remove(engine, "before_cursor_execute", count_select)
            from app.routes.financial_product_routes import get_relatorio_produtos_operacional
            def products(day):
                return get_relatorio_produtos_operacional(data_inicio=day, data_fim=day,
                    ordenacao="mais_vendidos", busca=None, categoria_id=None, db=db, current_user=None)
            # Item lançado dia 2, mas associado ao recebimento do dia 3, sem rateio.
            assert products("2026-10-02")[0]["quantidade_consumida"] == 0
            received = products("2026-10-03")[0]
            assert received["quantidade_consumida"] == 1
            assert received["valor_consumido"] == 25
            assert received["custo_unitario_estimado"] is None
    finally:
        current_restaurante_id.reset(token)
        engine.dispose()
