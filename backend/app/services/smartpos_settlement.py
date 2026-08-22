from __future__ import annotations

import datetime
import uuid
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import CaixaTurno, Comanda, Item, Pagamento
from ..operational_models import AtendimentoComanda, AtendimentoMesa
from ..smartpos_models import SmartPosPaymentIntent


_CENTAVO = Decimal("0.01")
_METHOD_MAP = {
    "dinheiro": "dinheiro",
    "pix": "pix",
    "debito": "cartao_debito",
    "credito": "cartao_credito",
}
_ALLOWED_CAPTURE_METHODS = {
    "provider_integrado": {"pix", "debito", "credito"},
    "dinheiro_pendente": {"dinheiro"},
    "registro_externo": {"pix", "debito", "credito"},
}


class SmartPosSettlementError(RuntimeError):
    pass


@dataclass(frozen=True)
class SmartPosSettlementResult:
    intent: SmartPosPaymentIntent
    pagamento: Pagamento
    replayed: bool
    mesa_liberada: bool


def _money(value: object) -> Decimal:
    return Decimal(str(value or 0)).quantize(_CENTAVO, rounding=ROUND_HALF_UP)


def _timeline_value(value: datetime.datetime) -> datetime.datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=datetime.timezone.utc)
    return value.astimezone(datetime.timezone.utc)


def _active_total(comanda: Comanda) -> Decimal:
    return _money(sum(
        (_money(item.preco_unit) for item in comanda.itens if item.status != "cancelado"),
        Decimal("0.00"),
    ))


def _settlement_key(intent_id: str) -> str:
    return f"smartpos:settlement:{intent_id}"


def _atendimento_family_ids(
    db: Session,
    *,
    restaurante_id: int,
    atendimento_id: str,
    lock: bool,
) -> list[str]:
    account_query = db.query(AtendimentoMesa).filter(
        AtendimentoMesa.restaurante_id == restaurante_id,
        AtendimentoMesa.id == atendimento_id,
    )
    if lock:
        account_query = account_query.with_for_update()
    account = account_query.first()
    if account is None:
        raise SmartPosSettlementError(
            "O atendimento vinculado ao PaymentIntent não pertence a este restaurante."
        )

    root_id = account.principal_id or account.id
    root_query = db.query(AtendimentoMesa).filter(
        AtendimentoMesa.restaurante_id == restaurante_id,
        AtendimentoMesa.id == root_id,
    )
    if lock:
        root_query = root_query.with_for_update()
    root = root_query.first()
    if root is None or root.principal_id is not None:
        raise SmartPosSettlementError(
            "A família principal vinculada ao PaymentIntent está inconsistente."
        )

    members_query = (
        db.query(AtendimentoMesa)
        .filter(
            AtendimentoMesa.restaurante_id == restaurante_id,
            or_(
                AtendimentoMesa.id == root.id,
                AtendimentoMesa.principal_id == root.id,
            ),
        )
        .order_by(AtendimentoMesa.criado_em.asc(), AtendimentoMesa.id.asc())
    )
    if lock:
        members_query = members_query.with_for_update()
    return [member.id for member in members_query.all()]


def _open_atendimento_comandas(
    db: Session,
    *,
    restaurante_id: int,
    atendimento_id: str,
    lock: bool,
) -> list[Comanda]:
    family_ids = _atendimento_family_ids(
        db,
        restaurante_id=restaurante_id,
        atendimento_id=atendimento_id,
        lock=lock,
    )
    linked_ids = [
        str(comanda_id)
        for (comanda_id,) in (
            db.query(AtendimentoComanda.comanda_id)
            .filter(
                AtendimentoComanda.restaurante_id == restaurante_id,
                AtendimentoComanda.atendimento_id.in_(family_ids),
            )
            .all()
        )
    ]
    if not linked_ids:
        return []

    commands_query = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == restaurante_id,
            Comanda.id.in_(linked_ids),
            Comanda.fechada == False,
        )
        .order_by(Comanda.criado_em.asc(), Comanda.id.asc())
    )
    if lock:
        commands_query = commands_query.with_for_update()
    return commands_query.all()


def _intent_open_comandas(
    db: Session,
    *,
    restaurante_id: int,
    intent: SmartPosPaymentIntent,
    lock: bool,
) -> list[Comanda]:
    if intent.atendimento_id is not None:
        return _open_atendimento_comandas(
            db,
            restaurante_id=restaurante_id,
            atendimento_id=intent.atendimento_id,
            lock=lock,
        )

    # Compatibilidade exclusiva com intents anteriores à identidade operacional.
    commands_query = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == restaurante_id,
            Comanda.mesa_id == intent.mesa_id,
            Comanda.fechada == False,
        )
        .order_by(Comanda.criado_em.asc(), Comanda.id.asc())
    )
    if lock:
        commands_query = commands_query.with_for_update()
    return commands_query.all()


def _intent_service_released(
    db: Session,
    *,
    restaurante_id: int,
    intent: SmartPosPaymentIntent,
) -> bool:
    return not _intent_open_comandas(
        db,
        restaurante_id=restaurante_id,
        intent=intent,
        lock=False,
    )


def settle_approved_smartpos_intent(
    db: Session,
    *,
    restaurante_id: int,
    intent_id: str,
) -> SmartPosSettlementResult:
    """Converte uma aprovação SmartPOS em Pagamento canônico exatamente uma vez.

    A aprovação (provider ou confirmação manual) já deve estar persistida antes
    desta chamada. Se a liquidação falhar, o intent permanece `aprovada` e pode
    ser reconciliado sem duplicar cobrança nem receita.
    """
    intent = (
        db.query(SmartPosPaymentIntent)
        .filter(
            SmartPosPaymentIntent.restaurante_id == restaurante_id,
            SmartPosPaymentIntent.id == intent_id,
        )
        .with_for_update()
        .first()
    )
    if intent is None:
        raise SmartPosSettlementError("Intenção de pagamento não encontrada para liquidação.")

    if intent.pagamento_id:
        pagamento = db.query(Pagamento).filter(
            Pagamento.restaurante_id == restaurante_id,
            Pagamento.id == intent.pagamento_id,
        ).first()
        if pagamento is None:
            raise SmartPosSettlementError("O vínculo financeiro do PaymentIntent está inconsistente.")
        mesa_liberada = _intent_service_released(
            db,
            restaurante_id=restaurante_id,
            intent=intent,
        )
        return SmartPosSettlementResult(intent, pagamento, True, mesa_liberada)

    if intent.status != "aprovada":
        raise SmartPosSettlementError("Somente PaymentIntent aprovado pode ser liquidado.")

    allowed_methods = _ALLOWED_CAPTURE_METHODS.get(intent.captura)
    if allowed_methods is None or intent.metodo not in allowed_methods:
        raise SmartPosSettlementError(
            "Método/captura ainda não possui liquidação financeira SmartPOS suportada."
        )

    metodo = _METHOD_MAP.get(intent.metodo)
    if metodo is None:
        raise SmartPosSettlementError(
            "Método ainda não suportado pela liquidação financeira SmartPOS nesta fase."
        )

    turno = (
        db.query(CaixaTurno)
        .filter(
            CaixaTurno.restaurante_id == restaurante_id,
            CaixaTurno.id == intent.turno_id,
        )
        .with_for_update()
        .first()
    )
    if turno is None or turno.status != "aberto":
        raise SmartPosSettlementError(
            "O turno associado ao pagamento não está mais aberto; requer reconciliação pelo Caixa."
        )

    key = _settlement_key(intent.id)
    existing = db.query(Pagamento).filter(
        Pagamento.restaurante_id == restaurante_id,
        Pagamento.idempotency_key == key,
    ).first()
    if existing is not None:
        intent.pagamento_id = existing.id
        intent.liquidado_em = intent.liquidado_em or existing.criado_em
        db.commit()
        db.refresh(intent)
        return SmartPosSettlementResult(
            intent,
            existing,
            True,
            _intent_service_released(
                db,
                restaurante_id=restaurante_id,
                intent=intent,
            ),
        )

    comandas = _intent_open_comandas(
        db,
        restaurante_id=restaurante_id,
        intent=intent,
        lock=True,
    )
    if not comandas:
        if intent.atendimento_id is not None:
            raise SmartPosSettlementError(
                "O atendimento vinculado não possui mais comanda aberta válida para receber esta aprovação."
            )
        raise SmartPosSettlementError(
            "A mesa não possui mais comanda aberta para receber esta aprovação."
        )

    if intent.atendimento_id is None:
        current_table_cycle_started_at = min(
            _timeline_value(comanda.criado_em) for comanda in comandas
        )
        if _timeline_value(intent.criado_em) < current_table_cycle_started_at:
            raise SmartPosSettlementError(
                "A aprovação pertence a um atendimento anterior desta mesa e não pode ser aplicada à comanda atual."
            )

    debitos: list[tuple[Comanda, Decimal, Decimal]] = []
    saldo_mesa = Decimal("0.00")
    for comanda in comandas:
        total = _active_total(comanda)
        pago = _money(comanda.valor_pago)
        saldo = max(Decimal("0.00"), total - pago)
        debitos.append((comanda, total, saldo))
        saldo_mesa += saldo

    valor = _money(intent.valor)
    if valor <= 0 or valor > saldo_mesa:
        raise SmartPosSettlementError(
            "O valor aprovado não é compatível com o saldo atual da mesa; requer reconciliação pelo Caixa."
        )

    selected_items: list[Item] = []
    if intent.escopo == "itens":
        requested_ids = list(dict.fromkeys(intent.item_ids or []))
        if not requested_ids:
            raise SmartPosSettlementError("PaymentIntent por itens não possui itens vinculados.")
        available = {
            item.id: item
            for comanda in comandas
            for item in comanda.itens
            if item.status != "cancelado" and not item.pago
        }
        if any(item_id not in available for item_id in requested_ids):
            raise SmartPosSettlementError(
                "Um ou mais itens do PaymentIntent já não estão disponíveis para liquidação."
            )
        selected_items = [available[item_id] for item_id in requested_ids]
        selected_total = _money(sum(
            (_money(item.preco_unit) for item in selected_items),
            Decimal("0.00"),
        ))
        if selected_total != valor:
            raise SmartPosSettlementError(
                "O valor aprovado diverge do total dos itens vinculados ao PaymentIntent."
            )

    remaining = valor
    now = datetime.datetime.now(datetime.timezone.utc)
    reference_comanda = next((row[0] for row in debitos if row[2] > 0), comandas[0])

    for comanda, total, saldo in debitos:
        if remaining <= 0:
            break
        if saldo <= 0:
            continue
        applied = min(remaining, saldo)
        comanda.valor_pago = float(_money(_money(comanda.valor_pago) + applied))
        remaining -= applied
        if _money(comanda.valor_pago) >= total:
            for item in comanda.itens:
                if item.status != "cancelado":
                    item.pago = True
            comanda.fechada = True
            comanda.fechado_em = now
            comanda.status_comanda = None

    for item in selected_items:
        item.pago = True

    pagamento = Pagamento(
        id=f"p-{uuid.uuid4().hex[:8]}",
        restaurante_id=restaurante_id,
        comanda_id=reference_comanda.id,
        turno_id=turno.id,
        valor=float(valor),
        metodo=metodo,
        status="aprovado",
        idempotency_key=key,
        nsu_cartao=(
            intent.provider_reference
            if metodo in {"cartao_debito", "cartao_credito"}
            else None
        ),
        criado_em=now,
    )
    db.add(pagamento)
    db.flush()

    intent.pagamento_id = pagamento.id
    intent.liquidado_em = now

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        recovered_intent = db.query(SmartPosPaymentIntent).filter(
            SmartPosPaymentIntent.restaurante_id == restaurante_id,
            SmartPosPaymentIntent.id == intent_id,
        ).first()
        recovered_payment = db.query(Pagamento).filter(
            Pagamento.restaurante_id == restaurante_id,
            Pagamento.idempotency_key == key,
        ).first()
        if recovered_intent is not None and recovered_payment is not None:
            if recovered_intent.pagamento_id is None:
                recovered_intent.pagamento_id = recovered_payment.id
                recovered_intent.liquidado_em = recovered_payment.criado_em
                db.commit()
            mesa_liberada = _intent_service_released(
                db,
                restaurante_id=restaurante_id,
                intent=recovered_intent,
            )
            return SmartPosSettlementResult(
                recovered_intent,
                recovered_payment,
                True,
                mesa_liberada,
            )
        raise SmartPosSettlementError("Falha de integridade ao liquidar o PaymentIntent.") from exc

    db.refresh(intent)
    db.refresh(pagamento)
    mesa_liberada = _intent_service_released(
        db,
        restaurante_id=restaurante_id,
        intent=intent,
    )
    return SmartPosSettlementResult(intent, pagamento, False, mesa_liberada)
