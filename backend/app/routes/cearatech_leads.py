"""
Rotas para captação de leads e operação comercial do Ceará Tech Summit 2026.
"""

from __future__ import annotations

import datetime
import hashlib
import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import desc, func, or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import KomaEventLead
from ..security import IPRateLimiter
from ..services.cearatech_promo_printer import (
    DEFAULT_CANONICAL_URL,
    build_cearatech_promo_escpos,
)
from .super_admin import get_current_admin

router = APIRouter(prefix="/api/leads", tags=["Leads Institucionais & Eventos"])
# Evento presencial pode concentrar dezenas de participantes atrás do mesmo NAT/Wi-Fi.
# O telefone+evento continua deduplicado no banco; este limite protege abuso bruto sem
# bloquear uma turma inteira que envie o formulário no mesmo minuto.
_lead_submission_limiter = IPRateLimiter(requests_per_minute=120)

_ALLOWED_BATCH_COPIES = {1, 20, 30, 50}
LEAD_STATUSES = (
    "new",
    "contacted",
    "qualified",
    "demo_scheduled",
    "converted",
    "lost",
)
LEAD_SOURCES = {"qr_tela", "qr_impresso", "link_direto"}


class CearaTechLeadInput(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    whatsapp: str = Field(min_length=10, max_length=30)
    empresa_nome: Optional[str] = Field(default=None, max_length=120)
    segmento: Optional[str] = Field(default=None, max_length=80)
    consent_whatsapp: bool = Field(default=False)
    event_slug: str = Field(default="ceara-tech-summit-2026", max_length=64)
    source: str = Field(default="link_direto", max_length=32)

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    @field_validator("nome")
    @classmethod
    def validate_nome(cls, v: str) -> str:
        cleaned = " ".join(v.strip().split())
        if len(cleaned) < 2:
            raise ValueError("O nome deve ter pelo menos 2 caracteres.")
        return cleaned

    @field_validator("whatsapp")
    @classmethod
    def validate_whatsapp(cls, v: str) -> str:
        digits = re.sub(r"\D", "", v or "")
        if digits.startswith("55") and len(digits) in (12, 13):
            national = digits[2:]
        elif len(digits) in (10, 11):
            national = digits
        else:
            raise ValueError("Informe um WhatsApp válido com DDD (ex.: 85 99999-9999).")

        ddd = int(national[:2])
        if ddd < 11 or ddd > 99:
            raise ValueError("DDD inválido.")
        return v.strip()

    @field_validator("source")
    @classmethod
    def validate_source(cls, v: str) -> str:
        normalized = (v or "").strip().lower()
        return normalized if normalized in LEAD_SOURCES else "link_direto"


class CearaTechLeadUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=4000)
    last_contact_at: Optional[datetime.datetime] = None
    cidade: Optional[str] = Field(default=None, max_length=120)
    quantidade_unidades: Optional[int] = Field(default=None, ge=1, le=999)
    sistema_atual: Optional[str] = Field(default=None, max_length=120)
    principal_dor: Optional[str] = Field(default=None, max_length=2000)
    interesse: Optional[str] = Field(default=None, max_length=2000)
    melhor_horario_contato: Optional[str] = Field(default=None, max_length=120)

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        normalized = v.strip().lower()
        if normalized not in LEAD_STATUSES:
            raise ValueError(f"Status inválido. Use um de: {', '.join(LEAD_STATUSES)}")
        return normalized


class PrintPromoRequest(BaseModel):
    copies: int = Field(default=1)
    target_url: str = Field(default=DEFAULT_CANONICAL_URL, max_length=255)
    model_config = ConfigDict(extra="ignore")

    @field_validator("copies")
    @classmethod
    def validate_copies(cls, v: int) -> int:
        if v not in _ALLOWED_BATCH_COPIES:
            raise ValueError(f"Quantidade de cópias deve ser uma de: {sorted(_ALLOWED_BATCH_COPIES)}")
        return v


def _normalize_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("55") and len(digits) in (12, 13):
        national = digits[2:]
    elif len(digits) in (10, 11):
        national = digits
    else:
        national = digits
    return f"55{national}"


def _lead_payload(item: KomaEventLead, *, include_consent: bool = False) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": item.id,
        "nome": item.nome,
        "whatsapp_raw": item.whatsapp_raw,
        "whatsapp_normalizado": item.whatsapp_normalizado,
        "empresa_nome": item.empresa_nome,
        "segmento": item.segmento,
        "event_slug": item.event_slug,
        "source": item.source,
        "status": item.status,
        "last_contact_at": item.last_contact_at.isoformat() if item.last_contact_at else None,
        "cidade": item.cidade,
        "quantidade_unidades": item.quantidade_unidades,
        "sistema_atual": item.sistema_atual,
        "principal_dor": item.principal_dor,
        "interesse": item.interesse,
        "melhor_horario_contato": item.melhor_horario_contato,
        "notes": item.notes,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }
    if include_consent:
        payload.update({
            "consent_whatsapp": bool(item.consent_whatsapp),
            "consent_at": item.consent_at.isoformat() if item.consent_at else None,
            "consent_version": item.consent_version,
        })
    return payload


def _apply_event_and_search_filters(query, *, event_slug: Optional[str], search: Optional[str]):
    if event_slug:
        query = query.filter(KomaEventLead.event_slug == event_slug.strip().lower())
    term = (search or "").strip()
    if term:
        like = f"%{term}%"
        digits = re.sub(r"\D", "", term)
        phone_like = f"%{digits}%" if digits else like
        query = query.filter(
            or_(
                KomaEventLead.nome.ilike(like),
                KomaEventLead.empresa_nome.ilike(like),
                KomaEventLead.whatsapp_raw.ilike(like),
                KomaEventLead.whatsapp_normalizado.ilike(phone_like),
            )
        )
    return query


@router.post("/cearatech", status_code=status.HTTP_201_CREATED, summary="Registrar lead do Ceará Tech Summit")
def submit_cearatech_lead(
    payload: CearaTechLeadInput,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Endpoint público e estável para submissão de leads da landing /cearatech.
    Aplica rate limiting por IP, validação de consentimento e deduplicação graciosa.
    """
    _lead_submission_limiter.check(request)

    if not payload.consent_whatsapp:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="O consentimento para contato via WhatsApp é obrigatório.",
        )

    norm_phone = _normalize_phone(payload.whatsapp)
    event_slug = payload.event_slug.strip().lower() or "ceara-tech-summit-2026"
    now_utc = datetime.datetime.now(datetime.timezone.utc)

    ip_header = (
        request.headers.get("CF-Connecting-IP")
        or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or getattr(request.client, "host", "")
    )
    ip_hash = hashlib.sha256(ip_header.encode()).hexdigest()[:32] if ip_header else None
    user_agent = (request.headers.get("User-Agent") or "")[:250] or None

    existing = (
        db.query(KomaEventLead)
        .filter(
            KomaEventLead.event_slug == event_slug,
            KomaEventLead.whatsapp_normalizado == norm_phone,
        )
        .first()
    )

    if existing:
        existing.nome = payload.nome
        if payload.empresa_nome:
            existing.empresa_nome = payload.empresa_nome
        if payload.segmento:
            existing.segmento = payload.segmento
        existing.whatsapp_raw = payload.whatsapp
        existing.source = payload.source
        existing.consent_whatsapp = True
        existing.consent_at = now_utc
        existing.consent_version = "v1_cearatech_2026"
        existing.updated_at = now_utc
        if ip_hash:
            existing.ip_hash = ip_hash
        if user_agent:
            existing.user_agent = user_agent

        db.commit()
        db.refresh(existing)
        return {
            "success": True,
            "lead_id": existing.id,
            "message": "Contato recebido ✓",
            "deduplicated": True,
        }

    lead = KomaEventLead(
        nome=payload.nome,
        whatsapp_raw=payload.whatsapp,
        whatsapp_normalizado=norm_phone,
        empresa_nome=payload.empresa_nome,
        segmento=payload.segmento,
        event_slug=event_slug,
        source=payload.source,
        consent_whatsapp=True,
        consent_at=now_utc,
        consent_version="v1_cearatech_2026",
        status="new",
        ip_hash=ip_hash,
        user_agent=user_agent,
        created_at=now_utc,
        updated_at=now_utc,
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)

    return {
        "success": True,
        "lead_id": lead.id,
        "message": "Contato recebido ✓",
        "deduplicated": False,
    }


@router.get("/cearatech", summary="Listar leads comerciais (Super Admin)")
def list_cearatech_leads(
    event_slug: Optional[str] = Query(default=None, max_length=64),
    status_filter: Optional[str] = Query(default=None, alias="status", max_length=32),
    search: Optional[str] = Query(default=None, max_length=120),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    admin: dict = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    del admin
    normalized_status = (status_filter or "").strip().lower() or None
    if normalized_status and normalized_status not in LEAD_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Status de lead inválido.",
        )

    base_query = _apply_event_and_search_filters(
        db.query(KomaEventLead),
        event_slug=event_slug,
        search=search,
    )

    grouped = (
        base_query.with_entities(KomaEventLead.status, func.count(KomaEventLead.id))
        .group_by(KomaEventLead.status)
        .all()
    )
    counts = {name: 0 for name in LEAD_STATUSES}
    for name, count in grouped:
        if name in counts:
            counts[name] = int(count or 0)
    base_total = sum(counts.values())

    query = base_query
    if normalized_status:
        query = query.filter(KomaEventLead.status == normalized_status)

    total = query.with_entities(func.count(KomaEventLead.id)).scalar() or 0
    leads = (
        query.order_by(desc(KomaEventLead.created_at))
        .offset(offset)
        .limit(limit)
        .all()
    )

    event_rows = (
        db.query(
            KomaEventLead.event_slug,
            func.count(KomaEventLead.id),
            func.max(KomaEventLead.created_at),
        )
        .group_by(KomaEventLead.event_slug)
        .order_by(desc(func.max(KomaEventLead.created_at)))
        .all()
    )

    conversion_rate = (counts["converted"] / base_total * 100.0) if base_total else 0.0
    return {
        "event_slug": event_slug,
        "total": int(total),
        "stats": {
            "total": base_total,
            **counts,
            "conversion_rate": round(conversion_rate, 1),
        },
        "events": [
            {
                "event_slug": slug,
                "count": int(count or 0),
                "last_created_at": last.isoformat() if last else None,
            }
            for slug, count, last in event_rows
        ],
        "leads": [_lead_payload(item) for item in leads],
    }


@router.get("/cearatech/{lead_id}", summary="Detalhar lead comercial (Super Admin)")
def get_cearatech_lead(
    lead_id: int,
    admin: dict = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    del admin
    lead = db.query(KomaEventLead).filter(KomaEventLead.id == lead_id).one_or_none()
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead não encontrado.")
    return _lead_payload(lead, include_consent=True)


@router.patch("/cearatech/{lead_id}", summary="Atualizar funil e qualificação do lead (Super Admin)")
def update_cearatech_lead(
    lead_id: int,
    payload: CearaTechLeadUpdate,
    admin: dict = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    del admin
    lead = (
        db.query(KomaEventLead)
        .filter(KomaEventLead.id == lead_id)
        .with_for_update()
        .one_or_none()
    )
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead não encontrado.")

    changes = payload.model_dump(exclude_unset=True)
    string_fields = {
        "notes",
        "cidade",
        "sistema_atual",
        "principal_dor",
        "interesse",
        "melhor_horario_contato",
    }
    for field_name in string_fields:
        if field_name in changes and isinstance(changes[field_name], str):
            changes[field_name] = changes[field_name].strip() or None

    if changes.get("status") == "contacted" and "last_contact_at" not in changes and lead.last_contact_at is None:
        changes["last_contact_at"] = datetime.datetime.now(datetime.timezone.utc)

    for field_name, value in changes.items():
        setattr(lead, field_name, value)

    lead.updated_at = datetime.datetime.now(datetime.timezone.utc)
    db.commit()
    db.refresh(lead)
    return _lead_payload(lead, include_consent=True)


@router.post("/cearatech/print", summary="Disparar impressão da ficha promocional (1, 20, 30, 50 cópias)")
def print_cearatech_promo(
    req: PrintPromoRequest,
    admin: dict = Depends(get_current_admin),
):
    """
    Mantido como fallback operacional. A apresentação principal pode usar o QR
    em tela e evitar consumo de papel.
    """
    del admin
    escpos_bytes = build_cearatech_promo_escpos(req.target_url)
    dispatched_copies = 0
    errors = []

    try:
        from ...adapters.transports import BluetoothRfcommTransport
    except ImportError:
        try:
            import sys
            sys.path.insert(0, "print-agent")
            from adapters.transports import BluetoothRfcommTransport
        except Exception:
            BluetoothRfcommTransport = None

    bt_transport = None
    if BluetoothRfcommTransport:
        try:
            bt_transport = BluetoothRfcommTransport("86:67:7A:6B:30:C4", channel=1, timeout=8.0)
            if not bt_transport.is_available() or not bt_transport.probe():
                bt_transport = None
        except Exception:
            bt_transport = None

    if bt_transport:
        for _ in range(req.copies):
            success = bt_transport.send(escpos_bytes)
            if success:
                dispatched_copies += 1
            else:
                errors.append("Falha no envio via Bluetooth RFCOMM")
                break

    if dispatched_copies == 0:
        import subprocess
        for printer_name in ("Kapbom", "G250"):
            try:
                proc = subprocess.run(
                    ["lp", "-d", printer_name, "-o", "raw"],
                    input=escpos_bytes,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=5,
                    check=False,
                )
                if proc.returncode == 0:
                    dispatched_copies = 1
                    for _ in range(req.copies - 1):
                        subprocess.run(
                            ["lp", "-d", printer_name, "-o", "raw"],
                            input=escpos_bytes,
                            stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE,
                            timeout=5,
                            check=False,
                        )
                        dispatched_copies += 1
                    break
            except Exception as exc:
                errors.append(f"CUPS {printer_name}: {exc}")

    if dispatched_copies == 0:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Nenhuma impressora térmica física respondeu ao comando. Erros: {errors}",
        )

    return {
        "success": True,
        "copies_requested": req.copies,
        "copies_dispatched": dispatched_copies,
        "message": f"{dispatched_copies} ficha(s) promocional(is) enviada(s) para impressão.",
    }
