import pytest

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.financial_models import PagamentoAlocacao
from app.models import CaixaTurno, Comanda, Mesa, Pagamento, Restaurante, Usuario
from app.operational_models import AtendimentoComanda, AtendimentoMesa


TENANT = 3181
USER = "usr-finance-stage3-3181"


@pytest.fixture(autouse=True)
def setup_financial_allocation():
    Base.metadata.create_all(bind=engine)
    token = current_restaurante_id.set(TENANT)
    db = SessionLocal(restaurante_id=TENANT)
    try:
        db.query(PagamentoAlocacao).filter(
            PagamentoAlocacao.restaurante_id == TENANT
        ).delete(synchronize_session=False)
        db.query(Pagamento).filter(Pagamento.restaurante_id == TENANT).delete(
            synchronize_session=False
        )
        db.query(AtendimentoComanda).filter(
            AtendimentoComanda.restaurante_id == TENANT
        ).delete(synchronize_session=False)
        db.query(AtendimentoMesa).filter(
            AtendimentoMesa.restaurante_id == TENANT
        ).delete(synchronize_session=False)
        db.query(Comanda).filter(Comanda.restaurante_id == TENANT).delete(
            synchronize_session=False
        )
        db.query(CaixaTurno).filter(CaixaTurno.restaurante_id == TENANT).delete(
            synchronize_session=False
        )
        db.query(Mesa).filter(Mesa.restaurante_id == TENANT).delete(
            synchronize_session=False
        )
        db.query(Usuario).filter(Usuario.restaurante_id == TENANT).delete(
            synchronize_session=False
        )
        db.query(Restaurante).filter(Restaurante.id == TENANT).delete(
            synchronize_session=False
        )
        db.commit()

        db.add(Restaurante(id=TENANT, nome="Finance Stage 3", plano="bistro"))
        db.flush()
        db.add(
            Usuario(
                id=USER,
                restaurante_id=TENANT,
                nome="Caixa Financeiro",
                email="finance-stage3-3181@test.local",
                role="caixa",
                status="ativo",
            )
        )
        db.add(Mesa(id=7, restaurante_id=TENANT, capacidade=4, nome="Mesa 7"))
        db.flush()

        turno = CaixaTurno(
            restaurante_id=TENANT,
            aberto_por_id=USER,
            saldo_inicial=0,
            status="aberto",
        )
        db.add(turno)
        db.flush()

        command_a = Comanda(
            id="cmd-fin-a",
            restaurante_id=TENANT,
            mesa_id=7,
            garcom_id=USER,
            tipo="Consumo no Local",
            numero_pedido=46,
            valor_pago=0,
            fechada=False,
        )
        command_b = Comanda(
            id="cmd-fin-b",
            restaurante_id=TENANT,
            mesa_id=7,
            garcom_id=USER,
            tipo="Consumo no Local",
            numero_pedido=51,
            valor_pago=0,
            fechada=False,
        )
        db.add_all([command_a, command_b])
        db.flush()

        account_a = AtendimentoMesa(
            id="a-fin-46",
            restaurante_id=TENANT,
            numero_conta=46,
            periodo_ref="2026-08",
            mesa_id=7,
            status="aberto",
            proxima_sequencia=2,
        )
        account_b = AtendimentoMesa(
            id="a-fin-51",
            restaurante_id=TENANT,
            numero_conta=51,
            periodo_ref="2026-08",
            mesa_id=7,
            status="aberto",
            principal_id="a-fin-46",
            proxima_sequencia=2,
        )
        db.add_all([account_a, account_b])
        db.flush()
        db.add_all(
            [
                AtendimentoComanda(
                    restaurante_id=TENANT,
                    atendimento_id=account_a.id,
                    comanda_id=command_a.id,
                ),
                AtendimentoComanda(
                    restaurante_id=TENANT,
                    atendimento_id=account_b.id,
                    comanda_id=command_b.id,
                ),
            ]
        )
        db.commit()
        yield turno.id
    finally:
        db.close()
        current_restaurante_id.reset(token)


def test_one_approved_payment_materializes_exact_multi_command_allocation(
    setup_financial_allocation,
):
    db = SessionLocal(restaurante_id=TENANT)
    try:
        command_a = db.query(Comanda).filter(Comanda.id == "cmd-fin-a").one()
        command_b = db.query(Comanda).filter(Comanda.id == "cmd-fin-b").one()

        # Exatamente o que o endpoint de mesa faz: distribui o valor global
        # entre os saldos das comandas antes de registrar um único Pagamento.
        command_a.valor_pago = 15.00
        command_b.valor_pago = 5.00
        db.add(
            Pagamento(
                id="p-fin-multi",
                restaurante_id=TENANT,
                comanda_id=command_a.id,
                turno_id=setup_financial_allocation,
                valor=20.00,
                metodo="pix",
                status="aprovado",
                idempotency_key="fin-stage3-multi",
            )
        )
        db.commit()

        rows = (
            db.query(PagamentoAlocacao)
            .filter(PagamentoAlocacao.pagamento_id == "p-fin-multi")
            .order_by(PagamentoAlocacao.comanda_id)
            .all()
        )
        assert [row.comanda_id for row in rows] == ["cmd-fin-a", "cmd-fin-b"]
        assert [row.valor for row in rows] == [15.0, 5.0]
        assert [row.atendimento_id for row in rows] == ["a-fin-46", "a-fin-51"]
        assert sum(row.valor for row in rows) == 20.0
        assert db.query(Pagamento).filter(Pagamento.id == "p-fin-multi").count() == 1
    finally:
        db.close()


def test_pending_payment_is_allocated_only_when_approved(setup_financial_allocation):
    db = SessionLocal(restaurante_id=TENANT)
    try:
        command_a = db.query(Comanda).filter(Comanda.id == "cmd-fin-a").one()
        payment = Pagamento(
            id="p-fin-pending",
            restaurante_id=TENANT,
            comanda_id=command_a.id,
            turno_id=setup_financial_allocation,
            valor=10.00,
            metodo="dinheiro",
            status="pendente",
            idempotency_key="fin-stage3-pending",
        )
        db.add(payment)
        db.commit()

        assert db.query(PagamentoAlocacao).filter(
            PagamentoAlocacao.pagamento_id == payment.id
        ).count() == 0

        command_a.valor_pago = 10.00
        payment.status = "aprovado"
        db.commit()

        allocation = db.query(PagamentoAlocacao).filter(
            PagamentoAlocacao.pagamento_id == payment.id
        ).one()
        assert allocation.comanda_id == command_a.id
        assert allocation.atendimento_id == "a-fin-46"
        assert allocation.valor == 10.0
    finally:
        db.close()
