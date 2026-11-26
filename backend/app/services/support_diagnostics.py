"""Autodiagnóstico operacional determinístico por tenant e classificação de suporte."""

from __future__ import annotations

import datetime
import unicodedata
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
from ..timezone_utils import OPERATIONAL_TIMEZONE
from .onboarding_readiness import evaluate_operation_readiness
from .online_order_policy import evaluate_online_order_policy, schedule_is_open
from .online_payments.service import OnlinePaymentService
from .plan_entitlements import ENTITLEMENT_PRINTING, has_plan_entitlement
from .restaurant_provisioning import (
    get_active_operational_qa_record,
    is_provisional_preparation,
)

_PRINT_AGENT_STALE_MINUTES = 10
_PRINT_JOB_STUCK_MINUTES = 15
_SHIFT_STALE_HOURS = 24

_MANAGEMENT_ROLES = {"admin", "gerente", "superadmin"}
_STAFF_SAFE_ISSUE_CODES = {
    "NO_ACTIVE_PRODUCTS",
    "CASH_SHIFT_CLOSED",
    "ONLINE_ORDERS_PAUSED",
    "STORE_FORCED_CLOSED",
    "PRINT_AGENT_OFFLINE",
    "PRINT_JOBS_STUCK",
    "DINE_IN_TABLES_MISSING",
}

_DOMAIN_RELATED_ISSUE_CODES: dict[str, set[str]] = {
    "cardapio_online": {
        "TENANT_SUSPENDED",
        "PROVISIONAL_PREPARATION",
        "OPERATIONAL_QA_ACTIVE",
        "NO_ACTIVE_PRODUCTS",
        "HOURS_NOT_CONFIGURED",
        "ONLINE_ORDERS_PAUSED",
        "STORE_FORCED_CLOSED",
        "CASH_SHIFT_CLOSED",
    },
    "entrega": {
        "DELIVERY_CONFIG_INCOMPLETE",
        "ONLINE_ORDERS_PAUSED",
        "STORE_FORCED_CLOSED",
        "HOURS_NOT_CONFIGURED",
        "TENANT_SUSPENDED",
    },
    "impressao": {"PRINT_AGENT_OFFLINE", "PRINT_JOBS_STUCK"},
    "pagamentos": {"MERCADO_PAGO_ERROR", "MERCADO_PAGO_DISCONNECTED"},
    "caixa": {"CASH_SHIFT_CLOSED", "CASH_SHIFT_STALE_24H"},
    "mesas": {"DINE_IN_TABLES_MISSING", "OPERATION_READINESS_INCOMPLETE"},
    "cardapio": {"NO_ACTIVE_PRODUCTS"},
    "implantacao": {
        "TENANT_SUSPENDED",
        "PROVISIONAL_PREPARATION",
        "OPERATIONAL_QA_ACTIVE",
        "OPERATION_READINESS_INCOMPLETE",
        "NO_ACTIVE_PRODUCTS",
    },
    "pedidos": {
        "NO_ACTIVE_PRODUCTS",
        "CASH_SHIFT_CLOSED",
        "ONLINE_ORDERS_PAUSED",
        "STORE_FORCED_CLOSED",
        "PRINT_AGENT_OFFLINE",
        "DINE_IN_TABLES_MISSING",
    },
    "acesso": {"TENANT_SUSPENDED"},
    "geral": set(),
}

_TOPIC_ALIASES: dict[str, str] = {
    "cardapio_online": "cardapio_online",
    "cardapio-online": "cardapio_online",
    "online": "cardapio_online",
    "entrega": "entrega",
    "delivery": "entrega",
    "impressao": "impressao",
    "printing": "impressao",
    "pagamentos": "pagamentos",
    "pagamento": "pagamentos",
    "payments": "pagamentos",
    "caixa": "caixa",
    "turno": "caixa",
    "mesas": "mesas",
    "salao": "mesas",
    "cardapio": "cardapio",
    "produtos": "cardapio",
    "catalog": "cardapio",
    "implantacao": "implantacao",
    "onboarding": "implantacao",
    "pedidos": "pedidos",
    "orders": "pedidos",
    "acesso": "acesso",
    "auth": "acesso",
    "geral": "geral",
}

_DOMAIN_GUIDANCE: dict[str, dict[str, str]] = {
    "cardapio_online": {
        "title": "Revisar horários, pausa e status do cardápio online",
        "description": "Confira se horários de atendimento, pausa temporária e modalidades estão conforme esperado.",
        "action_label": "Abrir pedidos online",
        "go_id": "online_pedidos",
    },
    "entrega": {
        "title": "Conferir regras de entrega e taxas por bairro ou distância",
        "description": "Verifique se o delivery está ativo e com taxa padrão, bairros ou distância configurados.",
        "action_label": "Configurar entrega",
        "go_id": "online_entrega",
    },
    "impressao": {
        "title": "Conferir agente de impressão e fila",
        "description": "Verifique se o aplicativo de impressão está aberto no computador da loja e sem falhas pendentes.",
        "action_label": "Abrir impressão",
        "go_id": "config_impressao",
    },
    "pagamentos": {
        "title": "Conferir pagamentos online e métodos aceitos",
        "description": "Valide se os métodos aceitos e uma eventual integração Mercado Pago correspondem ao desejado.",
        "action_label": "Abrir pagamentos online",
        "go_id": "online_pagamentos",
    },
    "caixa": {
        "title": "Conferir turno atual do caixa",
        "description": "Verifique abertura, fechamento e conferência do turno em operação.",
        "action_label": "Abrir turno do caixa",
        "go_id": "caixa_turno_atual",
    },
    "mesas": {
        "title": "Conferir cadastro e mapa de mesas",
        "description": "Verifique se todas as mesas e o modo de atendimento no salão estão configurados.",
        "action_label": "Configurar mesas",
        "go_id": "config_mesas",
    },
    "cardapio": {
        "title": "Conferir produtos, preços e complementos",
        "description": "Revise se os itens e grupos ativos estão salvos corretamente.",
        "action_label": "Abrir produtos",
        "go_id": "cardapio_produtos",
    },
    "implantacao": {
        "title": "Conferir implantação inicial da loja",
        "description": "Revise modalidades de pedido, homologação operacional e aceite comercial.",
        "action_label": "Abrir implantação inicial",
        "go_id": "config_implantacao",
    },
}

_MALFUNCTION_TOKENS = (
    "erro",
    "bug",
    "nao funciona",
    "nao abre",
    "nao salva",
    "nao carrega",
    "nao imprime",
    "nao aparece",
    "trav",
    "sumiu",
    "quebr",
    "falh",
    "duplic",
    "incoeren",
    "zerado",
    "parou",
)


def _normalize_text(value: Any) -> str:
    raw = unicodedata.normalize("NFD", str(value or ""))
    ascii_text = "".join(char for char in raw if unicodedata.category(char) != "Mn")
    return " ".join(ascii_text.casefold().split())


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
    domain: str,
    title: str,
    description: str,
    action_label: str,
    go_id: str,
    kind: str = "condition",
) -> dict[str, str]:
    return {
        "code": code,
        "severity": severity,
        "domain": domain,
        "kind": kind,
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
    base_provisional = is_provisional_preparation(db, restaurante_id, allow_qa=False)
    qa_record = get_active_operational_qa_record(db, restaurante_id)
    provisional_prep = base_provisional and qa_record is None
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
    order_types = set(readiness.get("orderTypes") or [])
    legacy_policy = bool(readiness.get("legacyPolicy"))
    uses_online_menu = bool(
        legacy_policy
        or (order_types & {"delivery", "retirada"})
        or (not order_types and bool(getattr(config, "delivery_ativo", False)))
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
                domain="implantacao",
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
                domain="implantacao",
                title="Loja em preparação inicial",
                description="Pedidos comerciais públicos permanecem bloqueados até a formalização e liberação da operação.",
                action_label="Ver implantação inicial",
                go_id="config_implantacao",
            )
        )
    elif base_provisional and qa_record is not None:
        issues.append(
            _issue(
                code="OPERATIONAL_QA_ACTIVE",
                severity="info",
                domain="implantacao",
                title="Homologação operacional em andamento",
                description="Pedidos de teste estão liberados nesta janela de validação; o período gratuito comercial ainda não começou.",
                action_label="Ver implantação inicial",
                go_id="config_implantacao",
            )
        )

    if active_products <= 0:
        issues.append(
            _issue(
                code="NO_ACTIVE_PRODUCTS",
                severity="error",
                domain="cardapio",
                title="Nenhum produto ativo no cardápio",
                description="Ative ou cadastre ao menos 1 produto para receber pedidos no caixa e no cardápio online.",
                action_label="Abrir produtos",
                go_id="cardapio_produtos",
            )
        )

    if uses_online_menu and not _has_structured_items(getattr(restaurant, "horarios_funcionamento", None)):
        issues.append(
            _issue(
                code="HOURS_NOT_CONFIGURED",
                severity="warning",
                domain="cardapio_online",
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
                domain="entrega",
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
                domain="implantacao",
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
                domain="mesas",
                title="Mapa de mesas sem mesas cadastradas",
                description="Cadastre as mesas do salão para usar o atendimento no local com mapa ativo.",
                action_label="Configurar mesas",
                go_id="config_mesas",
            )
        )

    if saas_status == "active" and not provisional_prep:
        if open_shift is None:
            schedule_state = schedule_is_open(
                getattr(restaurant, "horarios_funcionamento", None),
                now=current_time.astimezone(OPERATIONAL_TIMEZONE),
            )
            if uses_online_menu and schedule_state is not False:
                issues.append(
                    _issue(
                        code="CASH_SHIFT_CLOSED",
                        severity="warning",
                        domain="caixa",
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
                        domain="caixa",
                        title="Turno de caixa aberto há mais de 24h",
                        description="Revise se o turno atual já pode ser fechado para iniciar o movimento do dia.",
                        action_label="Ver turno atual",
                        go_id="caixa_turno_atual",
                    )
                )

    if uses_online_menu:
        if policy.source == "operational_pause":
            issues.append(
                _issue(
                    code="ONLINE_ORDERS_PAUSED",
                    severity="warning",
                    domain="cardapio_online",
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
                    domain="cardapio_online",
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
    mp_status = str(getattr(mp_account, "status", "") or "").strip().lower()
    if mp_account is not None and mp_status == "error":
        issues.append(
            _issue(
                code="MERCADO_PAGO_ERROR",
                severity="error",
                domain="pagamentos",
                title="Conexão do Mercado Pago com falha",
                description="Reconecte o recebedor do Mercado Pago para restabelecer o pagamento online.",
                action_label="Abrir pagamentos online",
                go_id="online_pagamentos",
            )
        )
    elif (
        mp_account is not None
        and mp_status == "disconnected"
        and not OnlinePaymentService.public_payment_capabilities(
            db, restaurante_id, include_direct=True
        )[0]
    ):
        issues.append(
            _issue(
                code="MERCADO_PAGO_DISCONNECTED",
                severity="warning",
                domain="pagamentos",
                title="Conta Mercado Pago desconectada",
                description="O vínculo com o Mercado Pago foi desconectado e não há outro recebedor online ativo.",
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
                        domain="impressao",
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
                        domain="impressao",
                        title="Fila de impressão com pendências",
                        description="Há impressões com falha ou aguardando há mais de 15 minutos na fila.",
                        action_label="Abrir fila de impressão",
                        go_id="config_impressao",
                    )
                )

    summary_ok = not any(item["severity"] in {"error", "warning"} for item in issues)
    qa_expires_at = qa_record.get("expires_at") if isinstance(qa_record, dict) else None
    return {
        "checked_at": current_time.isoformat(),
        "role": (user_role or "").strip().lower() or None,
        "summary_status": "ok" if summary_ok else "attention",
        "accepting_online_orders": bool(policy.accepting_orders),
        "online_policy_source": policy.source,
        "operational_qa_active": qa_record is not None,
        "operational_qa_expires_at": qa_expires_at if isinstance(qa_expires_at, str) and qa_expires_at else None,
        "issues": issues,
    }


def _resolve_support_domain(
    *,
    topic: str | None,
    message: str,
    last_error_area: str | None,
    navigation_id: str | None,
) -> str:
    topic_key = _normalize_text(topic).replace(" ", "_")
    mapped_topic = _TOPIC_ALIASES.get(topic_key)
    if mapped_topic and mapped_topic != "geral":
        return mapped_topic

    area_hint = _normalize_text(last_error_area)
    area_map = {
        "printing": "impressao",
        "impressao": "impressao",
        "payments": "pagamentos",
        "pagamentos": "pagamentos",
        "delivery": "entrega",
        "entrega": "entrega",
        "catalog": "cardapio",
        "cardapio": "cardapio",
        "orders": "pedidos",
        "pedidos": "pedidos",
        "auth": "acesso",
        "acesso": "acesso",
    }
    if area_hint in area_map:
        return area_map[area_hint]

    text = _normalize_text(message)
    nav_id = _normalize_text(navigation_id)

    if any(tok in text for tok in ("cardapio online", "cardapio digital", "link do cardapio", "loja fechada", "pausa")) or nav_id == "online_pedidos":
        return "cardapio_online"
    if any(tok in text for tok in ("entrega", "delivery", "bairro", "frete", "taxa de entrega", "area de entrega")) or "online_entrega" in nav_id:
        return "entrega"
    if any(tok in text for tok in ("impress", "agente", "print", "cupom")) or "config_impressao" in nav_id:
        return "impressao"
    if any(tok in text for tok in ("pix", "mercado pago", "pagbank", "pagament")) or "online_pagamentos" in nav_id:
        return "pagamentos"
    if any(tok in text for tok in ("caixa", "turno", "fechamento", "sangria", "suprimento")) or nav_id.startswith("caixa_turno"):
        return "caixa"
    if any(tok in text for tok in ("mesa", "salao")) or "config_mesas" in nav_id:
        return "mesas"
    if any(tok in text for tok in ("implant", "homolog", "trial", "contrato", "liberac")) or "config_implantacao" in nav_id:
        return "implantacao"
    if any(tok in text for tok in ("cardap", "produto", "adicional", "categoria")) or nav_id.startswith("cardapio_"):
        return "cardapio"
    if any(tok in text for tok in ("login", "senha", "acesso", "permiss")):
        return "acesso"
    if any(tok in text for tok in ("pedido", "comanda", "cozinha", "garcom")):
        return "pedidos"
    return "geral"


def assist_tenant_support(
    db: Session,
    restaurante_id: int,
    *,
    user_role: str | None = None,
    message: str = "",
    topic: str | None = None,
    kind: str | None = None,
    surface: str | None = None,
    navigation_id: str | None = None,
    last_support_code: str | None = None,
    last_error_status: int | None = None,
    last_error_area: str | None = None,
    last_error_endpoint: str | None = None,
    now: datetime.datetime | None = None,
) -> dict[str, Any]:
    """Interpreta a solicitação do usuário com causalidade estrita sobre o estado da loja."""
    role = (user_role or "").strip().lower()
    is_management = role in _MANAGEMENT_ROLES
    diag = build_tenant_self_diagnosis(
        db,
        restaurante_id,
        user_role=role or None,
        now=now,
    )
    visible_issues = (
        list(diag["issues"])
        if is_management
        else [item for item in diag["issues"] if item["code"] in _STAFF_SAFE_ISSUE_CODES]
    )

    interpreted_domain = _resolve_support_domain(
        topic=topic,
        message=message,
        last_error_area=last_error_area,
        navigation_id=navigation_id,
    )
    related_codes = _DOMAIN_RELATED_ISSUE_CODES.get(interpreted_domain, set())
    related_checks = [item for item in visible_issues if item["code"] in related_codes]
    unrelated_observations_count = max(0, len(visible_issues) - len(related_checks))

    support_code_clean = (last_support_code or "").strip() or None
    has_api_error = bool(support_code_clean) or (
        isinstance(last_error_status, int) and last_error_status >= 500
    )
    has_related_blocker = any(
        item.get("severity") in {"error", "warning"} for item in related_checks
    )
    normalized_msg = _normalize_text(message)
    kind_clean = (kind or "").strip().lower()
    indicates_malfunction = (kind_clean == "problem") or any(
        token in normalized_msg for token in _MALFUNCTION_TOKENS
    )

    if has_api_error:
        evidence_status = "api_error_detected"
        suspected_bug = True
        headline = "Falha técnica registrada na requisição"
        code_part = f" (código {support_code_clean})" if support_code_clean else ""
        status_part = f" com HTTP {last_error_status}" if last_error_status is not None else ""
        summary = (
            f"Há evidência técnica de erro na última tentativa{code_part}{status_part}. "
            "Encaminhe para investigação KÔMA com o código anexado."
        )
    elif has_related_blocker:
        evidence_status = "config_condition_found"
        suspected_bug = False
        headline = "Encontrei uma condição na configuração desta área"
        titles = "; ".join(item["title"] for item in related_checks[:2])
        summary = (
            f"O estado atual da loja aponta condição direta ligada a este tema: {titles}."
            if is_management
            else f"Existe uma condição operacional ligada a este tema ({titles}). Peça para a gerência revisar na tela de gestão."
        )
    elif indicates_malfunction:
        evidence_status = "possible_bug_no_config_blocker"
        suspected_bug = True
        headline = "Sem bloqueio de configuração nessa área — pode ser um bug"
        summary = (
            "As verificações ligadas a este tema não mostraram erro de configuração ou pausa. "
            "Se o comportamento persistir, encaminhe como possível bug para análise da equipe KÔMA."
        )
    else:
        evidence_status = "guidance_only"
        suspected_bug = False
        headline = "Orientação direta para este tema"
        summary = (
            "Nenhuma irregularidade ligada a este assunto foi encontrada na loja. "
            "Use o atalho abaixo para conferir ou envie sua dúvida detalhada."
        )

    guided_steps: list[dict[str, Any]] = []
    for item in related_checks[:3]:
        guided_steps.append(
            {
                "title": item["title"],
                "description": item["description"],
                "action_label": item["action_label"] if is_management else None,
                "go_id": item["go_id"] if is_management else None,
            }
        )

    if not guided_steps:
        fallback = _DOMAIN_GUIDANCE.get(interpreted_domain)
        if fallback:
            guided_steps.append(
                {
                    "title": fallback["title"],
                    "description": fallback["description"],
                    "action_label": fallback["action_label"] if is_management else None,
                    "go_id": fallback["go_id"] if is_management else None,
                }
            )

    sanitized_related = [
        {
            **item,
            "action_label": item["action_label"] if is_management else "",
            "go_id": item["go_id"] if is_management else "",
        }
        for item in related_checks
    ]

    return {
        "interpreted_domain": interpreted_domain,
        "evidence_status": evidence_status,
        "suspected_bug": suspected_bug,
        "headline": headline,
        "summary": summary,
        "related_checks": sanitized_related,
        "guided_steps": guided_steps,
        "unrelated_observations_count": unrelated_observations_count,
        "triage_context": {
            "interpreted_domain": interpreted_domain,
            "evidence_status": evidence_status,
            "suspected_bug": suspected_bug,
            "related_issue_codes": [item["code"] for item in related_checks],
            "unrelated_observations_count": unrelated_observations_count,
            "last_support_code": support_code_clean,
            "surface": (surface or "").strip().lower() or None,
            "navigation_id": (navigation_id or "").strip().lower() or None,
            "last_error_endpoint": (last_error_endpoint or "").strip() or None,
        },
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
            interpreted_domain = str(ctx.get("interpreted_domain") or "").strip().lower()
            area = interpreted_domain or "geral"

    if (
        bool(ctx.get("suspected_bug"))
        or (isinstance(status_code, int) and status_code >= 500)
        or (kind == "problem" and bool(ctx.get("last_support_code")))
        or bool(issues & {"TENANT_SUSPENDED", "NO_ACTIVE_PRODUCTS", "MERCADO_PAGO_ERROR", "PRINT_AGENT_OFFLINE", "PRINT_JOBS_STUCK"})
    ):
        priority = "high"
    elif kind in {"problem", "complaint"} or bool(issues):
        priority = "medium"
    else:
        priority = "low"

    return {"area": area, "priority": priority}
