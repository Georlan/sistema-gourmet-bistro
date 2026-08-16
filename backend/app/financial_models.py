import datetime
from decimal import Decimal, ROUND_HALF_UP

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
    event,
    inspect as sa_inspect,
)
from sqlalchemy.orm import Session

from .database import Base, current_restaurante_id


_CENT = Decimal("0.01")


def _money(value: object) -> Decimal:
    return Decimal(str(value or 0)).quantize(_CENT, rounding=ROUND_HALF_UP)


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


def _status_became_approved(payment: object) -> bool:
    state = sa_inspect(payment)
    if state.pending:
        return getattr(payment, "status", None) == "aprovado"
    history = state.attrs.status.history
    return bool(
        getattr(payment, "status", None) == "aprovado"
        and history.has_changes()
        and "aprovado" in history.added
    )


def _paid_delta(command: object) -> Decimal:
    history = sa_inspect(command).attrs.valor_pago.history
    if not history.has_changes():
        return Decimal("0.00")
    old = _money(history.deleted[0] if history.deleted else 0)
    new = _money(history.added[0] if history.added else getattr(command, "valor_pago", 0))
    return _money(new - old)


@event.listens_for(Session, "before_flush")
def materialize_payment_allocations(session: Session, flush_context, instances) -> None:
    """Materializa o grão pagamento→comanda a partir dos deltas da transação.

    O fluxo de mesa já distribui `valor_pago` entre uma ou mais comandas antes
    do commit. Capturar esses deltas no mesmo `flush` evita duplicar a regra de
    distribuição em outra camada e mantém pagamento + alocações atômicos.

    Pagamentos pendentes só ganham alocação quando passam para `aprovado`.
    Pagamentos históricos migrados já possuem alocação e são ignorados.
    """
    from .models import Comanda, Pagamento
    from .operational_models import AtendimentoComanda

    approved = [
        obj
        for obj in tuple(session.new) + tuple(session.dirty)
        if isinstance(obj, Pagamento) and _status_became_approved(obj)
    ]
    if not approved:
        return

    changed_commands = []
    for obj in session.dirty:
        if not isinstance(obj, Comanda):
            continue
        delta = _paid_delta(obj)
        if delta > 0:
            changed_commands.append((obj, delta))

    if not changed_commands:
        # Importações, fixtures e integrações externas podem registrar um
        # pagamento aprovado sem alterar uma comanda na mesma unidade de
        # trabalho. O pagamento continua sendo receita, apenas sem projeção de
        # alocação até que um vínculo explícito seja conhecido.
        return

    new_allocation_payment_ids = {
        obj.pagamento_id
        for obj in session.new
        if isinstance(obj, PagamentoAlocacao)
    }

    for payment in approved:
        if payment.id in new_allocation_payment_ids:
            continue

        with session.no_autoflush:
            existing = (
                session.query(PagamentoAlocacao.id)
                .filter(
                    PagamentoAlocacao.restaurante_id == payment.restaurante_id,
                    PagamentoAlocacao.pagamento_id == payment.id,
                )
                .first()
            )
        if existing is not None:
            continue

        reference = next(
            (command for command, _ in changed_commands if command.id == payment.comanda_id),
            None,
        )
        if reference is None:
            continue

        if reference.mesa_id is None:
            candidates = [
                (command, delta)
                for command, delta in changed_commands
                if command.id == reference.id
            ]
        else:
            candidates = [
                (command, delta)
                for command, delta in changed_commands
                if command.restaurante_id == payment.restaurante_id
                and command.mesa_id == reference.mesa_id
            ]

        allocated = _money(sum((delta for _, delta in candidates), Decimal("0.00")))
        expected = _money(payment.valor)
        if allocated != expected:
            raise ValueError(
                "Inconsistência financeira: os deltas de valor_pago da transação "
                f"somam {allocated}, mas o pagamento aprovado é {expected}."
            )

        command_ids = [command.id for command, _ in candidates]
        with session.no_autoflush:
            attendance_rows = (
                session.query(AtendimentoComanda.comanda_id, AtendimentoComanda.atendimento_id)
                .filter(
                    AtendimentoComanda.restaurante_id == payment.restaurante_id,
                    AtendimentoComanda.comanda_id.in_(command_ids),
                )
                .all()
            )
        attendance_map = {
            str(command_id): attendance_id
            for command_id, attendance_id in attendance_rows
        }

        for command, delta in candidates:
            session.add(
                PagamentoAlocacao(
                    restaurante_id=payment.restaurante_id,
                    pagamento_id=payment.id,
                    comanda_id=command.id,
                    atendimento_id=attendance_map.get(str(command.id)),
                    valor=float(delta),
                    criado_em=payment.criado_em
                    or datetime.datetime.now(datetime.timezone.utc),
                )
            )
