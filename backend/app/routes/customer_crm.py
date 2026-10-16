"""Rotas de CRM Operacional do KÔMA: Oportunidades, Perfil, Campanhas e Resultados."""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..models import Usuario
from ..security import require_permission
from ..services.customer_crm import (
    DEFAULT_ATTRIBUTION_WINDOW_DAYS,
    create_crm_campaign,
    get_crm_overview_and_results,
    get_customer_crm_profile,
    record_crm_customer_contact,
    update_customer_crm_preferences,
)
from ..services.plan_entitlements import (
    ENTITLEMENT_COUPONS,
    ENTITLEMENT_LOYALTY,
    has_plan_entitlement,
)
from ..websocket_manager import manager

router = APIRouter(tags=["CRM Operacional & Relacionamento"])


class UpdateCustomerPreferencesInput(BaseModel):
    opt_out_marketing: bool = Field(
        default=False,
        description="Se verdadeiro, exclui o cliente de campanhas promocionais e abordagens de marketing.",
    )
    motivo_opt_out: Optional[str] = Field(
        default=None,
        max_length=255,
        description="Motivo declarado ou registrado para não receber campanhas.",
    )
    canal_preferido: Optional[Literal["whatsapp", "telefone", "presencial"]] = Field(
        default=None,
        description="Canal preferido declarado pelo cliente.",
    )
    observacoes_declaradas: Optional[str] = Field(
        default=None,
        max_length=2000,
        description="Preferências ou restrições declaradas diretamente pelo cliente.",
    )


class CreateCrmCampaignInput(BaseModel):
    nome: str = Field(..., min_length=3, max_length=120)
    objetivo: Literal[
        "SECOND_PURCHASE",
        "CADENCE_RECOVERY",
        "BENEFIT_REMINDER",
        "VIP_RECOGNITION",
        "OCCURRENCE_RECOVERY",
        "CUSTOM",
    ] = Field(default="SECOND_PURCHASE")
    segmento_filtro: str = Field(default="SECOND_PURCHASE", max_length=64)
    abordagem_tipo: Literal["SEM_DESCONTO", "FIDELIDADE", "CUPOM"] = Field(
        default="SEM_DESCONTO"
    )
    cupom_id: Optional[str] = Field(default=None)
    template_mensagem: str = Field(..., min_length=10, max_length=2000)
    janela_atribuicao_dias: int = Field(
        default=DEFAULT_ATTRIBUTION_WINDOW_DAYS, ge=1, le=90
    )
    status: Literal["RASCUNHO", "EM_EXECUCAO", "CONCLUIDA"] = Field(
        default="EM_EXECUCAO"
    )


class RecordCrmCustomerContactInput(BaseModel):
    cliente_id: str = Field(..., min_length=1)
    campanha_id: Optional[str] = Field(default=None)
    objetivo: str = Field(default="CUSTOM", max_length=64)
    abordagem_tipo: Literal["SEM_DESCONTO", "FIDELIDADE", "CUPOM"] = Field(
        default="SEM_DESCONTO"
    )
    cupom_id: Optional[str] = Field(default=None)
    canal: Literal["WHATSAPP_MANUAL", "TELEFONE_MANUAL", "PRESENCIAL"] = Field(
        default="WHATSAPP_MANUAL"
    )
    acao_executada: Literal[
        "MENSAGEM_COPIADA",
        "WHATSAPP_ABERTO",
        "CONTATO_MANUAL_CONFIRMADO",
        "IGNORADO",
    ] = Field(default="CONTATO_MANUAL_CONFIRMADO")
    mensagem_personalizada: Optional[str] = Field(default=None, max_length=2000)
    observacao: Optional[str] = Field(default=None, max_length=500)
    forcar_contato_recente: bool = Field(
        default=False,
        description="Permite confirmar abordagem mesmo dentro da janela de proteção de 7 dias quando o operador justificar.",
    )


@router.get("/fidelidade/clientes/{cliente_id}/perfil")
def get_customer_profile_endpoint(
    cliente_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("clientes:operar")),
):
    """Retorna a ficha individual completa separando dados declarados de comportamento observado."""
    restaurante_id = require_tenant_id()
    loyalty_enabled = has_plan_entitlement(db, restaurante_id, ENTITLEMENT_LOYALTY)
    return get_customer_crm_profile(
        db,
        restaurante_id=restaurante_id,
        cliente_id=cliente_id,
        loyalty_enabled=loyalty_enabled,
    )


@router.put("/fidelidade/clientes/{cliente_id}/preferencias")
def update_customer_preferences_endpoint(
    cliente_id: str,
    payload: UpdateCustomerPreferencesInput,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("clientes:operar")),
):
    """Atualiza opt-out de campanhas, canal preferido e observações declaradas do cliente."""
    restaurante_id = require_tenant_id()
    result = update_customer_crm_preferences(
        db,
        restaurante_id=restaurante_id,
        cliente_id=cliente_id,
        opt_out_marketing=payload.opt_out_marketing,
        motivo_opt_out=payload.motivo_opt_out,
        canal_preferido=payload.canal_preferido,
        observacoes_declaradas=payload.observacoes_declaradas,
    )
    background_tasks.add_task(
        manager.broadcast,
        {
            "event": "customers_updated",
            "detail": {"action": "crm_preferences", "cliente_id": cliente_id},
        },
        restaurante_id,
        target_audience="internal",
    )
    return result


@router.get("/fidelidade/crm/resumo")
def get_crm_overview_endpoint(
    periodo_dias: int = Query(default=30, ge=1, le=365),
    janela_atribuicao_dias: int = Query(
        default=DEFAULT_ATTRIBUTION_WINDOW_DAYS, ge=1, le=90
    ),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("clientes:operar")),
):
    """Retorna oportunidades priorizadas, campanhas e resultados de retorno sem dupla contagem."""
    restaurante_id = require_tenant_id()
    loyalty_enabled = has_plan_entitlement(db, restaurante_id, ENTITLEMENT_LOYALTY)
    coupons_enabled = has_plan_entitlement(db, restaurante_id, ENTITLEMENT_COUPONS)
    return get_crm_overview_and_results(
        db,
        restaurante_id=restaurante_id,
        loyalty_enabled=loyalty_enabled,
        coupons_enabled=coupons_enabled,
        periodo_dias=periodo_dias,
        janela_atribuicao_dias=janela_atribuicao_dias,
    )


@router.post("/fidelidade/crm/campanhas", status_code=status.HTTP_201_CREATED)
def create_crm_campaign_endpoint(
    payload: CreateCrmCampaignInput,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("clientes:operar")),
):
    """Registra uma campanha guiada do CRM vinculada a um objetivo comercial e benefício opcional."""
    restaurante_id = require_tenant_id()
    result = create_crm_campaign(
        db,
        restaurante_id=restaurante_id,
        usuario_id=getattr(current_user, "id", None),
        nome=payload.nome,
        objetivo=payload.objetivo,
        segmento_filtro=payload.segmento_filtro,
        abordagem_tipo=payload.abordagem_tipo,
        cupom_id=payload.cupom_id,
        template_mensagem=payload.template_mensagem,
        janela_atribuicao_dias=payload.janela_atribuicao_dias,
        status_campanha=payload.status,
    )
    background_tasks.add_task(
        manager.broadcast,
        {
            "event": "customers_updated",
            "detail": {"action": "crm_campaign_created", "campanha_id": result["id"]},
        },
        restaurante_id,
        target_audience="internal",
    )
    return result


@router.post("/fidelidade/crm/contatos", status_code=status.HTTP_201_CREATED)
def record_crm_contact_endpoint(
    payload: RecordCrmCustomerContactInput,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("clientes:operar")),
):
    """Registra abordagem individual ao cliente com controle de opt-out, telefone e contato recente."""
    restaurante_id = require_tenant_id()
    result = record_crm_customer_contact(
        db,
        restaurante_id=restaurante_id,
        usuario_id=getattr(current_user, "id", None),
        cliente_id=payload.cliente_id,
        campanha_id=payload.campanha_id,
        objetivo=payload.objetivo,
        abordagem_tipo=payload.abordagem_tipo,
        cupom_id=payload.cupom_id,
        canal=payload.canal,
        acao_executada=payload.acao_executada,
        mensagem_personalizada=payload.mensagem_personalizada,
        observacao=payload.observacao,
        forcar_contato_recente=payload.forcar_contato_recente,
    )
    background_tasks.add_task(
        manager.broadcast,
        {
            "event": "customers_updated",
            "detail": {
                "action": "crm_contact_recorded",
                "cliente_id": payload.cliente_id,
            },
        },
        restaurante_id,
        target_audience="internal",
    )
    return result
