from __future__ import annotations

import datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)

from .database import Base, current_restaurante_id


class PagamentoEstornoAlocacao(Base):
    """Origem financeira de uma parcela estornada.

    Um estorno continua sendo um único evento de saída financeira. Esta tabela
    registra de qual comanda/Conta veio cada parcela quando o pagamento original
    foi distribuído entre mais de uma família financeira.

    `pagamento_alocacao_id` pode ser nulo apenas para compatibilidade com dados
    históricos/integrações sem ledger de alocação materializado. Mesmo nesses
    casos `comanda_id` preserva uma origem explícita; nunca fazemos rateio por
    suposição.
    """

    __tablename__ = "pagamento_estorno_alocacoes"
    __table_args__ = (
        UniqueConstraint(
            "restaurante_id",
            "estorno_id",
            "comanda_id",
            name="uq_pagamento_estorno_alocacao_comanda",
        ),
        CheckConstraint(
            "valor > 0",
            name="ck_pagamento_estorno_alocacao_valor_positive",
        ),
        Index(
            "ix_pagamento_estorno_alocacoes_tenant_estorno",
            "restaurante_id",
            "estorno_id",
        ),
        Index(
            "ix_pagamento_estorno_alocacoes_tenant_pagamento",
            "restaurante_id",
            "pagamento_id",
        ),
        Index(
            "ix_pagamento_estorno_alocacoes_tenant_atendimento",
            "restaurante_id",
            "atendimento_id",
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    estorno_id = Column(
        String,
        ForeignKey("pagamento_estornos.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    pagamento_id = Column(
        String,
        ForeignKey("pagamentos.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    pagamento_alocacao_id = Column(
        Integer,
        ForeignKey("pagamento_alocacoes.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    comanda_id = Column(
        String,
        ForeignKey("comandas.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    atendimento_id = Column(
        String,
        ForeignKey("atendimentos_mesa.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    valor = Column(Numeric(14, 2, asdecimal=False), nullable=False)
    criado_em = Column(
        DateTime,
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )
