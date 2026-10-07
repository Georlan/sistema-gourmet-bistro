"""
Rotas para captação de leads e impressão promocional do Ceará Tech Summit 2026.
"""

from __future__ import annotations

import datetime
import hashlib
import re
from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import KomaEventLead
from ..security import IPRateLimiter
from .super_admin import get_current_admin
from ..services.cearatech_promo_printer import (
    DEFAULT_CANONICAL_URL,
    build_cearatech_promo_escpos,
)

router = APIRouter(prefix="/api/leads", tags=["Leads Institucionais & Eventos"])
_lead_submission_limiter = IPRateLimiter(requests_per_minute=15)

_ALLOWED_BATCH_COPIES = {1, 20, 30, 50}


class CearaTechLeadInput(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    whatsapp: str = Field(min_length=10, max_length=30)
    empresa_nome: Optional[str] = Field(default=None, max_length=120)
    segmento: Optional[str] = Field(default=None, max_length=80)
    consent_whatsapp: bool = Field(default=True)
    event_slug: str = Field(default="ceara-tech-summit-2026", max_length=64)
    source: str = Field(default="qr_impresso", max_length=32)

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

    # Identificadores de segurança / auditoria
    ip_header = (
        request.headers.get("CF-Connecting-IP")
        or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or getattr(request.client, "host", "")
    )
    ip_hash = hashlib.sha256(ip_header.encode()).hexdigest()[:32] if ip_header else None
    user_agent = (request.headers.get("User-Agent") or "")[:250] or None

    # Deduplicação por WhatsApp dentro do mesmo evento
    existing = (
        db.query(KomaEventLead)
        .filter(
            KomaEventLead.event_slug == event_slug,
            KomaEventLead.whatsapp_normalizado == norm_phone,
        )
        .first()
    )

    if existing:
        # Knowing a phone number is not authorization to edit a global contact
        # or renew its consent. A public retry is acknowledgement only.
        return {
            "success": True,
            "lead_id": existing.id,
            "message": "Contato recebido ✓",
            "deduplicated": True,
        }

    # Criar novo lead
    lead = KomaEventLead(
        nome=payload.nome,
        whatsapp_raw=payload.whatsapp,
        whatsapp_normalizado=norm_phone,
        empresa_nome=payload.empresa_nome,
        segmento=payload.segmento,
        event_slug=event_slug,
        source=payload.source or "qr_impresso",
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


@router.get("/cearatech", summary="Listar leads do Ceará Tech Summit (Administrativo)")
def list_cearatech_leads(
    event_slug: str = "ceara-tech-summit-2026",
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_admin: dict[str, Any] = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """
    Listagem global de leads exclusiva do Super Admin da plataforma.
    Nunca exposto publicamente sem autenticação.
    """
    total = (
        db.query(func.count(KomaEventLead.id))
        .filter(KomaEventLead.event_slug == event_slug)
        .scalar()
        or 0
    )

    leads = (
        db.query(KomaEventLead)
        .filter(KomaEventLead.event_slug == event_slug)
        .order_by(desc(KomaEventLead.created_at))
        .offset(offset)
        .limit(limit)
        .all()
    )

    return {
        "event_slug": event_slug,
        "total": total,
        "leads": [
            {
                "id": item.id,
                "nome": item.nome,
                "whatsapp_raw": item.whatsapp_raw,
                "whatsapp_normalizado": item.whatsapp_normalizado,
                "empresa_nome": item.empresa_nome,
                "segmento": item.segmento,
                "source": item.source,
                "status": item.status,
                "created_at": item.created_at.isoformat() if item.created_at else None,
                "updated_at": item.updated_at.isoformat() if item.updated_at else None,
            }
            for item in leads
        ],
    }


@router.post("/cearatech/print", summary="Disparar impressão da ficha promocional (1, 20, 30, 50 cópias)")
def print_cearatech_promo(
    req: PrintPromoRequest,
    current_admin: dict[str, Any] = Depends(get_current_admin),
):
    """
    Dispara a impressão térmica de 1 ou múltiplas fichas promocionais do KÔMA.
    Pode ser acionado ao vivo no encerramento da apresentação ou para distribuição pré-evento.
    """
    escpos_bytes = build_cearatech_promo_escpos(req.target_url)
    dispatched_copies = 0
    errors = []

    # 1. Tentar transporte Bluetooth direto para impressora pareada (ex: KA-1445)
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

    # 2. Se Bluetooth não estava disponível ou falhou, tentar CUPS (ex: fila Kapbom ou G250)
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
            detail=(
                f"Nenhuma impressora térmica física respondeu ao comando. Erros: {errors}"
            ),
        )

    return {
        "success": True,
        "copies_requested": req.copies,
        "copies_dispatched": dispatched_copies,
        "message": f"{dispatched_copies} ficha(s) promocional(is) enviada(s) para impressão.",
    }
