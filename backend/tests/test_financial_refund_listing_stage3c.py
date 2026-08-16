from __future__ import annotations

import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, current_restaurante_id
from app.financial_models import PagamentoAlocacao, PagamentoEstorno
from app.models import CaixaTurno, Comanda, Pagamento, Restaurante, Usuario
from app.routes.financial_refund_listing import find_refundable_payments


TENANT = 7313


def test_refundable_listing_scans_past_recent_fully_refunded_payments():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    token = current_restaurante_id.set(TENANT)
    Base.metadata.create_all(engine)
    db = Session()
    try:
        db.add(Restaurante(id=TENANT, nome="Stage 3C Listing", plano="premium"))
        db.add(Usuario(
            id="u-listing",
            restaurante_id=TENANT,
            nome="Caixa Listing",
            usuario="listing",
            senha_hash="x",
            role="caixa",
            cargo="caixa",
            status="ativo",
        ))
        db.add(CaixaTurno(
            id=7313,
            restaurante_id=TENANT,
            aberto_por_id="u-listing",
            aberto_em=datetime.datetime(2026, 8, 16, 18, 0),
            saldo_inicial=0,
            status="aberto",
        ))
        db.commit()

        base_time = datetime.datetime(2026, 8, 16, 20, 0)
        # Cinco pagamentos mais recentes já integralmente devolvidos. Com um
        # scanner incorreto limitado aos 2 mais recentes, o pagamento antigo
        # ainda estornável nunca apareceria.
        for index in range(5):
            command_id = f"cmd-refunded-{index}"
            payment_id = f"pay-refunded-{index}"
            created = base_time - datetime.timedelta(minutes=index)
            db.add(Comanda(
                id=command_id,
                restaurante_id=TENANT,
                garcom_id="u-listing",
                fechada=True,
                fechado_em=created,
                criado_em=created,
                numero_pedido=800 + index,
                valor_pago=10,
            ))
            db.commit()
            db.add(Pagamento(
                id=payment_id,
                restaurante_id=TENANT,
                comanda_id=command_id,
                turno_id=7313,
                valor=10,
                metodo="pix",
                status="aprovado",
                idempotency_key=f"payment-listing-{index}",
                criado_em=created,
            ))
            db.commit()
            db.add(PagamentoAlocacao(
                restaurante_id=TENANT,
                pagamento_id=payment_id,
                comanda_id=command_id,
                atendimento_id=None,
                valor=10,
                criado_em=created,
            ))
            db.add(PagamentoEstorno(
                id=f"refund-listing-{index}",
                restaurante_id=TENANT,
                pagamento_id=payment_id,
                turno_id=7313,
                usuario_id="u-listing",
                valor=10,
                metodo="pix",
                motivo="Integralmente devolvido",
                idempotency_key=f"refund-listing-key-{index}",
                criado_em=created + datetime.timedelta(seconds=1),
            ))
            db.commit()

        older_time = base_time - datetime.timedelta(hours=2)
        db.add(Comanda(
            id="cmd-older-refundable",
            restaurante_id=TENANT,
            garcom_id="u-listing",
            fechada=True,
            fechado_em=older_time,
            criado_em=older_time,
            numero_pedido=999,
            valor_pago=25,
        ))
        db.commit()
        db.add(Pagamento(
            id="pay-older-refundable",
            restaurante_id=TENANT,
            comanda_id="cmd-older-refundable",
            turno_id=7313,
            valor=25,
            metodo="pix",
            status="aprovado",
            idempotency_key="payment-older-refundable",
            criado_em=older_time,
        ))
        db.commit()
        db.add(PagamentoAlocacao(
            restaurante_id=TENANT,
            pagamento_id="pay-older-refundable",
            comanda_id="cmd-older-refundable",
            atendimento_id=None,
            valor=25,
            criado_em=older_time,
        ))
        db.commit()

        result = find_refundable_payments(
            db,
            TENANT,
            limite=1,
            batch_size=2,
        )

        assert len(result) == 1
        assert result[0]["id"] == "pay-older-refundable"
        assert result[0]["saldo_estornavel"] == 25.0
    finally:
        db.close()
        Base.metadata.drop_all(engine)
        engine.dispose()
        current_restaurante_id.reset(token)
