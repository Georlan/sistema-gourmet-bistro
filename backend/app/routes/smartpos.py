from decimal import Decimal, ROUND_HALF_UP
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
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
from ..smartpos_models import SmartPosPaymentIntent


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


class SmartPosManualConfirmationResponse(SmartPosPaymentIntentResponse):
    transition_replayed: bool = False


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

    mesa = db.query(Mesa).filter(
        Mesa.restaurante_id == restaurante_id,
        Mesa.id == payload.mesa_id,
    ).first()
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
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("smartpos:receber")),
):
    """Confirma apenas captura manual; ainda não cria Pagamento nem baixa financeira."""
    restaurante_id = require_tenant_id()
    if not has_capability(db, restaurante_id, "smartpos"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="SmartPOS não habilitado para este restaurante.",
        )

    intent = db.query(SmartPosPaymentIntent).filter(
        SmartPosPaymentIntent.restaurante_id == restaurante_id,
        SmartPosPaymentIntent.id == intent_id,
    ).first()
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

    try:
        result = transition_intent(
            db,
            intent=intent,
            target_status="aprovada",
            transition_key=payload.idempotency_key,
            actor_id=current_user.id,
            motivo=payload.motivo or "Recebimento confirmado manualmente pelo operador.",
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
        # Corrida de confirmação: recarrega e reaplica a chave idempotente.
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
                motivo=payload.motivo or "Recebimento confirmado manualmente pelo operador.",
            )
            db.commit()
        except InvalidSmartPosTransition as exc:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(exc),
            ) from exc

    db.refresh(intent)
    return {**_intent_payload(intent), "transition_replayed": result.replayed}
