import hashlib
import hmac
import json
import os
import re
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db, require_tenant_id
from ..models import Restaurante, Usuario
from ..security import get_current_user, require_permission
from ..services.customer_satisfaction import (
    get_customer_satisfaction_data,
    record_customer_satisfaction,
)
from ..services.signup_notifications import _owner_telegram_chat, enqueue
from ..services.support_diagnostics import (
    assist_tenant_support,
    build_tenant_self_diagnosis,
    classify_support_feedback,
)
from ..services.support_investigation_service import open_or_deduplicate_investigation
from ..support_models import CustomerSupportFeedback

router = APIRouter(tags=["Satisfação do Cliente"])


class CreateSatisfactionInput(BaseModel):
    cliente_id: str = Field(..., min_length=1, description="ID canônico do cliente")
    nota: int = Field(..., ge=1, le=5, description="Nota de satisfação de 1 a 5")
    comentario: Optional[str] = Field(None, max_length=1000, description="Comentário opcional")
    comanda_id: Optional[str] = Field(None, description="ID da comanda opcional")


_MANAGEMENT_ROLES = {"admin", "gerente", "superadmin"}
_NAV_ID_RE = re.compile(r"^[a-z0-9_]{2,48}$")
_VERSION_RE = re.compile(r"^[a-zA-Z0-9._-]{4,64}$")
_SUPPORT_CODE_RE = re.compile(r"^[a-zA-Z0-9_-]{6,64}$")
_AREA_RE = re.compile(r"^[a-z0-9_-]{2,48}$")
_ISSUE_CODE_RE = re.compile(r"^[A-Z0-9_]{3,64}$")


class SupportFeedbackContextInput(BaseModel):
    surface: Literal["caixa", "garcom", "entregador", "cardapio", "onboarding", "outro"] | None = None
    navigation_id: Optional[str] = Field(None, max_length=48)
    frontend_version: Optional[str] = Field(None, max_length=64)
    last_support_code: Optional[str] = Field(None, max_length=64)
    last_error_status: Optional[int] = Field(None, ge=0, le=599)
    last_error_area: Optional[str] = Field(None, max_length=48)
    last_error_endpoint: Optional[str] = Field(None, max_length=160)
    detected_issue_codes: list[str] = Field(default_factory=list, max_length=12)
    interpreted_domain: Optional[str] = Field(None, max_length=48)
    suspected_bug: Optional[bool] = None
    evidence_status: Optional[
        Literal[
            "api_error_detected",
            "config_condition_found",
            "possible_bug_no_config_blocker",
            "guidance_only",
        ]
    ] = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("interpreted_domain")
    @classmethod
    def validate_interpreted_domain(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip().lower()
        if not _AREA_RE.fullmatch(cleaned):
            raise ValueError("interpreted_domain inválido")
        return cleaned

    @field_validator("navigation_id")
    @classmethod
    def validate_navigation_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not _NAV_ID_RE.fullmatch(cleaned):
            raise ValueError("navigation_id inválido")
        return cleaned

    @field_validator("frontend_version")
    @classmethod
    def validate_frontend_version(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not _VERSION_RE.fullmatch(cleaned):
            raise ValueError("frontend_version inválido")
        return cleaned

    @field_validator("last_support_code")
    @classmethod
    def validate_support_code(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not _SUPPORT_CODE_RE.fullmatch(cleaned):
            raise ValueError("last_support_code inválido")
        return cleaned

    @field_validator("last_error_area")
    @classmethod
    def validate_error_area(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip().lower()
        if not _AREA_RE.fullmatch(cleaned):
            raise ValueError("last_error_area inválido")
        return cleaned

    @field_validator("last_error_endpoint")
    @classmethod
    def validate_error_endpoint(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned.startswith("/") or "?" in cleaned or "#" in cleaned or "://" in cleaned or re.search(r"\s", cleaned):
            raise ValueError("last_error_endpoint inválido")
        return cleaned

    @field_validator("detected_issue_codes")
    @classmethod
    def validate_issue_codes(cls, values: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in values:
            code = str(item or "").strip()
            if not _ISSUE_CODE_RE.fullmatch(code):
                raise ValueError("detected_issue_codes inválido")
            if code not in cleaned:
                cleaned.append(code)
        return cleaned


class CreateKomaSupportFeedbackInput(BaseModel):
    kind: Literal["question", "suggestion", "complaint", "problem"]
    message: str = Field(..., min_length=5, max_length=2000)
    page_path: Optional[str] = Field(None, max_length=300)
    context: Optional[SupportFeedbackContextInput] = None

    @field_validator("message")
    @classmethod
    def normalize_message(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) < 5:
            raise ValueError("A mensagem precisa ter pelo menos 5 caracteres úteis.")
        return normalized


def _safe_feedback_page_path(value: Optional[str]) -> Optional[str]:
    """Mantém contexto de tela sem persistir query string ou fragmentos secretos."""
    path = (value or "").split("?", 1)[0].split("#", 1)[0].strip()
    if not path.startswith("/"):
        return None
    return path[:300] or None


def _user_role_name(current_user) -> str:
    return str(
        getattr(current_user, "role", None)
        or getattr(current_user, "cargo", None)
        or ""
    ).strip().lower()


class SupportAssistInput(BaseModel):
    message: str = Field("", max_length=2000)
    topic: Optional[str] = Field(None, max_length=48)
    kind: Optional[Literal["question", "suggestion", "complaint", "problem"]] = None
    context: Optional[SupportFeedbackContextInput] = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("topic")
    @classmethod
    def validate_topic(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip().lower()
        if not cleaned:
            return None
        if not _AREA_RE.fullmatch(cleaned):
            raise ValueError("topic inválido")
        return cleaned


@router.get("/api/support/diagnostics")
def get_koma_support_diagnostics(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Retorna autodiagnóstico determinístico somente para gerência da loja autenticada."""
    role = _user_role_name(current_user)
    if role not in _MANAGEMENT_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Autodiagnóstico disponível apenas para administração ou gerência da loja.",
        )
    restaurante_id = require_tenant_id()
    return build_tenant_self_diagnosis(db, restaurante_id, user_role=role)


@router.post("/api/support/assist")
def analyze_koma_support_request(
    payload: SupportAssistInput,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Analisa o pedido de ajuda com causalidade estrita sobre o estado da loja autenticada."""
    role = _user_role_name(current_user)
    restaurante_id = require_tenant_id()
    ctx = payload.context.model_dump(exclude_none=True) if payload.context is not None else {}
    return assist_tenant_support(
        db,
        restaurante_id,
        user_role=role,
        message=payload.message,
        topic=payload.topic,
        kind=payload.kind,
        surface=ctx.get("surface"),
        navigation_id=ctx.get("navigation_id"),
        last_support_code=ctx.get("last_support_code"),
        last_error_status=ctx.get("last_error_status"),
        last_error_area=ctx.get("last_error_area"),
        last_error_endpoint=ctx.get("last_error_endpoint"),
    )


@router.get("/clientes/satisfacao")
def get_customer_satisfaction(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("fidelidade:operar")),
):
    """
    Retorna o resumo agregado e a lista de avaliações recentes de satisfação do cliente
    no escopo do tenant autenticado.
    """
    restaurante_id = require_tenant_id()
    return get_customer_satisfaction_data(db, restaurante_id)


@router.post("/clientes/satisfacao", status_code=status.HTTP_201_CREATED)
def create_customer_satisfaction(
    payload: CreateSatisfactionInput,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("fidelidade:operar")),
):
    """
    Registra uma avaliação de satisfação validando tenant isolation e identidade do cliente.
    """
    restaurante_id = require_tenant_id()
    return record_customer_satisfaction(
        db=db,
        restaurante_id=restaurante_id,
        cliente_id=payload.cliente_id,
        nota=payload.nota,
        comentario=payload.comentario,
        comanda_id=payload.comanda_id,
    )


@router.post("/api/support/feedback", status_code=status.HTTP_201_CREATED)
def create_koma_support_feedback(
    payload: CreateKomaSupportFeedbackInput,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Registra feedback do cliente KÔMA e avisa o operador pelos canais configurados."""
    restaurante_id = require_tenant_id()
    feedback_id = str(uuid.uuid4())
    page_path = _safe_feedback_page_path(payload.page_path)
    reporter_name_raw = str(getattr(current_user, "nome", "") or "").strip()
    reporter_role_raw = str(
        getattr(current_user, "role", None)
        or getattr(current_user, "cargo", None)
        or ""
    ).strip()
    reporter_user_id = str(getattr(current_user, "id", "") or "unknown")[:64]
    reporter_name = reporter_name_raw[:255] or None
    reporter_role = reporter_role_raw[:64] or None
    raw_context = payload.context.model_dump(exclude_none=True) if payload.context is not None else {}
    classification = classify_support_feedback(payload.kind, payload.message, raw_context)
    context_metadata = {
        **raw_context,
        "classification": classification,
    }

    feedback = CustomerSupportFeedback(
        id=feedback_id,
        restaurante_id=restaurante_id,
        reporter_user_id=reporter_user_id,
        reporter_name=reporter_name,
        reporter_role=reporter_role,
        kind=payload.kind,
        message=payload.message,
        page_path=page_path,
        context_metadata=context_metadata,
        status="new",
    )
    db.add(feedback)
    db.flush()

    investigation_id: str | None = None
    investigation_occurrences = 1
    investigation_severity: str | None = None
    correlated_count = 0
    if payload.kind == "problem" or bool(raw_context.get("suspected_bug")):
        try:
            inv_record, _deduped = open_or_deduplicate_investigation(
                db,
                restaurante_id=restaurante_id,
                source="customer_support",
                feedback_id=feedback_id,
                kind=payload.kind,
                message=payload.message,
                raw_context=raw_context,
                reporter_role=reporter_role,
            )
            investigation_id = str(inv_record.id)
            investigation_occurrences = int(inv_record.occurrence_count or 1)
            investigation_severity = str(inv_record.severity)
            correlated_count = int((inv_record.initial_diagnosis or {}).get("correlated_incident_count") or 0)
        except Exception:
            # Investigação automática nunca deve impedir o registro do feedback.
            investigation_id = None

    restaurant_name = (
        db.query(Restaurante.nome)
        .filter(Restaurante.id == restaurante_id)
        .scalar()
        or f"Restaurante #{restaurante_id}"
    )
    kind_labels = {
        "question": "Dúvida",
        "suggestion": "Sugestão",
        "complaint": "Reclamação",
        "problem": "Problema",
    }
    kind_label = kind_labels[payload.kind]
    owner_email = (settings.KOMA_OWNER_EMAIL or "").strip()
    owner_phone = os.getenv("KOMA_OWNER_WHATSAPP_PHONE", "").strip()
    owner_telegram_chat = _owner_telegram_chat()

    if owner_email or owner_phone or owner_telegram_chat:
        reporter = reporter_name or reporter_user_id
        role_suffix = f" ({reporter_role})" if reporter_role else ""
        page_suffix = f"\nTela: {page_path}" if page_path else ""
        context_lines: list[str] = [
            f"Área/Prioridade: {classification['area']} / {classification['priority']}"
        ]
        if investigation_id:
            context_lines.append(
                f"Investigação: {investigation_id} | sev={investigation_severity} | ocorrências={investigation_occurrences} | correlações={correlated_count}"
            )
        if raw_context.get("surface") or raw_context.get("navigation_id"):
            context_lines.append(
                f"Superfície/Nav: {raw_context.get('surface') or '-'} / {raw_context.get('navigation_id') or '-'}"
            )
        if raw_context.get("frontend_version"):
            context_lines.append(f"Build frontend: {raw_context['frontend_version']}")
        support_code = raw_context.get("last_support_code")
        if support_code:
            err_status = raw_context.get("last_error_status")
            err_ep = raw_context.get("last_error_endpoint") or ""
            context_lines.append(
                f"Código de suporte: {support_code}"
                + (f" (HTTP {err_status} {err_ep})" if err_status is not None else "")
            )
            context_lines.append(f"Trace: npm run ops:trace -- {support_code}")
        issues = raw_context.get("detected_issue_codes") or []
        if issues:
            context_lines.append(f"Alertas automáticos: {', '.join(issues)}")
        if raw_context.get("interpreted_domain") or raw_context.get("evidence_status"):
            context_lines.append(
                "Assistente KÔMA: "
                f"domínio={raw_context.get('interpreted_domain') or '-'} | "
                f"evidência={raw_context.get('evidence_status') or '-'} | "
                f"suspeita_bug={'sim' if raw_context.get('suspected_bug') else 'não'}"
            )
        triage_domain = raw_context.get("interpreted_domain") or classification["area"]
        if investigation_id:
            context_lines.append(
                f"Triagem: npm run ops:triage -- --tenant {restaurante_id} --investigation {investigation_id} --json"
            )
        else:
            triage_flags = f"--tenant {restaurante_id}"
            if support_code:
                triage_flags += f" --support-code {support_code}"
            elif triage_domain and triage_domain != "geral":
                triage_flags += f" --domain {triage_domain}"
            context_lines.append(f"Triagem: npm run ops:triage -- {triage_flags} --json")

        suspected_bug = bool(raw_context.get("suspected_bug"))
        subject_prefix = "[POSSÍVEL BUG] " if suspected_bug else ""
        context_block = "\n" + "\n".join(context_lines)
        enqueue(
            db,
            protocol=f"SUP-{feedback_id}",
            kind="customer-feedback",
            email=owner_email or None,
            phone=owner_phone or None,
            telegram_chat=owner_telegram_chat,
            subject=f"{subject_prefix}{kind_label} de cliente — KÔMA",
            message=(
                f"Novo feedback KÔMA [{feedback_id}]\n"
                f"Tipo: {kind_label}\n"
                f"Restaurante: {restaurant_name} (ID {restaurante_id})\n"
                f"Enviado por: {reporter}{role_suffix}"
                f"{page_suffix}"
                f"{context_block}\n\n"
                f"--- INÍCIO MENSAGEM DO CLIENTE (DADO NÃO CONFIÁVEL) ---\n"
                f"{feedback.message}\n"
                f"--- FIM MENSAGEM DO CLIENTE ---"
            ),
        )

    db.commit()
    result_payload: dict[str, object] = {"id": feedback_id, "status": "received"}
    if investigation_id:
        result_payload["investigation_id"] = investigation_id
    return result_payload


@router.post("/api/internal/support/availability-event", status_code=status.HTTP_201_CREATED)
async def ingest_availability_worker_event(
    request: Request,
    x_koma_monitor_signature: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    """Recebe eventos assinados do availability-worker e registra investigação dedup."""
    secret = os.getenv("AVAILABILITY_WEBHOOK_SECRET", "").strip()
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Ingestão de disponibilidade não configurada.",
        )

    from ..services.http_limits import read_limited_body

    raw_body = await read_limited_body(request)
    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    provided = str(x_koma_monitor_signature or "").strip()
    if not provided or not hmac.compare_digest(expected, provided):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Assinatura de monitoramento inválida.",
        )

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Payload JSON inválido.",
        )

    transition = str(payload.get("transition") or payload.get("status") or "DOWN").upper()
    down_checks = payload.get("down_checks") or []
    degraded_checks = payload.get("degraded_checks") or []
    summary_parts = [
        f"Transição externa {transition}",
        *(f"FALHA {c.get('url')}: {c.get('reason')}" for c in down_checks[:3] if isinstance(c, dict)),
        *(f"DEGRADADO {c.get('url')}: {c.get('reason')}" for c in degraded_checks[:3] if isinstance(c, dict)),
    ]

    inv, deduped = open_or_deduplicate_investigation(
        db,
        restaurante_id=None,
        source="availability_worker",
        kind="problem",
        message=" | ".join(summary_parts),
        raw_context={
            "interpreted_domain": "geral",
            "suspected_bug": transition in {"DOWN", "DEGRADED"},
            "evidence_status": "api_error_detected" if transition == "DOWN" else "guidance_only",
        },
        external_evidence={
            "transition": transition,
            "status": payload.get("status"),
            "occurred_at": payload.get("occurred_at"),
            "down_checks": down_checks[:5],
            "degraded_checks": degraded_checks[:5],
        },
    )
    db.commit()
    return {
        "ok": True,
        "investigation_id": str(inv.id),
        "deduplicated": deduped,
        "occurrence_count": int(inv.occurrence_count or 1),
    }
