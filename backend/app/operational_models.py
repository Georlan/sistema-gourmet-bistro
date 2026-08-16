import datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    UniqueConstraint,
    text,
)

from .database import Base, current_restaurante_id


class NumeradorOperacional(Base):
    """Contador humano por restaurante e mês operacional.

    Não substitui IDs técnicos. Ele existe apenas para gerar números curtos e
    legíveis usados em Conta #46 / Pedido #46-A.
    """

    __tablename__ = "numeradores_operacionais"
    __table_args__ = (
        UniqueConstraint(
            "restaurante_id",
            "periodo_ref",
            name="uq_numerador_operacional_periodo",
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
    periodo_ref = Column(String(7), nullable=False)
    ultimo_numero = Column(Integer, nullable=False, default=0)
    atualizado_em = Column(
        DateTime,
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )


class AtendimentoMesa(Base):
    """Família financeira imutável de uma ocupação de mesa."""

    __tablename__ = "atendimentos_mesa"
    __table_args__ = (
        UniqueConstraint(
            "restaurante_id",
            "periodo_ref",
            "numero_conta",
            name="uq_atendimento_conta_periodo",
        ),
        CheckConstraint(
            "status IN ('aberto', 'fechado')",
            name="ck_atendimento_status",
        ),
        CheckConstraint(
            "proxima_sequencia >= 1",
            name="ck_atendimento_proxima_sequencia",
        ),
        Index(
            "ix_atendimento_tenant_open_mesa",
            "restaurante_id",
            "mesa_id",
            postgresql_where=text("status = 'aberto'"),
        ).ddl_if(dialect="postgresql"),
    )

    id = Column(String, primary_key=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    numero_conta = Column(Integer, nullable=False)
    periodo_ref = Column(String(7), nullable=False)
    mesa_id = Column(Integer, nullable=True, index=True)
    status = Column(String(16), nullable=False, default="aberto", index=True)
    principal_id = Column(
        String,
        ForeignKey("atendimentos_mesa.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    proxima_sequencia = Column(Integer, nullable=False, default=1)
    criado_em = Column(
        DateTime,
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )
    fechado_em = Column(DateTime, nullable=True)


class AtendimentoComanda(Base):
    __tablename__ = "atendimento_comandas"
    __table_args__ = (
        UniqueConstraint(
            "restaurante_id",
            "comanda_id",
            name="uq_atendimento_comanda",
        ),
        Index(
            "ix_atendimento_comandas_atendimento",
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
    atendimento_id = Column(
        String,
        ForeignKey("atendimentos_mesa.id", ondelete="CASCADE"),
        nullable=False,
    )
    comanda_id = Column(
        String,
        ForeignKey("comandas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )


class LancamentoIdentidade(Base):
    __tablename__ = "lancamento_identidades"
    __table_args__ = (
        UniqueConstraint(
            "restaurante_id",
            "lancamento_id",
            name="uq_lancamento_identidade",
        ),
        UniqueConstraint(
            "restaurante_id",
            "atendimento_id",
            "sequencia",
            name="uq_lancamento_sequencia_atendimento",
        ),
        CheckConstraint("sequencia >= 1", name="ck_lancamento_sequencia_positive"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    atendimento_id = Column(
        String,
        ForeignKey("atendimentos_mesa.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    lancamento_id = Column(
        String,
        ForeignKey("lancamentos.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sequencia = Column(Integer, nullable=False)
    criado_em = Column(
        DateTime,
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )


class MovimentoAtendimento(Base):
    """Ledger imutável de deslocamentos físicos e agrupamentos de contas."""

    __tablename__ = "movimentos_atendimento"
    __table_args__ = (
        CheckConstraint(
            "tipo IN ('abertura', 'transferencia', 'mesclagem', 'desmesclagem', "
            "'transferencia_item', 'fechamento', 'reabertura', 'promocao_principal')",
            name="ck_movimento_atendimento_tipo",
        ),
        Index(
            "ix_movimento_atendimento_tenant_atendimento_created",
            "restaurante_id",
            "atendimento_id",
            "criado_em",
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
    atendimento_id = Column(
        String,
        ForeignKey("atendimentos_mesa.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tipo = Column(String(32), nullable=False)
    mesa_origem_id = Column(Integer, nullable=True)
    mesa_destino_id = Column(Integer, nullable=True)
    ator_id = Column(String, ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    detalhes = Column(JSON, nullable=True)
    criado_em = Column(
        DateTime,
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )
