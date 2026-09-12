from __future__ import annotations

import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..application.printing import (
    PrintAction,
    PrintIntent,
    PrintSourceType,
    PrintingApplicationService,
    UniversalPrintingError,
)
from ..application.printing.comanda_renderer import ComandaVariant, render_canonical_comanda
from ..database import get_db, require_tenant_id
from ..domain.printing import PrintItem
from ..models import PrintJob, Usuario
from ..security import ensure_permission, get_current_user, require_permission
from ..services.printing import get_print_preferences
from ..waiter_permissions import require_waiter_permission


router = APIRouter(prefix="/impressao", tags=["Impressão"])


class UniversalPrintRequest(BaseModel):
    source_type: PrintSourceType
    source_id: str = Field(min_length=1, max_length=128)
    action: PrintAction = PrintAction.PRINT
    table_id: Optional[int] = Field(default=None, gt=0)
    values_only: bool = False
    courier_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    quantity_added: int = Field(default=0, ge=0, le=999)
    idempotency_key: Optional[str] = Field(default=None, min_length=8, max_length=180)


def _authorize_universal_print(
    db: Session,
    current_user: Usuario,
    source_type: PrintSourceType,
) -> None:
    if source_type == PrintSourceType.CASH_SHIFT:
        ensure_permission(current_user, "caixa:operar")
        return
    require_waiter_permission(db, current_user, "perm_garcom_print")


def _execute_print(
    db: Session,
    current_user: Usuario,
    payload: UniversalPrintRequest,
) -> list:
    _authorize_universal_print(db, current_user, payload.source_type)
    restaurante_id = require_tenant_id()
    try:
        jobs = PrintingApplicationService.request_print(
            db,
            PrintIntent(
                restaurant_id=restaurante_id,
                source_type=payload.source_type,
                source_id=payload.source_id,
                action=payload.action,
                table_id=payload.table_id,
                values_only=payload.values_only,
                requested_by=current_user.nome,
                courier_name=payload.courier_name,
                quantity_added=payload.quantity_added,
                idempotency_key=payload.idempotency_key,
            ),
        )
        db.commit()
    except UniversalPrintingError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Não foi possível processar a impressão solicitada.",
        ) from exc

    if not jobs:
        if (
            payload.source_type == PrintSourceType.ITEM
            and payload.action == PrintAction.ITEM_CHANGE
        ):
            return []
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="A impressão física não está disponível no plano atual.",
        )
    return jobs


@router.post("", status_code=status.HTTP_200_OK)
def imprimir_universal(
    payload: UniversalPrintRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Entrada canônica para qualquer solicitação interna de impressão.

    A rota recebe somente intenção/origem. O Core de Impressão resolve regra,
    motor, snapshot, documento, destino e PrintJob. URLs antigas permanecem
    temporariamente somente como aliases sem lógica própria enquanto o frontend
    termina a migração.
    """
    jobs = _execute_print(db, current_user, payload)
    return {
        "status": "success",
        "detail": (
            "Impressão enviada para a fila."
            if jobs
            else "Nenhuma via necessária para esta intenção."
        ),
        "job_ids": [job.id for job in jobs],
        "jobs": [
            {
                "id": job.id,
                "document_type": job.document_type,
                "destination": job.destination,
                "source_type": job.source_type,
                "source_id": job.source_id,
            }
            for job in jobs
        ],
    }


@router.post(
    "/teste-extremo-cardapio",
    status_code=status.HTTP_200_OK,
)
def imprimir_teste_extremo_cardapio(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("impressao:administrar")),
):
    """Enfileira uma comanda extrema sintética sem criar pedido ou movimentação real."""
    restaurante_id = require_tenant_id()
    preferences = get_print_preferences(db, restaurante_id)
    items = [
        PrintItem(
            codigo="T01",
            nome="DUPLO BURGER ARTESANAL ESPECIAL COM QUEIJO E BACON",
            quantidade=2,
            preco_unit=33.90,
            observacao=(
                "SEM CEBOLA, PONTO DA CARNE BEM PASSADO, ADICIONAR CATUPIRY ORIGINAL "
                "E MOLHO ESPECIAL SEPARADO"
            ),
        ),
        PrintItem(
            codigo="T02",
            nome="COMBO FRANGO CROCANTE GRANDE COM BATATA E REFRIGERANTE",
            quantidade=1,
            preco_unit=42.50,
            observacao=(
                "BATATA SEM SAL, REFRIGERANTE SEM GELO, MOLHO DE ALHO E KETCHUP SEPARADOS"
            ),
        ),
        PrintItem(
            codigo="T03",
            nome="PIZZA INDIVIDUAL QUATRO QUEIJOS COM BORDA RECHEADA",
            quantidade=1,
            preco_unit=29.75,
            observacao="BORDA DE CHEDDAR, SEM ORÉGANO, ADICIONAR BACON CROCANTE",
        ),
        PrintItem(
            codigo="T04",
            nome="PORÇÃO DE MINI PASTÉIS SORTIDOS DA CASA",
            quantidade=2,
            preco_unit=18.00,
            observacao=(
                "SABORES CARNE, QUEIJO E FRANGO; IDENTIFICAR OS SABORES NA EMBALAGEM"
            ),
        ),
        PrintItem(
            codigo="T05",
            nome="SOBREMESA ESPECIAL CHOCOLATE COM MORANGO",
            quantidade=1,
            preco_unit=16.90,
            observacao="CALDA DE CHOCOLATE SEPARADA E SEM AÇÚCAR DE CONFEITEIRO",
        ),
    ]
    delivery_fee = 7.50
    coupon_discount = 12.00
    cashback_discount = 8.50
    items_total = sum(float(item.total) for item in items)
    final_total = round(
        max(0.0, items_total + delivery_fee - coupon_discount - cashback_discount),
        2,
    )
    now = datetime.datetime.now(datetime.timezone.utc)
    source_id = f"teste-extremo-{now.strftime('%Y%m%d%H%M%S%f')}"
    payload = render_canonical_comanda(
        restaurant_name=preferences.restaurant_name,
        restaurant_name_position=preferences.restaurant_name_position,
        print_footer="TESTE DE IMPRESSÃO — NÃO É PEDIDO REAL",
        order_number="TESTE-9999",
        order_type="Delivery",
        operator_name="",
        items=items,
        variant=ComandaVariant(
            origin_label="CARDÁPIO ONLINE",
            location_label=None,
            operator_label=None,
            customer_name="CLIENTE TESTE EXTREMO COM NOME MUITO COMPRIDO",
            customer_phone="88999990000",
            event_at=now,
            via_label="TESTE EXTREMO - NÃO É PEDIDO REAL",
            delivery_phone="88999990000",
            delivery_address=(
                "Rua Doutor José de Albuquerque, número 153, apartamento 103, bloco B, "
                "próximo ao portão lateral do condomínio, referência em frente à praça principal"
            ),
            delivery_neighborhood="Limoeirinho - Área de teste com nome extenso",
            payment_method="pix",
            delivery_fee=delivery_fee,
            coupon_discount=coupon_discount,
            cashback_discount=cashback_discount,
            online_payment_status="approved",
            amount_paid=final_total,
            show_financial_breakdown=True,
        ),
    )
    job = PrintJob(
        restaurante_id=restaurante_id,
        document_type="producao",
        destination="COZINHA",
        source_type="teste_extremo_cardapio",
        source_id=source_id,
        payload_text=payload,
        status="pending",
        idempotency_key=f"teste-extremo-cardapio:{source_id}",
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return {
        "status": "enqueued",
        "detail": "Teste extremo do Cardápio Online enviado para a fila.",
        "job_id": job.id,
        "source_id": source_id,
        "destination": job.destination,
        "expected_total": final_total,
    }


@router.post(
    "/caixa/turnos/{turno_id}/comprovante",
    status_code=status.HTTP_200_OK,
)
def imprimir_comprovante_fechamento_caixa(
    turno_id: int,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("caixa:operar")),
):
    """Alias compatível do fechamento para a entrada universal."""
    jobs = _execute_print(
        db,
        current_user,
        UniversalPrintRequest(
            source_type=PrintSourceType.CASH_SHIFT,
            source_id=str(turno_id),
            action=PrintAction.CLOSING,
        ),
    )
    return {
        "status": "success",
        "detail": "Comprovante de fechamento enviado para a fila de impressão.",
        "job_id": jobs[0].id,
    }
