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
    Text,
    UniqueConstraint,
)

from .database import Base, current_restaurante_id


class PagamentoAlocacao(Base):
    """Parte imutável de um pagamento atribuída a uma comanda/Conta.

    `Pagamento` continua sendo o evento de recebimento. Esta tabela preserva
    como aquele recebimento foi distribuído quando uma mesa possui várias
    comandas ou famílias de Atendimento/Conta.
    """

    __tablename__ = "pagamento_alocacoes"
    __table_args__ = (
        UniqueConstraint(
            "restaurante_id",
            "pagamento_id",
            "comanda_id",
            name="uq_pagamento_alocacao_comanda",
        ),
        CheckConstraint("valor > 0", name="ck_pagamento_alocacao_valor_positive"),
        Index(
            "ix_pagamento_alocacoes_tenant_pagamento",
            "restaurante_id",
            "pagamento_id",
        ),
        Index(
            "ix_pagamento_alocacoes_tenant_atendimento",
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
    pagamento_id = Column(
        String,
        ForeignKey("pagamentos.id", ondelete="CASCADE"),
        nullable=False,
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


class PagamentoEstorno(Base):
    """Evento financeiro imutável que reverte total ou parcialmente um pagamento.

    O pagamento aprovado original nunca é apagado nem reescrito. Dessa forma
    vendas brutas, estornos e vendas líquidas permanecem auditáveis.
    """

    __tablename__ = "pagamento_estornos"
    __table_args__ = (
        UniqueConstraint(
            "restaurante_id",
            "idempotency_key",
            name="uq_pagamento_estorno_idempotency",
        ),
        CheckConstraint("valor > 0", name="ck_pagamento_estorno_valor_positive"),
        CheckConstraint(
            "metodo IN ('dinheiro', 'pix', 'cartao', 'cartao_debito', 'cartao_credito')",
            name="ck_pagamento_estorno_metodo",
        ),
        Index(
            "ix_pagamento_estornos_tenant_pagamento",
            "restaurante_id",
            "pagamento_id",
        ),
        Index(
            "ix_pagamento_estornos_tenant_turno_created",
            "restaurante_id",
            "turno_id",
            "criado_em",
        ),
    )

    id = Column(String, primary_key=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    pagamento_id = Column(
        String,
        ForeignKey("pagamentos.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    turno_id = Column(
        Integer,
        ForeignKey("caixa_turnos.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    usuario_id = Column(
        String,
        ForeignKey("usuarios.id", ondelete="SET NULL"),
        nullable=True,
    )
    valor = Column(Numeric(14, 2, asdecimal=False), nullable=False)
    metodo = Column(String(20), nullable=False)
    motivo = Column(Text, nullable=False)
    idempotency_key = Column(String, nullable=False)
    criado_em = Column(
        DateTime,
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )
