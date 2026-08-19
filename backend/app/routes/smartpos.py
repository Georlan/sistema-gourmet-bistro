from decimal import Decimal, ROUND_HALF_UP
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..models import CaixaTurno, Comanda, Item, Mesa, Restaurante, Usuario
from ..security import get_current_user, require_permission
from ..services.capabilities import has_capability
from ..services.smartpos_payment_state import (
    InvalidSmartPosTransition,
    initial_status_for_capture,
    transition_intent,
)
from ..services.smartpos_settlement import (
    SmartPosSettlementError,
    settle_approved_smartpos_intent,
)
from ..smartpos_models import SmartPosPaymentIntent
from .websocket import manager


router = APIRouter(prefix="/smartpos", tags=["SmartPOS"])
_ALLOWED_ROLES = {"garcom", "caixa", "gerente"}
_CENTAVO = Decimal("0.01")
_CAPTURE_OPTIONS_BY_METHOD = {
    "dinheiro": {"dinheiro_pendente"},
    "pix": {"provider_integrado", "registro_externo"},
    "debito": {"provider_integrado", "registro_externo"},
    "credito": {"provider_integrado", "registro_externo"},
    "voucher": {"provider_integrado", "registro_externo"},
}
_MANUAL_CAPTURES = {"dinheiro_pendente", "registro_externo"}
_RESERVING_STATUSES = ("criada", "pendente", "processando", "aprovada")


class SmartPosPaymentIntentCreate(BaseModel):
    mesa_id: int = Field(gt=0)
    valor: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    metodo: Literal["dinheiro", "pix", "debito", "credito", "voucher"]
    captura: Optional[Literal["provider_integrado", "registro_externo"]] = None
    escopo: Literal["valor", "itens"] = "valor"
    item_ids: Optional[list[str]] = None
    idempotency_key: str = Field(min_length=8, max_length=128)


class SmartPosPaymentIntentResponse(BaseModel):
    id: str
    mesa_id: int
    turno_id: int
    operador_id: str
    valor: Decimal
    metodo: str
    captura: str
    escopo: str
    item_ids: Optional[list[str]] = None
    idempotency_key: str
    status: str
    origem: str


class SmartPosManualConfirmation(BaseModel):
    idempotency_key: str = Field(min_length=8, max_length=128)
    motivo: Optional[str] = Field(default=None, max_length=255)
    valor_recebido: Optional[Decimal] = Field(
        default=None, gt=0, max_digits=14, decimal_places=2
    )


class SmartPosManualConfirmationResponse(SmartPosPaymentIntentResponse):
    transition_replayed: bool = False
    payment_id: Optional[str] = None
    settled: bool = False
    financial_effect: bool = False
    troco: Decimal = Decimal("0.00")


class SmartPosIntentCancellation(BaseModel):
    idempotency_key: str = Field(min_length=8, max_length=128)
    motivo: Optional[str] = Field(default=None, max_length=255)


class SmartPosIntentCancellationResponse(SmartPosPaymentIntentResponse):
    transition_replayed: bool = False
    financial_effect: bool = False


def _money(value: object) -> Decimal:
    return Decimal(str(value or 0)).quantize(_CENTAVO, rounding=ROUND_HALF_UP)


def _capture_for_method(method: str, requested: Optional[str]) -> str:
    allowed = _CAPTURE_OPTIONS_BY_METHOD.get(method)
    if allowed is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Forma de pagamento não suportada pelo SmartPOS.",
        )

    if method == "dinheiro":
        if requested is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Dinheiro usa conferência manual e não aceita outro modo de captura.",
            )
        return "dinheiro_pendente"

    if method == "voucher":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Voucher ainda não possui liquidação financeira na maquininha.",
        )

    capture = requested or "provider_integrado"
    if capture not in allowed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Modo de captura incompatível com a forma de pagamento.",
        )
    return capture


def _intent_payload(intent: SmartPosPaymentIntent) -> dict:
    return {
        "id": intent.id,
        "mesa_id": intent.mesa_id,
        "turno_id": intent.turno_id,
        "operador_id": intent.operador_id,
        "valor": _money(intent.valor),
        "metodo": intent.metodo,
        "captura": intent.captura,
        "escopo": intent.escopo,
        "item_ids": list(intent.item_ids or []) or None,
        "idempotency_key": intent.idempotency_key,
        "status": intent.status,
        "origem": intent.origem,
    }


def _same_intent_request(
    intent: SmartPosPaymentIntent,
    payload: SmartPosPaymentIntentCreate,
    *,
    valor: Decimal,
    normalized_items: list[str],
    captura: str,
) -> bool:
    return (
        intent.mesa_id == payload.mesa_id
        and _money(intent.valor) == valor
        and intent.metodo == payload.metodo
        and intent.captura == captura
        and intent.escopo == payload.escopo
        and sorted(intent.item_ids or []) == normalized_items
    )


@router.get("/contexto")
def obter_contexto_smartpos(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Contexto mínimo para navegação do SmartPOS, sem dados de caixa."""
    role = (current_user.role or current_user.cargo or "").strip().lower()
    if role not in _ALLOWED_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Este perfil não possui acesso operacional ao SmartPOS.",
        )

    restaurante_id = require_tenant_id()
    restaurante = db.query(Restaurante).filter(
        Restaurante.id == restaurante_id,
    ).first()
    if restaurante is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Restaurante não encontrado.",
        )

    smartpos_enabled = has_capability(db, restaurante_id, "smartpos")
    turno = db.query(CaixaTurno).filter(
        CaixaTurno.restaurante_id == restaurante_id,
        CaixaTurno.status == "aberto",
    ).first()
    turno_aberto = turno is not None

    return {
        "smartpos_enabled": smartpos_enabled,
        "turno_aberto": turno_aberto,
        "turno_id": turno.id if turno else None,
        "mesas_disponiveis": smartpos_enabled and turno_aberto,
        "pedidos_disponiveis": smartpos_enabled and turno_aberto,
        "venda_rapida_disponivel": smartpos_enabled,
        "restaurante": {
            "id": restaurante.id,
            "nome": restaurante.nome,
        },
        "operador": {
            "id": current_user.id,
            "nome": current_user.nome,
            "role": role,
            "restaurante_id": restaurante_id,
        },
    }


@router.post(
    "/payment-intents",
    response_model=SmartPosPaymentIntentResponse,
    status_code=status.HTTP_201_CREATED,
)
def criar_payment_intent(
    payload: SmartPosPaymentIntentCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("smartpos:receber")),
):
    """Prepara um recebimento sem criar Pagamento nem alterar a mesa."""
    restaurante_id = require_tenant_id()
    if not has_capability(db, restaurante_id, "smartpos"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="SmartPOS não habilitado para este restaurante.",
        )

    normalized_key = payload.idempotency_key.strip()
    if len(normalized_key) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A chave idempotente deve possuir ao menos 8 caracteres úteis.",
        )
    normalized_items = sorted(set(payload.item_ids or []))
    valor = _money(payload.valor)
    captura = _capture_for_method(payload.metodo, payload.captura)

    existing = db.query(SmartPosPaymentIntent).filter(
        SmartPosPaymentIntent.restaurante_id == restaurante_id,
        SmartPosPaymentIntent.idempotency_key == normalized_key,
    ).first()
    if existing:
        if not _same_intent_request(
            existing,
            payload,
            valor=valor,
            normalized_items=normalized_items,
            captura=captura,
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A chave idempotente já foi usada com outro recebimento.",
            )
        return _intent_payload(existing)

    turno = db.query(CaixaTurno).filter(
        CaixaTurno.restaurante_id == restaurante_id,
        CaixaTurno.status == "aberto",
    ).first()
    if turno is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Abra o caixa do salão antes de preparar um recebimento de mesa.",
        )

    mesa = (
        db.query(Mesa)
        .filter(
            Mesa.restaurante_id == restaurante_id,
            Mesa.id == payload.mesa_id,
        )
        .with_for_update()
        .first()
    )
    if mesa is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mesa não encontrada.",
        )

    comandas = db.query(Comanda).filter(
        Comanda.restaurante_id == restaurante_id,
        Comanda.mesa_id == payload.mesa_id,
        Comanda.fechada == False,
    ).all()
    if not comandas:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A mesa não possui consumo em aberto.",
        )

    comanda_ids = [comanda.id for comanda in comandas]
    itens = db.query(Item).filter(
        Item.restaurante_id == restaurante_id,
        Item.comanda_id.in_(comanda_ids),
        Item.status != "cancelado",
    ).all()
    total_consumo = sum((_money(item.preco_unit) for item in itens), Decimal("0.00"))
    total_pago = sum((_money(comanda.valor_pago) for comanda in comandas), Decimal("0.00"))
    saldo = max(Decimal("0.00"), total_consumo - total_pago)
    if saldo <= 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A mesa não possui saldo pendente.",
        )

    # Primeiro valida o conteúdo intrínseco da parcela contra o consumo real.
    # Conflitos de formato/valor continuam 422; concorrência entre parcelas é 409.
    if valor > saldo:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="O valor informado excede o saldo da mesa.",
        )

    if payload.escopo == "itens":
        if not normalized_items:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Selecione ao menos um item para receber por itens.",
            )
        by_id = {item.id: item for item in itens if not item.pago}
        if any(item_id not in by_id for item_id in normalized_items):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Há item inválido, pago ou fora desta mesa.",
            )
        selected_total = sum(
            (_money(by_id[item_id].preco_unit) for item_id in normalized_items),
            Decimal("0.00"),
        )
        if selected_total != valor:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="O valor deve corresponder exatamente aos itens selecionados.",
            )
    elif normalized_items:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="item_ids só pode ser informado quando o escopo for por itens.",
        )

    # Parcelas ainda não liquidadas reservam saldo. O lock da Mesa acima faz
    # duas criações concorrentes enxergarem uma ordem total no PostgreSQL.
    reserving_intents = (
        db.query(SmartPosPaymentIntent)
        .filter(
            SmartPosPaymentIntent.restaurante_id == restaurante_id,
            SmartPosPaymentIntent.mesa_id == payload.mesa_id,
            SmartPosPaymentIntent.status.in_(_RESERVING_STATUSES),
            SmartPosPaymentIntent.pagamento_id.is_(None),
        )
        .with_for_update()
        .all()
    )

    reserved_item_ids = {
        item_id
        for active_intent in reserving_intents
        if active_intent.escopo == "itens"
        for item_id in (active_intent.item_ids or [])
    }
    if payload.escopo == "itens" and any(
        item_id in reserved_item_ids for item_id in normalized_items
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Um ou mais itens já estão reservados por outro pagamento em andamento.",
        )

    reservado = sum(
        (_money(active_intent.valor) for active_intent in reserving_intents),
        Decimal("0.00"),
    )
    disponivel = max(Decimal("0.00"), saldo - reservado)
    if disponivel <= 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="O saldo da mesa já está reservado por pagamento em andamento.",
        )
    if valor > disponivel:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "O valor excede o saldo disponível após considerar pagamentos em andamento. "
                f"Disponível: {disponivel}."
            ),
        )

    intent = SmartPosPaymentIntent(
        restaurante_id=restaurante_id,
        turno_id=turno.id,
        mesa_id=payload.mesa_id,
        operador_id=current_user.id,
        valor=valor,
        metodo=payload.metodo,
        captura=captura,
        escopo=payload.escopo,
        item_ids=normalized_items or None,
        idempotency_key=normalized_key,
        status="criada",
        origem="smartpos",
    )
    db.add(intent)
    try:
        db.flush()
        initial_status = initial_status_for_capture(captura)
        if initial_status != "criada":
            transition_intent(
                db,
                intent=intent,
                target_status=initial_status,
                transition_key=f"init:{normalized_key}",
                actor_id=current_user.id,
                motivo="Aguardando confirmação manual do recebimento.",
            )
        db.commit()
    except IntegrityError:
        db.rollback()
        concurrent = db.query(SmartPosPaymentIntent).filter(
            SmartPosPaymentIntent.restaurante_id == restaurante_id,
            SmartPosPaymentIntent.idempotency_key == normalized_key,
        ).first()
        if concurrent:
            if not _same_intent_request(
                concurrent,
                payload,
                valor=valor,
                normalized_items=normalized_items,
                captura=captura,
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A chave idempotente já foi usada com outro recebimento.",
                )
            return _intent_payload(concurrent)
        raise
    db.refresh(intent)
    return _intent_payload(intent)


@router.post(
    "/payment-intents/{intent_id}/confirmar-manual",
    response_model=SmartPosManualConfirmationResponse,
)
def confirmar_payment_intent_manual(
    intent_id: str,
    payload: SmartPosManualConfirmation,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("smartpos:receber")),
):
    """Confirma captura manual e liquida no mesmo financeiro canônico do Caixa."""
    restaurante_id = require_tenant_id()
    if not has_capability(db, restaurante_id, "smartpos"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="SmartPOS não habilitado para este restaurante.",
        )

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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Intenção de pagamento não encontrada.",
        )
    if intent.captura not in _MANUAL_CAPTURES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Pagamentos integrados só podem ser aprovados pelo fluxo do provider.",
        )

    troco = Decimal("0.00")
    motivo = payload.motivo or "Recebimento confirmado manualmente pelo operador."
    if intent.captura == "dinheiro_pendente":
        valor_recebido = _money(payload.valor_recebido if payload.valor_recebido is not None else intent.valor)
        valor_intent = _money(intent.valor)
        if valor_recebido < valor_intent:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="O valor recebido em dinheiro não pode ser menor que o valor a pagar.",
            )
        troco = _money(valor_recebido - valor_intent)
        motivo = (
            payload.motivo
            or f"Dinheiro confirmado: recebido {valor_recebido}; troco {troco}."
        )
    elif payload.valor_recebido is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="valor_recebido só se aplica a pagamentos em dinheiro.",
        )

    try:
        result = transition_intent(
            db,
            intent=intent,
            target_status="aprovada",
            transition_key=payload.idempotency_key,
            actor_id=current_user.id,
            motivo=motivo,
        )
        db.commit()
    except InvalidSmartPosTransition as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except IntegrityError:
        db.rollback()
        intent = db.query(SmartPosPaymentIntent).filter(
            SmartPosPaymentIntent.restaurante_id == restaurante_id,
            SmartPosPaymentIntent.id == intent_id,
        ).one()
        try:
            result = transition_intent(
                db,
                intent=intent,
                target_status="aprovada",
                transition_key=payload.idempotency_key,
                actor_id=current_user.id,
                motivo=motivo,
            )
            db.commit()
        except InvalidSmartPosTransition as exc:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(exc),
            ) from exc

    try:
        settlement = settle_approved_smartpos_intent(
            db,
            restaurante_id=restaurante_id,
            intent_id=intent_id,
        )
    except SmartPosSettlementError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Recebimento confirmado, mas ainda não liquidado no Caixa: {exc}",
        ) from exc

    background_tasks.add_task(
        manager.broadcast,
        {
            "event": "payment_intent_updated",
            "detail": {
                "intent_id": intent_id,
                "mesa_id": settlement.intent.mesa_id,
                "status": settlement.intent.status,
                "payment_id": settlement.pagamento.id,
            },
        },
        restaurante_id,
    )
    for event_name in ("payment_updated", "cash_updated", "tables_updated"):
        background_tasks.add_task(
            manager.broadcast,
            {
                "event": event_name,
                "detail": {
                    "type": "smartpos_manual_settlement",
                    "intent_id": intent_id,
                    "payment_id": settlement.pagamento.id,
                    "mesa_id": settlement.intent.mesa_id,
                    "metodo": settlement.pagamento.metodo,
                    "valor": float(settlement.pagamento.valor),
                    "mesa_liberada": settlement.mesa_liberada,
                },
            },
            restaurante_id,
        )

    db.refresh(settlement.intent)
    return {
        **_intent_payload(settlement.intent),
        "transition_replayed": result.replayed,
        "payment_id": settlement.pagamento.id,
        "settled": True,
        "financial_effect": True,
        "troco": troco,
    }

@router.post(
    "/payment-intents/{intent_id}/cancelar",
    response_model=SmartPosIntentCancellationResponse,
)
def cancelar_payment_intent(
    intent_id: str,
    payload: SmartPosIntentCancellation,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("smartpos:receber")),
):
    """Cancela somente antes de existir cobrança/efeito financeiro."""
    restaurante_id = require_tenant_id()
    if not has_capability(db, restaurante_id, "smartpos"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="SmartPOS não habilitado para este restaurante.",
        )

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
        raise HTTPException(status_code=404, detail="Intenção de pagamento não encontrada.")
    if intent.pagamento_id is not None:
        raise HTTPException(
            status_code=409,
            detail="Este recebimento já foi liquidado. Use o estorno financeiro do Caixa.",
        )
    if intent.status == "processando":
        raise HTTPException(
            status_code=409,
            detail=(
                "A cobrança já está em processamento no terminal. "
                "Não é seguro cancelar; reconcilie o resultado da mesma operação."
            ),
        )
    if intent.status == "aprovada":
        raise HTTPException(
            status_code=409,
            detail=(
                "A cobrança já foi aprovada e aguarda liquidação. "
                "Não cancele: conclua a reconciliação financeira."
            ),
        )

    try:
        result = transition_intent(
            db,
            intent=intent,
            target_status="cancelada",
            transition_key=payload.idempotency_key,
            actor_id=current_user.id,
            motivo=payload.motivo or "Recebimento cancelado pelo operador antes da cobrança.",
        )
        db.commit()
    except InvalidSmartPosTransition as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    db.refresh(intent)
    background_tasks.add_task(
        manager.broadcast,
        {
            "event": "payment_intent_updated",
            "detail": {
                "intent_id": intent.id,
                "mesa_id": intent.mesa_id,
                "status": intent.status,
                "type": "smartpos_intent_cancelled",
            },
        },
        restaurante_id,
    )
    background_tasks.add_task(
        manager.broadcast,
        {
            "event": "tables_updated",
            "detail": {
                "type": "smartpos_intent_cancelled",
                "mesa_id": intent.mesa_id,
                "intent_id": intent.id,
            },
        },
        restaurante_id,
    )
    return {
        **_intent_payload(intent),
        "transition_replayed": result.replayed,
        "financial_effect": False,
    }
