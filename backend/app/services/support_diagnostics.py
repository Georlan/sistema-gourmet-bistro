"""Autodiagnóstico operacional determinístico por tenant e classificação de suporte."""

from __future__ import annotations

import datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import (
    CaixaTurno,
    ConfiguracaoRestaurante,
    Mesa,
    PrintAgentToken,
    PrintJob,
    Produto,
    RestaurantPaymentAccount,
    Restaurante,
)
from ..saas_billing_models import SaaSSubscription
from .onboarding_readiness import evaluate_operation_readiness
from .online_order_policy import evaluate_online_order_policy
from .online_payments.service import OnlinePaymentService
from .plan_entitlements import ENTITLEMENT_PRINTING, has_plan_entitlement
from .restaurant_provisioning import is_provisional_preparation

_PRINT_AGENT_STALE_MINUTES = 10
_PRINT_JOB_STUCK_MINUTES = 15
_SHIFT_STALE_HOURS = 24


def _as_utc(value: datetime.datetime | None) -> datetime.datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=datetime.timezone.utc)
    return value.astimezone(datetime.timezone.utc)


def _has_structured_items(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) > 0
    return bool(str(value).strip())


def _issue(
    *,
    code: str,
    severity: str,
    title: str,
    description: str,
    action_label: str,
    go_id: str,
) -> dict[str, str]:
    return {
        "code": code,
        "severity": severity,
        "title": title,
        "description": description,
        "action_label": action_label,
        "go_id": go_id,
    }


def build_tenant_self_diagnosis(
    db: Session,
    restaurante_id: int,
    *,
    user_role: str | None = None,
    now: datetime.datetime | None = None,
) -> dict[str, Any]:
    """Executa verificações determinísticas e somente leitura na loja autenticada.

    Não expõe credenciais, tokens, PII ou estado de outros tenants.
    """
    current_time = _as_utc(now) or datetime.datetime.now(datetime.timezone.utc)
    restaurant = (
        db.query(Restaurante)
        .filter(Restaurante.id == restaurante_id)
        .one_or_none()
    )
    if restaurant is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Restaurante não encontrado.",
        )

    config = (
        db.query(ConfiguracaoRestaurante)
        .filter(ConfiguracaoRestaurante.restaurante_id == restaurante_id)
        .one_or_none()
    )
    provisional_prep = is_provisional_preparation(db, restaurante_id)
    subscription = (
        db.query(SaaSSubscription)
        .filter(SaaSSubscription.restaurante_id == restaurante_id)
        .one_or_none()
    )
    sub_status = str(getattr(subscription, "status", "") or "").strip().lower()
    legacy_policy_allowed = bool(
        not provisional_prep
        and (
            subscription is None
            or getattr(subscription, "trial_started_at", None) is not None
            or sub_status not in {"onboarding", "suspended"}
        )
    )

    table_count = int(
        db.query(func.count(Mesa.pk))
        .filter(Mesa.restaurante_id == restaurante_id)
        .scalar()
        or 0
    )
    active_products = int(
        db.query(func.count(Produto.id))
        .filter(
            Produto.restaurante_id == restaurante_id,
            Produto.ativo.is_(True),
        )
        .scalar()
        or 0
    )
    open_shift = (
        db.query(CaixaTurno)
        .filter(
            CaixaTurno.restaurante_id == restaurante_id,
            CaixaTurno.status == "aberto",
        )
        .order_by(CaixaTurno.aberto_em.desc())
        .first()
    )

    readiness = evaluate_operation_readiness(
        config=config,
        restaurant=restaurant,
        table_count=table_count,
        legacy_policy_allowed=legacy_policy_allowed,
    )
    policy = evaluate_online_order_policy(
        restaurant,
        config,
        now=current_time,
        cash_open=open_shift is not None,
        is_provisional=provisional_prep,
    )

    issues: list[dict[str, str]] = []
    saas_status = str(getattr(restaurant, "saas_status", "active") or "active").strip().lower()
    if saas_status != "active":
        issues.append(
            _issue(
                code="TENANT_SUSPENDED",
                severity="error",
                title="Operação comercial suspensa",
                description="A assinatura ou liberação desta loja não está ativa no momento.",
                action_label="Ver conta e assinatura",
                go_id="assinatura_meu_plano",
            )
        )

    if provisional_prep:
        issues.append(
            _issue(
                code="PROVISIONAL_PREPARATION",
                severity="info",
                title="Loja em preparação inicial",
                description="Pedidos comerciais públicos permanecem bloqueados até a formalização e liberação da operação.",
                action_label="Ver implantação inicial",
                go_id="config_implantacao",
            )
        )

    if active_products <= 0:
        issues.append(
            _issue(
                code="NO_ACTIVE_PRODUCTS",
                severity="error",
                title="Nenhum produto ativo no cardápio",
                description="Ative ou cadastre ao menos 1 produto para receber pedidos no caixa e no cardápio online.",
                action_label="Abrir produtos",
                go_id="cardapio_produtos",
            )
        )

    if not _has_structured_items(getattr(restaurant, "horarios_funcionamento", None)):
        issues.append(
            _issue(
                code="HOURS_NOT_CONFIGURED",
                severity="warning",
                title="Horários de funcionamento não configurados",
                description="Informe os dias e horários para orientar corretamente os clientes no cardápio online.",
                action_label="Configurar horários",
                go_id="online_pedidos",
            )
        )

    blockers = set(readiness.get("blockers") or [])
    if "delivery_configuration" in blockers:
        issues.append(
            _issue(
                code="DELIVERY_CONFIG_INCOMPLETE",
                severity="warning",
                title="Configuração de entrega incompleta",
                description="Defina a taxa de entrega fixa, por bairro ou por distância antes de aceitar delivery.",
                action_label="Configurar entrega",
                go_id="online_entrega",
            )
        )
    if "order_types" in blockers or "service_charge" in blockers:
        issues.append(
            _issue(
                code="OPERATION_READINESS_INCOMPLETE",
                severity="warning",
                title="Modalidades de atendimento incompletas",
                description="Revise se consumo no local, retirada ou delivery estão habilitados corretamente.",
                action_label="Abrir implantação inicial",
                go_id="config_implantacao",
            )
        )
    if "dine_in_tables" in blockers:
        issues.append(
            _issue(
                code="DINE_IN_TABLES_MISSING",
                severity="warning",
                title="Mapa de mesas sem mesas cadastradas",
                description="Cadastre as mesas do salão para usar o atendimento no local com mapa ativo.",
                action_label="Configurar mesas",
                go_id="config_mesas",
            )
        )

    if saas_status == "active" and not provisional_prep:
        if open_shift is None:
            issues.append(
                _issue(
                    code="CASH_SHIFT_CLOSED",
                    severity="warning",
                    title="Caixa fechado",
                    description="Não há turno de caixa aberto agora. Pedidos online só abrem quando houver turno ativo.",
                    action_label="Abrir turno do caixa",
                    go_id="caixa_turno_atual",
                )
            )
        else:
            opened_at = _as_utc(getattr(open_shift, "aberto_em", None))
            if opened_at is not None and (current_time - opened_at) > datetime.timedelta(hours=_SHIFT_STALE_HOURS):
                issues.append(
                    _issue(
                        code="CASH_SHIFT_STALE_24H",
                        severity="info",
                        title="Turno de caixa aberto há mais de 24h",
                        description="Revise se o turno atual já pode ser fechado para iniciar o movimento do dia.",
                        action_label="Ver turno atual",
                        go_id="caixa_turno_atual",
                    )
                )

    if policy.source == "operational_pause":
        issues.append(
            _issue(
                code="ONLINE_ORDERS_PAUSED",
                severity="warning",
                title="Pedidos online pausados",
                description="O cardápio digital está em pausa temporária e não aceita novos pedidos no momento.",
                action_label="Gerenciar pausa e pedidos",
                go_id="online_pedidos",
            )
        )
    elif policy.source == "forced_closed":
        issues.append(
            _issue(
                code="STORE_FORCED_CLOSED",
                severity="warning",
                title="Cardápio online marcado como fechado",
                description="A operação online está configurada manualmente como fechada para novos pedidos.",
                action_label="Ajustar status online",
                go_id="online_pedidos",
            )
        )

    mp_account = (
        db.query(RestaurantPaymentAccount)
        .filter(
            RestaurantPaymentAccount.restaurante_id == restaurante_id,
            RestaurantPaymentAccount.provider == "mercado_pago",
        )
        .first()
    )
    accepted_methods = getattr(restaurant, "formas_pagamento_aceitas", None)
    pix_listed = isinstance(accepted_methods, list) and any(
        str(m or "").strip().lower() == "pix" for m in accepted_methods
    )
    mp_status = str(getattr(mp_account, "status", "") or "").strip().lower()
    if mp_account is not None and mp_status == "error":
        issues.append(
            _issue(
                code="MERCADO_PAGO_ERROR",
                severity="error",
                title="Conexão do Mercado Pago com falha",
                description="Reconecte o recebedor do Mercado Pago para restabelecer o pagamento online.",
                action_label="Abrir pagamentos online",
                go_id="online_pagamentos",
            )
        )
    elif (mp_account is not None and mp_status == "disconnected") or (
        pix_listed
        and not OnlinePaymentService.public_payment_capabilities(
            db, restaurante_id, include_direct=True
        )[0]
    ):
        issues.append(
            _issue(
                code="MERCADO_PAGO_DISCONNECTED",
                severity="warning",
                title="Recebimento Pix online desconectado",
                description="Pix está habilitado nas opções, mas não há conta online ativa para receber pagamentos.",
                action_label="Configurar pagamentos",
                go_id="online_pagamentos",
            )
        )

    printing_enabled = has_plan_entitlement(
        db,
        restaurante_id,
        ENTITLEMENT_PRINTING,
        stored_plan=getattr(restaurant, "plano", None),
    )
    if printing_enabled:
        active_agents = (
            db.query(PrintAgentToken)
            .filter(
                PrintAgentToken.restaurante_id == restaurante_id,
                PrintAgentToken.ativo.is_(True),
            )
            .all()
        )
        stale_cutoff = current_time - datetime.timedelta(minutes=_PRINT_AGENT_STALE_MINUTES)
        if active_agents:
            all_offline = all(
                (_as_utc(getattr(agent, "last_seen_at", None)) or datetime.datetime.min.replace(tzinfo=datetime.timezone.utc))
                < stale_cutoff
                for agent in active_agents
            )
            if all_offline:
                issues.append(
                    _issue(
                        code="PRINT_AGENT_OFFLINE",
                        severity="warning",
                        title="Agente de impressão sem sinal recente",
                        description="Nenhum computador de impressão enviou sinal nos últimos 10 minutos.",
                        action_label="Verificar impressão",
                        go_id="config_impressao",
                    )
                )

        stuck_cutoff = current_time - datetime.timedelta(minutes=_PRINT_JOB_STUCK_MINUTES)
        failed_jobs = int(
            db.query(func.count(PrintJob.id))
            .filter(
                PrintJob.restaurante_id == restaurante_id,
                PrintJob.status == "failed",
                PrintJob.created_at >= current_time - datetime.timedelta(hours=24),
            )
            .scalar()
            or 0
        )
        stuck_pending = int(
            db.query(func.count(PrintJob.id))
            .filter(
                PrintJob.restaurante_id == restaurante_id,
                PrintJob.status.in_(("pending", "claimed", "printing")),
                PrintJob.created_at < stuck_cutoff,
            )
            .scalar()
            or 0
        )
        if failed_jobs > 0 or stuck_pending > 0:
            issues.append(
                _issue(
                    code="PRINT_JOBS_STUCK",
                    severity="warning",
                    title="Fila de impressão com pendências",
                    description="Há impressões com falha ou aguardando há mais de 15 minutos na fila.",
                    action_label="Abrir fila de impressão",
                    go_id="config_impressao",
                )
            )

    summary_ok = not any(item["severity"] in {"error", "warning"} for item in issues)
    return {
        "checked_at": current_time.isoformat(),
        "role": (user_role or "").strip().lower() or None,
        "summary_status": "ok" if summary_ok else "attention",
        "accepting_online_orders": bool(policy.accepting_orders),
        "online_policy_source": policy.source,
        "issues": issues,
    }


def classify_support_feedback(
    kind: str,
    message: str,
    context: dict[str, Any] | None = None,
) -> dict[str, str]:
    """Classifica determinísticamente área técnica e prioridade para triagem KÔMA."""
    ctx = context or {}
    area_hint = str(ctx.get("last_error_area") or "").strip().lower()
    nav_id = str(ctx.get("navigation_id") or "").strip().lower()
    issues = {str(code).upper() for code in (ctx.get("detected_issue_codes") or []) if isinstance(code, str)}
    status_code = ctx.get("last_error_status")
    text = (message or "").lower()

    area_map = {
        "printing": "impressao",
        "payments": "pagamentos",
        "delivery": "entrega",
        "catalog": "cardapio",
        "orders": "pedidos",
        "auth": "acesso",
    }
    area = area_map.get(area_hint, "")
    if not area:
        if "impress" in text or "agenta" in text or "print" in text or "config_impressao" in nav_id or issues & {"PRINT_AGENT_OFFLINE", "PRINT_JOBS_STUCK"}:
            area = "impressao"
        elif "pix" in text or "mercado pago" in text or "pagbank" in text or "pagament" in text or "pagamentos" in nav_id or issues & {"MERCADO_PAGO_ERROR", "MERCADO_PAGO_DISCONNECTED"}:
            area = "pagamentos"
        elif "entrega" in text or "bairro" in text or "frete" in text or "online_entrega" in nav_id or "DELIVERY_CONFIG_INCOMPLETE" in issues:
            area = "entrega"
        elif "caixa" in text or "turno" in text or "fechamento" in text or nav_id.startswith("caixa_") or issues & {"CASH_SHIFT_CLOSED", "CASH_SHIFT_STALE_24H"}:
            area = "caixa"
        elif "cardap" in text or "produto" in text or "adicional" in text or nav_id.startswith("cardapio_") or "NO_ACTIVE_PRODUCTS" in issues:
            area = "cardapio"
        elif "login" in text or "senha" in text or "acesso" in text:
            area = "acesso"
        elif "pedido" in text or "comanda" in text or "mesa" in text or "cozinha" in text:
            area = "pedidos"
        else:
            area = "geral"

    if (
        (isinstance(status_code, int) and status_code >= 500)
        or (kind == "problem" and bool(ctx.get("last_support_code")))
        or bool(issues & {"TENANT_SUSPENDED", "NO_ACTIVE_PRODUCTS", "MERCADO_PAGO_ERROR", "PRINT_AGENT_OFFLINE", "PRINT_JOBS_STUCK"})
    ):
        priority = "high"
    elif kind in {"problem", "complaint"} or bool(issues):
        priority = "medium"
    else:
        priority = "low"

    return {"area": area, "priority": priority}
