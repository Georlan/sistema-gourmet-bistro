from __future__ import annotations

from decimal import Decimal

import pytest

from app.database import Base, SessionLocal, current_restaurante_id, engine
from app.financial_models import PagamentoAlocacao, PagamentoEstorno
from app.financial_refund_models import PagamentoEstornoAlocacao, PagamentoEstornoLiquidacao
from app.models import (
    CaixaTurno,
    Categoria,
    Comanda,
    Insumo,
    Item,
    Lancamento,
    MovimentacaoEstoque,
    OnlinePaymentIntent,
    Pagamento,
    Produto,
    Restaurante,
    RestaurantPaymentAccount,
    Usuario,
)
from app.online_payment_refund_models import OnlinePaymentRefund
from app.services.inventory import SALE_ORIGIN
from app.services.online_payments.base import ProviderPayment, ProviderRefund
from app.services.online_payments.service import OnlinePaymentService
from app.services.refund_guard import create_refund_guarded


RESTAURANT_ID = 955101


@pytest.fixture
def b5_online_pix_db():
    Base.metadata.create_all(bind=engine)
    ctx = current_restaurante_id.set(RESTAURANT_ID)
    db = SessionLocal()
    try:
        for model in (
            OnlinePaymentRefund,
            PagamentoEstornoAlocacao,
            PagamentoEstornoLiquidacao,
            PagamentoEstorno,
            PagamentoAlocacao,
            OnlinePaymentIntent,
            Pagamento,
            MovimentacaoEstoque,
            Insumo,
            Item,
            Lancamento,
            Comanda,
            Produto,
            Categoria,
            CaixaTurno,
            RestaurantPaymentAccount,
            Usuario,
        ):
            db.query(model).filter(model.restaurante_id == RESTAURANT_ID).delete(
                synchronize_session=False
            )
        db.query(Restaurante).filter(Restaurante.id == RESTAURANT_ID).delete(
            synchronize_session=False
        )
        db.commit()

        db.add(Restaurante(id=RESTAURANT_ID, nome="B5 Online Pix Integrity", plano="pro"))
        db.flush()
        user = Usuario(
            id="b5-pix-user",
            restaurante_id=RESTAURANT_ID,
            nome="Operador B5",
            email="b5-pix@example.invalid",
            senha_hash="unused",
            role="admin",
            cargo="admin",
            status="ativo",
        )
        db.add(user)
        category = Categoria(
            id="b5-pix-cat",
            restaurante_id=RESTAURANT_ID,
            nome="Pratos",
        )
        db.add(category)
        db.flush()
        product = Produto(
            id="b5-pix-prod",
            restaurante_id=RESTAURANT_ID,
            categoria_id=category.id,
            nome="Prato Principal",
            preco=100.0,
            ativo=True,
        )
        db.add(product)
        insumo = Insumo(
            id="b5-pix-insumo",
            restaurante_id=RESTAURANT_ID,
            nome="File Mignon",
            unidade_medida="un",
            estoque_atual=9.0,
        )
        db.add(insumo)
        shift = CaixaTurno(
            restaurante_id=RESTAURANT_ID,
            aberto_por_id=user.id,
            saldo_inicial=0,
            status="aberto",
        )
        db.add(shift)
        account = RestaurantPaymentAccount(
            id="b5-pix-account",
            restaurante_id=RESTAURANT_ID,
            provider="mercado_pago",
            provider_user_id="seller-955101",
            status="active",
        )
        account.access_token = "test"
        account.webhook_secret = "test"
        db.add(account)
        db.flush()

        comanda = Comanda(
            id="b5-pix-comanda",
            restaurante_id=RESTAURANT_ID,
            garcom_id=user.id,
            numero_pedido=955101,
            tipo="Delivery",
            delivery_status="aceito",
            online_payment_status="pending",
            valor_pago=0.0,
            fechada=False,
        )
        db.add(comanda)
        db.flush()
        lancamento = Lancamento(
            id="b5-pix-lanc",
            restaurante_id=RESTAURANT_ID,
            comanda_id=comanda.id,
            garcom_id=user.id,
        )
        db.add(lancamento)
        db.flush()
        item = Item(
            id="b5-pix-item-1",
            restaurante_id=RESTAURANT_ID,
            comanda_id=comanda.id,
            lancamento_id=lancamento.id,
            produto_id=product.id,
            preco_unit=100.0,
            status="preparando",
            pago=False,
        )
        db.add(item)
        db.add(
            MovimentacaoEstoque(
                restaurante_id=RESTAURANT_ID,
                insumo_id=insumo.id,
                usuario_id=user.id,
                tipo="saida",
                quantidade=1.0,
                saldo_anterior=10.0,
                saldo_posterior=9.0,
                motivo="Baixa de venda teste B5",
                origem=SALE_ORIGIN,
                referencia_id=item.id,
            )
        )
        intent = OnlinePaymentIntent(
            id="b5-pix-intent",
            restaurante_id=RESTAURANT_ID,
            comanda_id=comanda.id,
            turno_id=shift.id,
            provider="mercado_pago",
            method="pix",
            status="pending",
            amount=100.0,
            marketplace_fee=0.0,
            idempotency_key=f"order-test-{RESTAURANT_ID}",
            external_payment_id="955101001",
        )
        db.add(intent)
        db.commit()
        yield db, account, shift, comanda, item, insumo, intent
    finally:
        db.rollback()
        for model in (
            OnlinePaymentRefund,
            PagamentoEstornoAlocacao,
            PagamentoEstornoLiquidacao,
            PagamentoEstorno,
            PagamentoAlocacao,
            OnlinePaymentIntent,
            Pagamento,
            MovimentacaoEstoque,
            Insumo,
            Item,
            Lancamento,
            Comanda,
            Produto,
            Categoria,
            CaixaTurno,
            RestaurantPaymentAccount,
            Usuario,
        ):
            db.query(model).filter(model.restaurante_id == RESTAURANT_ID).delete(
                synchronize_session=False
            )
        db.query(Restaurante).filter(Restaurante.id == RESTAURANT_ID).delete(
            synchronize_session=False
        )
        db.commit()
        db.close()
        current_restaurante_id.reset(ctx)


def test_online_pix_approval_materializes_payment_allocation_atomically(b5_online_pix_db):
    """Aprovação online deve atualizar valor_pago antes do flush para materializar PagamentoAlocacao."""
    db, account, _shift, comanda, item, _insumo, intent = b5_online_pix_db

    settled, became_approved = OnlinePaymentService.apply_provider_snapshot_in_session(
        db,
        account=account,
        intent=intent,
        payment=ProviderPayment(
            external_id="955101001",
            status="approved",
            amount=Decimal("100.00"),
            external_reference=intent.id,
        ),
    )
    db.commit()

    assert became_approved is True
    assert settled.pagamento_id is not None

    allocations = db.query(PagamentoAlocacao).filter(
        PagamentoAlocacao.restaurante_id == RESTAURANT_ID,
        PagamentoAlocacao.pagamento_id == settled.pagamento_id,
    ).all()
    assert len(allocations) == 1
    assert allocations[0].comanda_id == comanda.id
    assert Decimal(str(allocations[0].valor)) == Decimal("100.00")

    db.refresh(comanda)
    db.refresh(item)
    assert Decimal(str(comanda.valor_pago)) == Decimal("100.00")
    assert item.pago is True


def test_partial_online_pix_refund_preserves_order_items_and_stock_until_fully_refunded(
    monkeypatch, b5_online_pix_db
):
    """Estorno parcial de Pix online não pode cancelar a comanda, cancelar itens nem estornar estoque."""
    db, account, shift, comanda, item, insumo, intent = b5_online_pix_db

    settled, _ = OnlinePaymentService.apply_provider_snapshot_in_session(
        db,
        account=account,
        intent=intent,
        payment=ProviderPayment(
            external_id="955101001",
            status="approved",
            amount=Decimal("100.00"),
            external_reference=intent.id,
        ),
    )
    db.commit()
    payment_id = settled.pagamento_id
    assert payment_id is not None

    refund_seq = iter([
        ProviderRefund(
            external_id="955101901",
            payment_id="955101001",
            status="approved",
            amount=Decimal("40.00"),
        ),
        ProviderRefund(
            external_id="955101902",
            payment_id="955101001",
            status="approved",
            amount=Decimal("60.00"),
        ),
    ])

    class SequentialRefundProvider:
        def __init__(self, _access_token):
            pass

        def refund_payment(self, external_payment_id, *, amount, idempotency_key):
            return next(refund_seq)

    monkeypatch.setattr(
        "app.services.online_payments.refunds.MercadoPagoProvider",
        SequentialRefundProvider,
    )

    # 1. Partial refund of R$ 40.00 out of R$ 100.00 must keep order active and stock intact.
    partial_refund = create_refund_guarded(
        db,
        restaurante_id=RESTAURANT_ID,
        payment_id=payment_id,
        turno_id=shift.id,
        usuario_id="b5-pix-user",
        valor=Decimal("40.00"),
        motivo="Ajuste parcial por item indisponivel",
        idempotency_key=f"refund-test-partial-{RESTAURANT_ID}",
        metodo_devolucao="pix",
    )
    db.commit()
    assert Decimal(str(partial_refund.valor)) == Decimal("40.00")

    db.refresh(comanda)
    db.refresh(item)
    db.refresh(insumo)
    assert comanda.fechada is False
    assert comanda.online_payment_status == "approved"
    assert comanda.delivery_status == "aceito"
    assert item.status == "preparando"
    assert insumo.estoque_atual == 9.0

    # 2. Remaining R$ 60.00 refund reaches 100% refunded -> order must now close and restore stock.
    final_refund = create_refund_guarded(
        db,
        restaurante_id=RESTAURANT_ID,
        payment_id=payment_id,
        turno_id=shift.id,
        usuario_id="b5-pix-user",
        valor=Decimal("60.00"),
        motivo="Cancelamento do saldo restante do pedido",
        idempotency_key=f"refund-test-final-{RESTAURANT_ID}",
        metodo_devolucao="pix",
    )
    db.commit()
    assert Decimal(str(final_refund.valor)) == Decimal("60.00")

    db.refresh(comanda)
    db.refresh(item)
    db.refresh(insumo)
    assert comanda.fechada is True
    assert comanda.online_payment_status == "cancelled"
    assert comanda.delivery_status == "recusado"
    assert item.status == "cancelado"
    assert insumo.estoque_atual == 10.0


def test_replayed_approved_snapshot_does_not_overwrite_cancelled_status_after_full_refund(
    monkeypatch, b5_online_pix_db
):
    """Replay tardio de webhook/reconciliação 'approved' não pode ressuscitar pedido já reembolsado."""
    db, account, shift, comanda, item, _insumo, intent = b5_online_pix_db

    settled, _ = OnlinePaymentService.apply_provider_snapshot_in_session(
        db,
        account=account,
        intent=intent,
        payment=ProviderPayment(
            external_id="955101001",
            status="approved",
            amount=Decimal("100.00"),
            external_reference=intent.id,
        ),
    )
    db.commit()
    payment_id = settled.pagamento_id
    assert payment_id is not None

    class FullRefundProvider:
        def __init__(self, _access_token):
            pass

        def refund_payment(self, external_payment_id, *, amount, idempotency_key):
            return ProviderRefund(
                external_id="955101999",
                payment_id=external_payment_id,
                status="approved",
                amount=Decimal("100.00"),
            )

    monkeypatch.setattr(
        "app.services.online_payments.refunds.MercadoPagoProvider",
        FullRefundProvider,
    )

    create_refund_guarded(
        db,
        restaurante_id=RESTAURANT_ID,
        payment_id=payment_id,
        turno_id=shift.id,
        usuario_id="b5-pix-user",
        valor=Decimal("100.00"),
        motivo="Estorno integral do pedido Pix",
        idempotency_key=f"refund-test-full-{RESTAURANT_ID}",
        metodo_devolucao="pix",
    )
    db.commit()

    db.refresh(comanda)
    assert comanda.fechada is True
    assert comanda.online_payment_status == "cancelled"

    # Adversarial replay: stale/duplicate approved notification arrives after full refund.
    replayed_intent, became_approved = OnlinePaymentService.apply_provider_snapshot_in_session(
        db,
        account=account,
        intent=intent,
        payment=ProviderPayment(
            external_id="955101001",
            status="approved",
            amount=Decimal("100.00"),
            external_reference=intent.id,
        ),
    )
    db.commit()

    assert became_approved is False
    assert replayed_intent.pagamento_id == payment_id
    db.refresh(comanda)
    db.refresh(item)
    assert comanda.online_payment_status == "cancelled"
    assert comanda.fechada is True
    assert item.status == "cancelado"
    assert db.query(Pagamento).filter(
        Pagamento.restaurante_id == RESTAURANT_ID,
        Pagamento.comanda_id == comanda.id,
    ).count() == 1


def test_online_pix_approval_preserves_prior_partial_payment_on_released_unpaid_order(
    b5_online_pix_db,
):
    """Confirmar Pix após liberação sem pagamento não pode zerar/sobrescrever valor_pago prévio."""
    db, account, _shift, comanda, _item, _insumo, intent = b5_online_pix_db
    comanda.online_payment_status = "pending_released"
    comanda.valor_pago = 20.0
    intent.amount = 80.0
    db.commit()

    settled, became_approved = OnlinePaymentService.apply_provider_snapshot_in_session(
        db,
        account=account,
        intent=intent,
        payment=ProviderPayment(
            external_id="955101001",
            status="approved",
            amount=Decimal("80.00"),
            external_reference=intent.id,
        ),
    )
    db.commit()

    assert became_approved is True
    db.refresh(comanda)
    assert Decimal(str(comanda.valor_pago)) == Decimal("100.00")
    allocation = db.query(PagamentoAlocacao).filter(
        PagamentoAlocacao.restaurante_id == RESTAURANT_ID,
        PagamentoAlocacao.pagamento_id == settled.pagamento_id,
    ).one()
    assert Decimal(str(allocation.valor)) == Decimal("80.00")
