from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..models import Comanda, Item, Usuario
from ..security import require_permission
from ..smartpos_models import SmartPosPaymentIntent


router = APIRouter(prefix="/smartpos/caixa", tags=["SmartPOS Caixa"])
_CENTAVO = Decimal("0.01")
_ACTIVE_INTENT_STATUSES = {"criada", "pendente", "processando", "aprovada"}


class SmartPosCashPaymentProjection(BaseModel):
    intent_id: str
    status: str
    metodo: str
    valor: Decimal
    captura: str
    provider: Optional[str] = None
    terminal_id: Optional[str] = None
    provider_reference: Optional[str] = None
    provider_last_error: Optional[str] = None
    pagamento_id: Optional[str] = None


class SmartPosCashTableProjection(BaseModel):
    mesa_id: int
    estado_operacional: Literal[
        "em_preparo",
        "pronto",
        "aguardando_pagamento",
        "pagamento_processando",
        "aprovado_pendente_liquidacao",
    ]
    valor_total: Decimal
    valor_pago: Decimal
    saldo: Decimal
    itens_ativos: int
    itens_preparando: int
    itens_prontos: int
    conta_pedida: bool
    pagamento: Optional[SmartPosCashPaymentProjection] = None


def _money(value: object) -> Decimal:
    return Decimal(str(value or 0)).quantize(_CENTAVO, rounding=ROUND_HALF_UP)


def _project_payment(intent: SmartPosPaymentIntent | None) -> SmartPosCashPaymentProjection | None:
    if intent is None:
        return None
    return SmartPosCashPaymentProjection(
        intent_id=intent.id,
        status=intent.status,
        metodo=intent.metodo,
        valor=_money(intent.valor),
        captura=intent.captura,
        provider=intent.provider_name,
        terminal_id=intent.provider_terminal_id,
        provider_reference=intent.provider_reference,
        provider_last_error=intent.provider_last_error,
        pagamento_id=intent.pagamento_id,
    )


@router.get("/operacao", response_model=list[SmartPosCashTableProjection])
def projetar_operacao_smartpos_no_caixa(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar")),
):
    """Projeção read-only para o Caixa; não cria um segundo estado operacional.

    Estado é derivado de Comanda/Item/PaymentIntent. O Caixa continua sendo a
    tela supervisora, enquanto o backend permanece a fonte de verdade. Erros do
    provider são projetados apenas como metadado para reconciliação operacional.
    """
    restaurante_id = require_tenant_id()
    comandas = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == restaurante_id,
            Comanda.fechada == False,
            Comanda.mesa_id.isnot(None),
        )
        .order_by(Comanda.mesa_id.asc(), Comanda.criado_em.asc(), Comanda.id.asc())
        .all()
    )
    if not comandas:
        return []

    mesa_ids = sorted({int(comanda.mesa_id) for comanda in comandas if comanda.mesa_id is not None})
    intents = (
        db.query(SmartPosPaymentIntent)
        .filter(
            SmartPosPaymentIntent.restaurante_id == restaurante_id,
            SmartPosPaymentIntent.mesa_id.in_(mesa_ids),
            SmartPosPaymentIntent.status.in_(_ACTIVE_INTENT_STATUSES),
        )
        .order_by(SmartPosPaymentIntent.status_em.desc(), SmartPosPaymentIntent.criado_em.desc())
        .all()
    )
    latest_intent_by_table: dict[int, SmartPosPaymentIntent] = {}
    for intent in intents:
        latest_intent_by_table.setdefault(int(intent.mesa_id), intent)

    grouped: dict[int, list[Comanda]] = {}
    for comanda in comandas:
        grouped.setdefault(int(comanda.mesa_id), []).append(comanda)

    result: list[SmartPosCashTableProjection] = []
    for mesa_id, table_commands in grouped.items():
        active_items: list[Item] = [
            item
            for comanda in table_commands
            for item in (comanda.itens or [])
            if item.status != "cancelado"
        ]
        total = _money(sum((_money(item.preco_unit) for item in active_items), Decimal("0.00")))
        paid = _money(sum((_money(comanda.valor_pago) for comanda in table_commands), Decimal("0.00")))
        balance = max(Decimal("0.00"), _money(total - paid))
        preparing = sum(1 for item in active_items if item.status == "preparando")
        ready = sum(1 for item in active_items if item.status in {"pronto", "entregue"})
        account_requested = any(comanda.status_comanda == "aguardando_pagamento" for comanda in table_commands)
        intent = latest_intent_by_table.get(mesa_id)

        if intent is not None and intent.status == "aprovada" and intent.pagamento_id is None:
            operational_state = "aprovado_pendente_liquidacao"
        elif intent is not None and intent.status in {"pendente", "processando"}:
            operational_state = "pagamento_processando"
        elif preparing > 0:
            operational_state = "em_preparo"
        elif active_items and ready == len(active_items):
            operational_state = "aguardando_pagamento" if balance > 0 else "pronto"
        elif account_requested:
            operational_state = "aguardando_pagamento"
        else:
            operational_state = "pronto"

        result.append(SmartPosCashTableProjection(
            mesa_id=mesa_id,
            estado_operacional=operational_state,
            valor_total=total,
            valor_pago=paid,
            saldo=balance,
            itens_ativos=len(active_items),
            itens_preparando=preparing,
            itens_prontos=ready,
            conta_pedida=account_requested,
            pagamento=_project_payment(intent),
        ))

    return result
