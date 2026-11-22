from __future__ import annotations

import datetime
import json
import logging
import re
from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...models import (
    CaixaTurno,
    Comanda,
    OnlinePaymentIntent,
    OnlinePaymentWebhookEvent,
    Pagamento,
    RestaurantDirectPixConfig,
    RestaurantPaymentAccount,
    Usuario,
)
from ...online_order_control_models import OnlineOrderOperationalAudit
from ...timezone_utils import to_operational_local_time, to_utc
from ...websocket_manager import manager
from ..order_chat_service import queue_order_tracking_refresh

logger = logging.getLogger("koma.online_payments.pending_review")

MONEY = Decimal("0.01")
UNRESOLVED_STATUSES = ("created", "pending", "error")
CLOSED_TERMINAL_STATUSES = ("cancelled", "rejected", "expired", "refunded")
SITUATION_LABELS = {
    "awaiting_payment": "Aguardando pagamento",
    "creation_failed": "Falha na criação da cobrança",
    "uncertain": "Pagamento em situação incerta",
    "provider_query_failed": "Falha ao consultar o provedor",
    "approved": "Pagamento aprovado",
    "closed_after_review": "Operação encerrada após revisão",
}
PROVIDER_LABELS = {
    "pagbank": "PagBank",
    "mercado_pago": "Mercado Pago",
    "direct_pix": "Pix com chave própria",
}

_ALLOWED_LOG_FIELDS = frozenset(
    {
        "tenant_id",
        "intent_id",
        "comanda_id",
        "order_number",
        "provider",
        "situation",
        "error_stage",
        "http_status",
        "provider_code",
        "provider_parameter",
        "provider_request_id",
        "evidence_code",
        "actor_user_id",
        "blocking_count",
        "action",
        "outcome",
        "code",
    }
)
_EMAIL_PATTERN = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
_TOKEN_VALUE_PATTERN = re.compile(
    r"(?i)\b(access_token|refresh_token|client_secret|authorization)\s*[:=]\s*[^\s,;]+"
)
_MP_TOKEN_PATTERN = re.compile(r"(?i)\b(?:APP_USR|TEST|PROD)-[A-Za-z0-9_-]{8,}\b")
_META_BLOCK_RE = re.compile(r"\s*\[meta:([^\]]{1,240})\]\s*\Z")
_HTTP_STATUS_RE = re.compile(r"(?:\bHTTP\s+|\()([45]\d{2})(?:\b|\))")
_PAGBANK_CODE_RE = re.compile(r"\bC[oó]digo:\s*([A-Za-z0-9_-]{1,64})")
_MP_CAUSE_RE = re.compile(r"\[cause=([A-Za-z0-9_,.-]{1,64})\]")
_PAGBANK_REF_RE = re.compile(r"Refer[êe]ncia PagBank:\s*([A-Za-z0-9._:-]{1,80})")
_SAFE_TOKEN_RE = re.compile(r"[A-Za-z0-9._:-]{1,80}\Z")


def _money(value: object) -> Decimal:
    return Decimal(str(value or "0")).quantize(MONEY)


def _iso_utc(value: datetime.datetime | None) -> str | None:
    utc_dt = to_utc(value)
    return utc_dt.isoformat() if utc_dt is not None else None


def _iso_local(value: datetime.datetime | None) -> str | None:
    local_dt = to_operational_local_time(value)
    return local_dt.isoformat() if local_dt is not None else None


def _sanitize_text(value: object) -> str:
    text = " ".join(str(value or "").split()).strip()
    if not text:
        return ""
    text = _EMAIL_PATTERN.sub("[redacted-email]", text)
    text = _MP_TOKEN_PATTERN.sub("[redacted-token]", text)
    text = _TOKEN_VALUE_PATTERN.sub(r"\1=[redacted]", text)
    return text


def log_payment_event(event: str, *, level: int = logging.INFO, **fields: Any) -> None:
    """Emits structured JSON telemetry strictly limited to allowlisted non-PII keys."""
    payload: dict[str, Any] = {"event": event}
    for key, value in fields.items():
        if key in _ALLOWED_LOG_FIELDS and value is not None:
            payload[key] = value
    logger.log(level, json.dumps(payload, separators=(",", ":"), ensure_ascii=False))


def _safe_meta_token(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or not _SAFE_TOKEN_RE.fullmatch(text):
        return None
    return text


def format_intent_error(exc: Exception) -> str:
    """Format sanitized error message preserving compatibility + machine-readable metadata."""
    clean = _sanitize_text(exc)
    meta_parts: list[str] = []
    stage = _safe_meta_token(getattr(exc, "error_stage", None))
    if stage:
        meta_parts.append(f"stage={stage}")
    status_code = getattr(exc, "status_code", None)
    if isinstance(status_code, int) and 100 <= status_code <= 599:
        meta_parts.append(f"http={status_code}")
    provider_code = _safe_meta_token(getattr(exc, "provider_code", None))
    if provider_code:
        meta_parts.append(f"code={provider_code}")
    provider_param = _safe_meta_token(getattr(exc, "provider_parameter", None))
    if provider_param:
        meta_parts.append(f"param={provider_param}")
    provider_req = _safe_meta_token(getattr(exc, "provider_request_id", None))
    if provider_req:
        meta_parts.append(f"req={provider_req}")

    suffix = f" [meta:{';'.join(meta_parts)}]" if meta_parts else ""
    if len(clean) + len(suffix) <= 1000:
        return f"{clean}{suffix}"
    max_clean = max(0, 1000 - len(suffix))
    return f"{clean[:max_clean].rstrip()}{suffix}"[:1000]


def parse_intent_error(last_error: str | None) -> dict[str, Any]:
    """Extract safe error metadata from either tagged errors or legacy production messages."""
    raw = str(last_error or "").strip()
    stage: str | None = None
    http_status: int | None = None
    provider_code: str | None = None
    provider_parameter: str | None = None
    provider_request_id: str | None = None

    clean = raw
    meta_match = _META_BLOCK_RE.search(raw)
    if meta_match:
        clean = raw[: meta_match.start()].strip()
        for pair in meta_match.group(1).split(";"):
            if "=" not in pair:
                continue
            key, val = pair.split("=", 1)
            val = val.strip()
            if not val:
                continue
            if key == "stage":
                stage = val
            elif key == "http" and val.isdigit():
                http_status = int(val)
            elif key == "code":
                provider_code = val
            elif key == "param":
                provider_parameter = val
            elif key == "req":
                provider_request_id = val

    if http_status is None:
        http_match = _HTTP_STATUS_RE.search(clean)
        if http_match:
            http_status = int(http_match.group(1))
    if provider_code is None:
        code_match = _PAGBANK_CODE_RE.search(clean) or _MP_CAUSE_RE.search(clean)
        if code_match:
            provider_code = code_match.group(1).rstrip(".") or None
    if provider_request_id is None:
        ref_match = _PAGBANK_REF_RE.search(clean)
        if ref_match:
            provider_request_id = ref_match.group(1).rstrip(".") or None

    if "E-mail do comprador rejeitado pelo PagBank" in clean:
        http_status = http_status or 400
        provider_code = provider_code or "40002"
        provider_parameter = provider_parameter or "customer.email"

    return {
        "stage": stage,
        "http_status": http_status,
        "provider_code": provider_code,
        "provider_parameter": provider_parameter,
        "provider_request_id": provider_request_id,
        "clean_message": clean,
    }


def has_definitive_creation_failure_evidence(
    *,
    intent: OnlinePaymentIntent,
    comanda: Comanda | None,
    webhook_count: int,
    active_payment_count: int,
) -> tuple[bool, str, str]:
    """Prove strictly from persisted evidence that a charge was refused before creation.

    Absence of external_payment_id alone NEVER suffices: network timeouts, HTTP 5xx,
    missing QR responses or interrupted requests remain uncertain.
    """
    if intent.status != "error":
        return (
            False,
            "not_error_status",
            "A tentativa não está marcada como falha de criação.",
        )
    if intent.provider not in {"pagbank", "mercado_pago"}:
        return (
            False,
            "direct_pix_requires_statement_check",
            "Pix com chave própria exige conferência manual no extrato bancário.",
        )
    if intent.external_payment_id:
        return (
            False,
            "external_payment_id_present",
            "Existe identificador externo no provedor; reconcilie a cobrança em vez de encerrar como falha de criação.",
        )
    if intent.qr_code:
        return (
            False,
            "qr_code_present",
            "Um código QR Pix foi gerado para esta tentativa; trate como cobrança ativa ou incerta.",
        )
    if intent.pagamento_id:
        return (
            False,
            "payment_linked",
            "Há um pagamento vinculado a esta tentativa.",
        )
    if intent.reconciliation_attempted_at is not None:
        return (
            False,
            "reconciliation_attempted",
            "Já houve tentativa de consulta no provedor; revise o estado antes de encerrar.",
        )
    if webhook_count > 0:
        return (
            False,
            "webhook_recorded",
            "Há notificação de webhook registrada para esta cobrança; concilie manualmente antes de qualquer baixa.",
        )
    if active_payment_count > 0:
        return (
            False,
            "active_payment_recorded",
            "Existe registro financeiro vinculado a este pedido.",
        )
    if comanda is not None and (
        comanda.online_payment_status == "approved" or _money(comanda.valor_pago) > 0
    ):
        return (
            False,
            "order_has_payment_activity",
            "O pedido possui sinal de pagamento registrado e não pode ser encerrado como falha de criação.",
        )

    parsed = parse_intent_error(intent.last_error)
    stage = parsed["stage"]
    http_status = parsed["http_status"]
    provider_code = parsed["provider_code"]
    provider_request_id = parsed["provider_request_id"]
    clean = parsed["clean_message"]

    if stage in {"create_uncertain", "reconcile_failed"}:
        return (
            False,
            "uncertain_provider_stage",
            "A falha ocorreu com resultado indeterminado no provedor ou na consulta; revise o extrato no banco.",
        )
    if http_status is not None and (http_status >= 500 or http_status in {408, 409, 429}):
        return (
            False,
            f"transient_http_{http_status}",
            "O provedor respondeu com instabilidade ou timeout; não há prova segura de que a cobrança não exista.",
        )

    ref_bits: list[str] = []
    if provider_code:
        ref_bits.append(f"código {provider_code}")
    if provider_request_id:
        ref_bits.append(f"ref. {provider_request_id}")
    ref_suffix = f" ({', '.join(ref_bits)})" if ref_bits else ""

    if stage == "create_preflight":
        return (
            True,
            "preflight_validation_rejected",
            "Validação local recusou os dados antes de enviar a requisição ao provedor; nenhuma cobrança foi emitida.",
        )

    if stage == "create_refused" and http_status in {400, 401, 403, 422}:
        return (
            True,
            f"provider_http_{http_status}_creation_refused",
            f"O provedor recusou de forma síncrona a criação da cobrança (HTTP {http_status}){ref_suffix}; sem QR Code, identificador externo, webhook ou pagamento.",
        )

    if "E-mail do comprador rejeitado pelo PagBank" in clean:
        return (
            True,
            "pagbank_customer_email_rejected",
            f"O PagBank recusou o e-mail do comprador antes de criar a cobrança (HTTP 400){ref_suffix}; sem QR Code, identificador externo ou pagamento.",
        )

    if (
        intent.provider == "pagbank"
        and "PagBank recusou" in clean
        and http_status in {400, 401, 403, 422}
    ):
        return (
            True,
            f"pagbank_http_{http_status}_creation_refused",
            f"O PagBank recusou a criação da cobrança com HTTP {http_status}{ref_suffix}; sem identificador externo, QR Code, webhook ou pagamento.",
        )

    if (
        intent.provider == "mercado_pago"
        and "Mercado Pago recusou a criação do Pix" in clean
        and http_status in {400, 401, 403, 422}
    ):
        return (
            True,
            f"mercadopago_http_{http_status}_creation_refused",
            f"O Mercado Pago recusou a criação da cobrança com HTTP {http_status}{ref_suffix}; sem identificador externo, QR Code, webhook ou pagamento.",
        )

    if any(
        token in clean
        for token in (
            "Informe nome e CPF/CNPJ",
            "Informe um e-mail válido",
            "Valor Pix inválido",
            "PagBank no KÔMA não cobra taxa",
        )
    ):
        return (
            True,
            "preflight_validation_rejected",
            "Validação local impediu a criação da cobrança antes do envio ao banco.",
        )

    return (
        False,
        "uncertain_provider_outcome",
        "Não há prova definitiva de que a tentativa falhou antes da criação no provedor. Confira diretamente na conta do banco.",
    )


def _format_audit_entry(
    audit: OnlineOrderOperationalAudit,
    actor_names: dict[str, str],
) -> dict[str, Any]:
    before_data = audit.before_data if isinstance(audit.before_data, dict) else {}
    after_data = audit.after_data if isinstance(audit.after_data, dict) else {}
    return {
        "id": audit.id,
        "action": audit.action,
        "reason": audit.reason,
        "actor_user_id": audit.actor_user_id,
        "actor_name": actor_names.get(audit.actor_user_id or "", "Sistema"),
        "created_at": _iso_utc(audit.created_at),
        "created_at_local": _iso_local(audit.created_at),
        "status_before": before_data.get("intent_status"),
        "status_after": after_data.get("intent_status"),
        "evidence_code": after_data.get("evidence_code") or before_data.get("evidence_code"),
    }


def _build_reason_copy(
    *,
    intent: OnlinePaymentIntent,
    situation: str,
    parsed: dict[str, Any],
    evidence_code: str,
    evidence_summary: str,
) -> tuple[str, str, str | None]:
    provider_label = PROVIDER_LABELS.get(intent.provider, intent.provider)
    http_status = parsed["http_status"]
    provider_code = parsed["provider_code"]
    provider_param = parsed["provider_parameter"]

    if situation == "approved":
        return (
            "Pagamento confirmado",
            f"Recebimento via {provider_label} confirmado e liberado para a operação.",
            None,
        )

    if situation == "closed_after_review":
        return (
            "Tentativa encerrada após revisão",
            f"Cobrança via {provider_label} encerrada sem recebimento financeiro e sem entrada na cozinha.",
            None,
        )

    if situation == "awaiting_payment":
        if intent.provider == "direct_pix":
            return (
                "Aguardando conferência manual no extrato",
                "Cliente optou pelo Pix com chave própria. Confira o recebimento no extrato do banco antes de aprovar ou cancelar.",
                None,
            )
        return (
            "Aguardando pagamento do comprador",
            f"Cobrança emitida no {provider_label} aguardando confirmação do pagamento ou expiração no provedor.",
            None,
        )

    if situation == "provider_query_failed":
        return (
            "Falha ao consultar o provedor",
            f"A cobrança foi criada no {provider_label}, mas a consulta automática falhou. Consulte novamente ou confirme no painel do banco.",
            f"Acesse a conta {provider_label}, localize a cobrança pelo identificador do pedido e confirme se o Pix foi pago antes de fechar ou cancelar.",
        )

    if situation == "creation_failed":
        if evidence_code == "pagbank_customer_email_rejected" or (
            provider_param == "customer.email" and provider_code in {"40001", "40002"}
        ):
            return (
                "E-mail do comprador recusado pelo PagBank",
                "O PagBank recusou o e-mail informado antes de emitir a cobrança (HTTP 400). Nenhum código Pix foi gerado.",
                None,
            )
        if evidence_code == "preflight_validation_rejected":
            return (
                "Dados recusados antes de enviar ao banco",
                f"A validação interna recusou os dados antes da chamada ao {provider_label}. Nenhuma cobrança foi criada.",
                None,
            )
        if http_status in {401, 403}:
            return (
                f"{provider_label} recusou permissão para criar a cobrança",
                f"O provedor respondeu HTTP {http_status} ao tentar criar o Pix, indicando falta de permissão da integração/API. Nenhuma cobrança foi gerada.",
                None,
            )
        return (
            "Falha definitiva ao criar a cobrança",
            evidence_summary,
            None,
        )

    return (
        "Pagamento em situação incerta",
        evidence_summary,
        f"Confira diretamente no painel ou extrato do {provider_label} se existe cobrança ou recebimento para este pedido antes de tomar uma decisão definitiva.",
    )


def classify_intent(
    *,
    intent: OnlinePaymentIntent,
    comanda: Comanda | None,
    current_shift_id: int | None,
    webhook_count: int,
    active_payment_count: int,
    review_history: list[dict[str, Any]],
) -> dict[str, Any]:
    parsed = parse_intent_error(intent.last_error)
    evidence_code = "none"
    evidence_summary = parsed["clean_message"] or ""

    can_reconcile = False
    can_close_creation_failure = False
    can_direct_pix_confirm = False
    can_direct_pix_cancel = False
    requires_manual_escalation = False

    if intent.status == "approved":
        situation = "approved"
    elif intent.status in CLOSED_TERMINAL_STATUSES:
        situation = "closed_after_review"
    elif intent.provider == "direct_pix":
        if intent.status == "error":
            situation = "uncertain"
            requires_manual_escalation = True
            evidence_code = "direct_pix_error_manual_review"
            evidence_summary = "Tentativa de Pix direto em estado de erro exige conferência no extrato."
        else:
            situation = "awaiting_payment"
            can_direct_pix_confirm = True
            can_direct_pix_cancel = True
            evidence_code = "direct_pix_pending_receipt"
    else:
        if intent.status == "pending" and intent.external_payment_id:
            if parsed["stage"] == "reconcile_failed" or (
                intent.last_error and intent.reconciliation_attempted_at is not None
            ):
                situation = "provider_query_failed"
                can_reconcile = True
                requires_manual_escalation = True
                evidence_code = "provider_reconciliation_query_failed"
                evidence_summary = "A consulta de reconciliação no provedor falhou e precisa ser repetida ou verificada no banco."
            else:
                situation = "awaiting_payment"
                can_reconcile = True
                evidence_code = "external_charge_awaiting_confirmation"
        elif (
            intent.status == "error"
            and intent.external_payment_id
            and (
                parsed["stage"] == "reconcile_failed"
                or intent.reconciliation_attempted_at is not None
            )
        ):
            situation = "provider_query_failed"
            can_reconcile = True
            requires_manual_escalation = True
            evidence_code = "provider_reconciliation_query_failed"
            evidence_summary = "Não foi possível confirmar o resultado da consulta ao provedor."
        elif intent.status == "error":
            eligible, evidence_code, evidence_summary = has_definitive_creation_failure_evidence(
                intent=intent,
                comanda=comanda,
                webhook_count=webhook_count,
                active_payment_count=active_payment_count,
            )
            if eligible:
                situation = "creation_failed"
                can_close_creation_failure = True
            elif parsed["stage"] == "reconcile_failed" and intent.external_payment_id:
                situation = "provider_query_failed"
                can_reconcile = True
                requires_manual_escalation = True
            else:
                situation = "uncertain"
                can_reconcile = bool(intent.external_payment_id)
                requires_manual_escalation = True
        else:
            situation = "uncertain"
            can_reconcile = bool(intent.external_payment_id)
            requires_manual_escalation = True
            evidence_code = "interrupted_or_unconfirmed_creation"
            evidence_summary = "A tentativa foi iniciada sem confirmação final do código Pix nem recusa definitiva."

    reason_title, reason_detail, escalation_guidance = _build_reason_copy(
        intent=intent,
        situation=situation,
        parsed=parsed,
        evidence_code=evidence_code,
        evidence_summary=evidence_summary,
    )

    if current_shift_id is None:
        shift_scope = "no_open_shift"
    elif intent.turno_id == current_shift_id:
        shift_scope = "current_shift"
    else:
        shift_scope = "previous_shift"

    allowed_actions: list[str] = []
    if can_reconcile:
        allowed_actions.append("reconcile")
    if can_close_creation_failure:
        allowed_actions.append("close_creation_failure")
    if can_direct_pix_confirm:
        allowed_actions.append("confirm_direct_pix")
    if can_direct_pix_cancel:
        allowed_actions.append("cancel_direct_pix")
    if requires_manual_escalation:
        allowed_actions.append("escalate_manual_review")

    recommended_action = allowed_actions[0] if allowed_actions else "none"
    blocks_disconnect = intent.status in UNRESOLVED_STATUSES
    order_number = comanda.numero_pedido if comanda is not None else None

    return {
        "id": intent.id,
        "comanda_id": intent.comanda_id,
        "order_number": order_number,
        "amount": str(_money(intent.amount)),
        "created_at": _iso_utc(intent.created_at),
        "created_at_local": _iso_local(intent.created_at),
        "provider": intent.provider,
        "provider_label": PROVIDER_LABELS.get(intent.provider, intent.provider),
        "status": intent.status,
        "comanda_open": bool(comanda is not None and not comanda.fechada),
        "turno_id": intent.turno_id,
        "shift_scope": shift_scope,
        "situation": situation,
        "situation_label": SITUATION_LABELS[situation],
        "blocks_disconnect": blocks_disconnect,
        "reason_title": reason_title,
        "reason_detail": reason_detail,
        "evidence_code": evidence_code,
        "evidence_summary": evidence_summary,
        "provider_code": parsed["provider_code"],
        "provider_request_id": parsed["provider_request_id"],
        "http_status": parsed["http_status"],
        "has_external_id": bool(intent.external_payment_id),
        "external_payment_id_ref": (
            intent.external_payment_id
            if intent.external_payment_id and len(intent.external_payment_id) <= 48
            else (f"...{intent.external_payment_id[-12:]}" if intent.external_payment_id else None)
        ),
        "reconciliation_attempted_at": _iso_utc(intent.reconciliation_attempted_at),
        "expires_at": _iso_utc(intent.expires_at),
        "can_reconcile": can_reconcile,
        "can_close_creation_failure": can_close_creation_failure,
        "can_direct_pix_confirm": can_direct_pix_confirm,
        "can_direct_pix_cancel": can_direct_pix_cancel,
        "requires_manual_escalation": requires_manual_escalation,
        "escalation_guidance": escalation_guidance,
        "allowed_actions": allowed_actions,
        "recommended_action": recommended_action,
        "review_history": review_history,
    }


def _classify_intents_batch(
    db: Session,
    *,
    restaurant_id: int,
    intents: list[OnlinePaymentIntent],
    current_shift_id: int | None,
) -> list[dict[str, Any]]:
    if not intents:
        return []

    comanda_ids = {intent.comanda_id for intent in intents}
    external_ids = {intent.external_payment_id for intent in intents if intent.external_payment_id}

    comandas = {
        row.id: row
        for row in db.query(Comanda)
        .filter(Comanda.restaurante_id == restaurant_id, Comanda.id.in_(comanda_ids))
        .all()
    }

    webhook_counts: dict[str, int] = {}
    if external_ids:
        for ext_id, cnt in (
            db.query(
                OnlinePaymentWebhookEvent.external_payment_id,
                func.count(OnlinePaymentWebhookEvent.id),
            )
            .filter(
                OnlinePaymentWebhookEvent.restaurante_id == restaurant_id,
                OnlinePaymentWebhookEvent.external_payment_id.in_(external_ids),
            )
            .group_by(OnlinePaymentWebhookEvent.external_payment_id)
            .all()
        ):
            webhook_counts[str(ext_id)] = int(cnt or 0)

    active_payment_counts: dict[str, int] = {}
    for comanda_id, cnt in (
        db.query(Pagamento.comanda_id, func.count(Pagamento.id))
        .filter(
            Pagamento.restaurante_id == restaurant_id,
            Pagamento.comanda_id.in_(comanda_ids),
            Pagamento.status.in_(("aprovado", "pendente")),
        )
        .group_by(Pagamento.comanda_id)
        .all()
    ):
        active_payment_counts[str(comanda_id)] = int(cnt or 0)

    audits = (
        db.query(OnlineOrderOperationalAudit)
        .filter(OnlineOrderOperationalAudit.restaurante_id == restaurant_id)
        .order_by(OnlineOrderOperationalAudit.created_at.desc(), OnlineOrderOperationalAudit.id.desc())
        .limit(300)
        .all()
    )
    actor_ids = {audit.actor_user_id for audit in audits if audit.actor_user_id}
    actor_names: dict[str, str] = {}
    if actor_ids:
        for user_row in (
            db.query(Usuario.id, Usuario.nome)
            .filter(Usuario.restaurante_id == restaurant_id, Usuario.id.in_(actor_ids))
            .all()
        ):
            actor_names[str(user_row.id)] = str(user_row.nome)

    history_by_intent: dict[str, list[dict[str, Any]]] = {}
    for audit in audits:
        before_data = audit.before_data if isinstance(audit.before_data, dict) else {}
        after_data = audit.after_data if isinstance(audit.after_data, dict) else {}
        intent_key = after_data.get("intent_id") or before_data.get("intent_id")
        if not intent_key:
            continue
        history_by_intent.setdefault(str(intent_key), []).append(
            _format_audit_entry(audit, actor_names)
        )

    return [
        classify_intent(
            intent=intent,
            comanda=comandas.get(intent.comanda_id),
            current_shift_id=current_shift_id,
            webhook_count=webhook_counts.get(intent.external_payment_id or "", 0),
            active_payment_count=active_payment_counts.get(intent.comanda_id, 0),
            review_history=history_by_intent.get(intent.id, []),
        )
        for intent in intents
    ]


def _active_receiver_slug(db: Session, restaurant_id: int) -> str | None:
    providers = [
        row[0]
        for row in db.query(RestaurantPaymentAccount.provider)
        .filter(
            RestaurantPaymentAccount.restaurante_id == restaurant_id,
            RestaurantPaymentAccount.status == "active",
        )
        .all()
    ]
    if (
        db.query(RestaurantDirectPixConfig.restaurante_id)
        .filter(
            RestaurantDirectPixConfig.restaurante_id == restaurant_id,
            RestaurantDirectPixConfig.enabled.is_(True),
        )
        .first()
    ):
        providers.append("direct_pix")
    if not providers:
        return None
    if len(providers) > 1:
        return "multiple"
    return providers[0]


def shift_financial_pending_metrics(
    db: Session,
    *,
    restaurant_id: int,
    current_shift_id: int | None,
) -> dict[str, Any]:
    """Compute exact counts and amounts for unresolved Pix intents split by shift."""
    rows = (
        db.query(OnlinePaymentIntent.turno_id, OnlinePaymentIntent.amount)
        .filter(
            OnlinePaymentIntent.restaurante_id == restaurant_id,
            OnlinePaymentIntent.status.in_(UNRESOLVED_STATUSES),
        )
        .all()
    )
    total_count = 0
    current_count = 0
    previous_count = 0
    total_amount = Decimal("0.00")
    current_amount = Decimal("0.00")
    for turno_id, amount in rows:
        total_count += 1
        val = _money(amount)
        total_amount += val
        if current_shift_id is not None and turno_id == current_shift_id:
            current_count += 1
            current_amount += val
        else:
            previous_count += 1
    return {
        "pendencias_financeiras_count": total_count,
        "pendencias_financeiras_turno_atual_count": current_count,
        "pendencias_financeiras_anteriores_count": previous_count,
        "pendencias_financeiras_total": total_amount.quantize(MONEY),
        "pendencias_financeiras_turno_atual_total": current_amount.quantize(MONEY),
    }


def build_pending_review_payload(
    db: Session,
    *,
    restaurant_id: int,
    include_resolved: bool = True,
    provider: str | None = None,
    shift_scope: str | None = None,
) -> dict[str, Any]:
    """Build complete Financial Pending Center response for one tenant."""
    open_shift = (
        db.query(CaixaTurno)
        .filter(
            CaixaTurno.restaurante_id == restaurant_id,
            CaixaTurno.status == "aberto",
        )
        .order_by(CaixaTurno.id.desc())
        .first()
    )
    current_shift_id = open_shift.id if open_shift is not None else None

    unresolved_intents = (
        db.query(OnlinePaymentIntent)
        .filter(
            OnlinePaymentIntent.restaurante_id == restaurant_id,
            OnlinePaymentIntent.status.in_(UNRESOLVED_STATUSES),
        )
        .order_by(OnlinePaymentIntent.created_at.desc(), OnlinePaymentIntent.id.asc())
        .limit(200)
        .all()
    )

    resolved_intents: list[OnlinePaymentIntent] = []
    if include_resolved:
        resolved_intents = (
            db.query(OnlinePaymentIntent)
            .filter(
                OnlinePaymentIntent.restaurante_id == restaurant_id,
                OnlinePaymentIntent.status.notin_(UNRESOLVED_STATUSES),
            )
            .order_by(OnlinePaymentIntent.updated_at.desc(), OnlinePaymentIntent.id.asc())
            .limit(30)
            .all()
        )

    all_classified = _classify_intents_batch(
        db,
        restaurant_id=restaurant_id,
        intents=[*unresolved_intents, *resolved_intents],
        current_shift_id=current_shift_id,
    )
    unresolved_count = len(unresolved_intents)
    all_unresolved_items = all_classified[:unresolved_count]
    history_items = all_classified[unresolved_count:]

    total_amount = sum((_money(item["amount"]) for item in all_unresolved_items), Decimal("0.00"))
    current_items = [item for item in all_unresolved_items if item["shift_scope"] == "current_shift"]
    previous_items = [item for item in all_unresolved_items if item["shift_scope"] != "current_shift"]
    current_total = sum((_money(item["amount"]) for item in current_items), Decimal("0.00"))
    previous_total = sum((_money(item["amount"]) for item in previous_items), Decimal("0.00"))

    by_situation = {
        "awaiting_payment": 0,
        "creation_failed": 0,
        "uncertain": 0,
        "provider_query_failed": 0,
    }
    by_provider = {
        "pagbank": 0,
        "mercado_pago": 0,
        "direct_pix": 0,
    }
    for item in all_unresolved_items:
        sit = item["situation"]
        if sit in by_situation:
            by_situation[sit] += 1
        prov = item["provider"]
        if prov in by_provider:
            by_provider[prov] += 1

    filtered_items = all_unresolved_items
    if provider:
        filtered_items = [item for item in filtered_items if item["provider"] == provider]
    if shift_scope in {"current_shift", "previous_shift"}:
        filtered_items = [
            item
            for item in filtered_items
            if (item["shift_scope"] == "current_shift" if shift_scope == "current_shift" else item["shift_scope"] != "current_shift")
        ]

    return {
        "summary": {
            "blocking_count": len(all_unresolved_items),
            "blocking_total_amount": str(total_amount.quantize(MONEY)),
            "current_shift_id": current_shift_id,
            "current_shift_blocking_count": len(current_items),
            "current_shift_blocking_total_amount": str(current_total.quantize(MONEY)),
            "previous_shift_blocking_count": len(previous_items),
            "previous_shift_blocking_total_amount": str(previous_total.quantize(MONEY)),
            "by_situation": by_situation,
            "by_provider": by_provider,
            "can_disconnect_pagbank": by_provider["pagbank"] == 0,
            "can_disconnect_mercado_pago": by_provider["mercado_pago"] == 0,
            "can_switch_receiver": len(all_unresolved_items) == 0,
            "active_receiver": _active_receiver_slug(db, restaurant_id),
        },
        "items": filtered_items,
        "history_items": history_items,
    }


def build_blocking_detail(
    db: Session,
    *,
    restaurant_id: int,
    code: str,
    message: str,
    provider: str | None = None,
) -> dict[str, Any]:
    """Build structured zero-PII HTTP 409 detail payload explaining payment blockers."""
    payload = build_pending_review_payload(
        db,
        restaurant_id=restaurant_id,
        include_resolved=False,
        provider=provider,
    )
    items = payload["items"]
    total = sum((_money(item["amount"]) for item in items), Decimal("0.00"))
    categories = {
        "awaiting_payment": 0,
        "creation_failed": 0,
        "uncertain": 0,
        "provider_query_failed": 0,
    }
    for item in items:
        if item["situation"] in categories:
            categories[item["situation"]] += 1

    return {
        "code": code,
        "message": message,
        "provider": provider,
        "blocking_count": len(items),
        "blocking_total_amount": str(total.quantize(MONEY)),
        "categories": categories,
        "blocking_items": [
            {
                "id": item["id"],
                "comanda_id": item["comanda_id"],
                "order_number": item["order_number"],
                "amount": item["amount"],
                "provider": item["provider"],
                "provider_label": item["provider_label"],
                "situation": item["situation"],
                "situation_label": item["situation_label"],
                "reason_title": item["reason_title"],
                "can_close_creation_failure": item["can_close_creation_failure"],
                "can_reconcile": item["can_reconcile"],
                "requires_manual_escalation": item["requires_manual_escalation"],
            }
            for item in items[:25]
        ],
    }


def close_creation_failure_audited(
    db: Session,
    *,
    restaurant_id: int,
    intent_id: str,
    actor_user_id: str,
    reason: str,
    confirmed_no_charge: bool,
) -> dict[str, Any]:
    """Close only intents proven with positive evidence of creation failure prior to charging."""
    if not confirmed_no_charge:
        raise HTTPException(
            status_code=422,
            detail="Confirme que a tentativa falhou na criação e não houve recebimento antes de encerrar.",
        )
    cleaned_reason = " ".join(str(reason or "").split()).strip()
    if len(cleaned_reason) < 5 or len(cleaned_reason) > 500:
        raise HTTPException(
            status_code=422,
            detail="Informe um motivo objetivo para a revisão (entre 5 e 500 caracteres).",
        )

    intent = (
        db.query(OnlinePaymentIntent)
        .filter(
            OnlinePaymentIntent.restaurante_id == restaurant_id,
            OnlinePaymentIntent.id == intent_id,
        )
        .with_for_update()
        .one_or_none()
    )
    if intent is None:
        raise HTTPException(status_code=404, detail="Pendência financeira não encontrada.")

    comanda = (
        db.query(Comanda)
        .filter(
            Comanda.restaurante_id == restaurant_id,
            Comanda.id == intent.comanda_id,
        )
        .with_for_update()
        .one()
    )

    if intent.status == "cancelled" and comanda.fechada:
        return {
            "status": "cancelled",
            "already_closed": True,
            "intent_id": intent.id,
            "comanda_id": comanda.id,
            "order_number": comanda.numero_pedido,
            "evidence_code": "already_closed_creation_failure",
        }

    if intent.status == "approved":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "PAYMENT_ALREADY_APPROVED",
                "message": "Este pagamento já foi aprovado e não pode ser encerrado como falha de criação.",
            },
        )

    webhook_count = 0
    if intent.external_payment_id:
        webhook_count = int(
            db.query(func.count(OnlinePaymentWebhookEvent.id))
            .filter(
                OnlinePaymentWebhookEvent.restaurante_id == restaurant_id,
                OnlinePaymentWebhookEvent.external_payment_id == intent.external_payment_id,
            )
            .scalar()
            or 0
        )

    active_payment_count = int(
        db.query(func.count(Pagamento.id))
        .filter(
            Pagamento.restaurante_id == restaurant_id,
            Pagamento.comanda_id == comanda.id,
            Pagamento.status.in_(("aprovado", "pendente")),
        )
        .scalar()
        or 0
    )

    eligible, evidence_code, evidence_summary = has_definitive_creation_failure_evidence(
        intent=intent,
        comanda=comanda,
        webhook_count=webhook_count,
        active_payment_count=active_payment_count,
    )
    if not eligible:
        log_payment_event(
            "online_payment_creation_failure_close_rejected",
            level=logging.WARNING,
            tenant_id=restaurant_id,
            intent_id=intent.id,
            comanda_id=comanda.id,
            order_number=comanda.numero_pedido,
            provider=intent.provider,
            evidence_code=evidence_code,
            actor_user_id=actor_user_id,
            outcome="rejected_409",
        )
        raise HTTPException(
            status_code=409,
            detail={
                "code": "CREATION_FAILURE_NOT_PROVEN",
                "message": evidence_summary,
                "evidence_code": evidence_code,
            },
        )

    parsed = parse_intent_error(intent.last_error)
    before_data = {
        "intent_id": intent.id,
        "comanda_id": comanda.id,
        "order_number": comanda.numero_pedido,
        "provider": intent.provider,
        "amount": str(_money(intent.amount)),
        "intent_status": intent.status,
        "comanda_fechada": bool(comanda.fechada),
        "online_payment_status": comanda.online_payment_status,
        "delivery_status": comanda.delivery_status,
        "http_status": parsed["http_status"],
        "provider_code": parsed["provider_code"],
        "provider_request_id": parsed["provider_request_id"],
    }

    from .service import OnlinePaymentService

    intent.status = "cancelled"
    comanda.online_payment_status = "cancelled"
    OnlinePaymentService._finalize_unpaid_order_in_session(
        db,
        intent=intent,
        comanda=comanda,
        usuario_id=actor_user_id,
    )

    after_data = {
        "intent_id": intent.id,
        "comanda_id": comanda.id,
        "order_number": comanda.numero_pedido,
        "provider": intent.provider,
        "intent_status": intent.status,
        "comanda_fechada": bool(comanda.fechada),
        "online_payment_status": comanda.online_payment_status,
        "delivery_status": comanda.delivery_status,
        "evidence_code": evidence_code,
    }

    db.add(
        OnlineOrderOperationalAudit(
            restaurante_id=restaurant_id,
            actor_user_id=actor_user_id,
            action="online_payment_creation_failure_closed",
            reason=cleaned_reason,
            before_data=before_data,
            after_data=after_data,
        )
    )
    queue_order_tracking_refresh(db, restaurant_id, comanda.id)
    manager.queue_committed_broadcast(db, {"event": "tables_updated"}, int(restaurant_id))
    manager.queue_committed_broadcast(db, {"event": "config_updated"}, int(restaurant_id))
    log_payment_event(
        "online_payment_creation_failure_closed",
        tenant_id=restaurant_id,
        intent_id=intent.id,
        comanda_id=comanda.id,
        order_number=comanda.numero_pedido,
        provider=intent.provider,
        evidence_code=evidence_code,
        provider_code=parsed["provider_code"],
        provider_request_id=parsed["provider_request_id"],
        actor_user_id=actor_user_id,
        outcome="closed_without_payment",
    )
    db.commit()
    return {
        "status": "cancelled",
        "already_closed": False,
        "intent_id": intent.id,
        "comanda_id": comanda.id,
        "order_number": comanda.numero_pedido,
        "evidence_code": evidence_code,
    }
