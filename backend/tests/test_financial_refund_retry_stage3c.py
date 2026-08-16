from __future__ import annotations

import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, current_restaurante_id
from app.financial_models import PagamentoAlocacao, PagamentoEstorno
from app.models import CaixaTurno, Comanda, Pagamento, Restaurante, Usuario
from app.services.refund_guard import create_refund_guarded


def test_full_refund_network_retry_returns_same_event_after_balance_reaches_zero():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    token = current_restaurante_id.set(1)
    Base.metadata.create_all(engine)
    db = Session()
    try:
        db.add(Restaurante(id=1, nome="Koma", plano="premium"))
        db.add(Usuario(
            id="u-caixa",
            restaurante_id=1,
            nome="Caixa",
            usuario="caixa",
            senha_hash="x",
            role="caixa",
            cargo="caixa",
            status="ativo",
        ))
        db.add(CaixaTurno(
            id=1,
            restaurante_id=1,
            aberto_por_id="u-caixa",
            aberto_em=datetime.datetime(2026, 8, 16, 18, 0),
            saldo_inicial=0,
            status="aberto",
        ))
        db.add(Comanda(
            id="cmd-full-retry",
            restaurante_id=1,
            garcom_id="u-caixa",
            fechada=True,
            fechado_em=datetime.datetime(2026, 8, 16, 19, 0),
            criado_em=datetime.datetime(2026, 8, 16, 18, 30),
            numero_pedido=999,
            valor_pago=10,
        ))
        db.commit()
        db.add(Pagamento(
            id="p-full-retry",
            restaurante_id=1,
            comanda_id="cmd-full-retry",
            turno_id=1,
            valor=10,
            metodo="pix",
            status="aprovado",
            idempotency_key="payment-full-retry",
            criado_em=datetime.datetime(2026, 8, 16, 19, 0),
        ))
        db.commit()
        db.add(PagamentoAlocacao(
            restaurante_id=1,
            pagamento_id="p-full-retry",
            comanda_id="cmd-full-retry",
            atendimento_id=None,
            valor=10,
            criado_em=datetime.datetime(2026, 8, 16, 19, 0),
        ))
        db.commit()

        kwargs = dict(
            restaurante_id=1,
            payment_id="p-full-retry",
            turno_id=1,
            usuario_id="u-caixa",
            valor=10,
            motivo="Devolução integral",
            idempotency_key="refund-full-network-retry",
            metodo_devolucao="pix",
        )
        first = create_refund_guarded(db, **kwargs)
        db.commit()
        second = create_refund_guarded(db, **kwargs)
        db.commit()

        assert first.id == second.id
        assert db.query(PagamentoEstorno).count() == 1
    finally:
        db.close()
        Base.metadata.drop_all(engine)
        engine.dispose()
        current_restaurante_id.reset(token)
