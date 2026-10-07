"""Public lead capture plus Super Admin CRM for KÔMA event leads."""

from __future__ import annotations

import datetime
import hashlib
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import KomaEventLead
from ..security import IPRateLimiter
from ..services.cearatech_promo_printer import DEFAULT_CANONICAL_URL, build_cearatech_promo_escpos
from .super_admin import get_current_admin

router = APIRouter(prefix="/api/leads", tags=["Leads Institucionais & Eventos"])
_lead_submission_limiter = IPRateLimiter(requests_per_minute=15)

_ALLOWED_BATCH_COPIES = {1, 20, 30, 50}
_ALLOWED_CRM_STATUSES = {"new", "contacted", "qualified", "demo_scheduled", "converted", "lost"}


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
    def validate_nome(cls, value: str) -> str:
        cleaned = " ".join(value.strip().split())
        if len(cleaned) < 2:
            raise ValueError("O nome deve ter pelo menos 2 caracteres.")
        return cleaned

    @field_validator("whatsapp")
    @classmethod
    def validate_whatsapp(cls, value: str) -> str:
        digits = re.sub(r"\D", "", value or "")
        if digits.startswith("55") and len(digits) in (12, 13):
            national = digits[2:]
        elif len(digits) in (10, 11):
            national = digits
        else:
            raise ValueError("Informe um WhatsApp válido com DDD (ex.: 85 99999-9999).")
        ddd = int(national[:2])
        if ddd < 11 or ddd > 99:
            raise ValueError("DDD inválido.")
        return value.strip()


class PrintPromoRequest(BaseModel):
    copies: int = Field(default=1)
    target_url: str = Field(default=DEFAULT_CANONICAL_URL, max_length=255)
    model_config = ConfigDict(extra="ignore")

    @field_validator("copies")
    @classmethod
    def validate_copies(cls, value: int) -> int:
        if value not in _ALLOWED_BATCH_COPIES:
            raise ValueError(f"Quantidade de cópias deve ser uma de: {sorted(_ALLOWED_BATCH_COPIES)}")
        return value


class LeadCrmUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=4000)
    contacted_at: Optional[datetime.datetime] = None
    cidade: Optional[str] = Field(default=None, max_length=100)
    quantidade_unidades: Optional[int] = Field(default=None, ge=1, le=10000)
    sistema_atual: Optional[str] = Field(default=None, max_length=120)
    principal_dor: Optional[str] = Field(default=None, max_length=1000)
    interesse: Optional[str] = Field(default=None, max_length=255)
    melhor_horario_contato: Optional[str] = Field(default=None, max_length=120)

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip().lower()
        if normalized not in _ALLOWED_CRM_STATUSES:
            raise ValueError("Status comercial inválido.")
        return normalized


def _normalize_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("55") and len(digits) in (12, 13):
        national = digits[2:]
    elif len(digits) in (10, 11):
        national = digits
    else:
        national = digits
    return f"55{national}"


def _row_to_crm_lead(row) -> dict:
    data = dict(row)
    for key in ("consent_at", "contacted_at", "created_at", "updated_at"):
        value = data.get(key)
        if value is not None and hasattr(value, "isoformat"):
            data[key] = value.isoformat()
    data["whatsapp_url"] = f"https://wa.me/{data['whatsapp_normalizado']}"
    return data


@router.post("/cearatech", status_code=status.HTTP_201_CREATED, summary="Registrar lead do Ceará Tech Summit")
def submit_cearatech_lead(payload: CearaTechLeadInput, request: Request, db: Session = Depends(get_db)):
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
        return {"success": True, "lead_id": existing.id, "message": "Contato recebido ✓", "deduplicated": True}

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
    return {"success": True, "lead_id": lead.id, "message": "Contato recebido ✓", "deduplicated": False}


@router.get("/admin", summary="CRM de leads (Super Admin)")
def list_event_leads(
    event_slug: Optional[str] = Query(default=None, max_length=64),
    crm_status: Optional[str] = Query(default=None, alias="status", max_length=32),
    search: Optional[str] = Query(default=None, max_length=120),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    admin: dict = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if crm_status and crm_status not in _ALLOWED_CRM_STATUSES:
        raise HTTPException(status_code=422, detail="Status comercial inválido.")

    conditions = ["1=1"]
    params: dict[str, object] = {"limit": limit, "offset": offset}
    if event_slug:
        conditions.append("event_slug = :event_slug")
        params["event_slug"] = event_slug
    if crm_status:
        conditions.append("status = :crm_status")
        params["crm_status"] = crm_status
    if search and search.strip():
        conditions.append(
            "(lower(nome) LIKE :search OR lower(COALESCE(empresa_nome, '')) LIKE :search "
            "OR whatsapp_normalizado LIKE :digits)"
        )
        params["search"] = f"%{search.strip().lower()}%"
        params["digits"] = f"%{re.sub(r'\D', '', search)}%"

    where = " AND ".join(conditions)
    select_columns = """
        id, nome, whatsapp_raw, whatsapp_normalizado, empresa_nome, segmento,
        event_slug, source, consent_whatsapp, consent_at, consent_version,
        status, contacted_at, notes, cidade, quantidade_unidades, sistema_atual,
        principal_dor, interesse, melhor_horario_contato, created_at, updated_at
    """
    rows = db.execute(
        text(f"""
            SELECT {select_columns}
            FROM koma_event_leads
            WHERE {where}
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    ).mappings().all()
    total = db.execute(text(f"SELECT COUNT(*) FROM koma_event_leads WHERE {where}"), params).scalar() or 0
    counts = dict(
        db.execute(
            text("""
                SELECT status, COUNT(*) AS total
                FROM koma_event_leads
                WHERE (:event_slug IS NULL OR event_slug = :event_slug)
                GROUP BY status
            """),
            {"event_slug": event_slug},
        ).all()
    )
    events = [
        row[0]
        for row in db.execute(
            text("SELECT DISTINCT event_slug FROM koma_event_leads ORDER BY event_slug DESC")
        ).all()
    ]
    converted = int(counts.get("converted", 0))
    event_total = sum(int(value) for value in counts.values())
    return {
        "total": int(total),
        "counts": {key: int(counts.get(key, 0)) for key in sorted(_ALLOWED_CRM_STATUSES)},
        "conversion_rate": round((converted / event_total) * 100, 1) if event_total else 0.0,
        "events": events,
        "leads": [_row_to_crm_lead(row) for row in rows],
    }


@router.get("/cearatech", summary="Listar leads do Ceará Tech Summit (Super Admin)")
def list_cearatech_leads_compat(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    admin: dict = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Compatibilidade do endpoint administrativo criado no fluxo inicial do evento."""
    return list_event_leads(
        event_slug="ceara-tech-summit-2026",
        crm_status=None,
        search=None,
        limit=limit,
        offset=offset,
        admin=admin,
        db=db,
    )


@router.get("/admin/{lead_id}", summary="Detalhar lead (Super Admin)")
def get_event_lead(
    lead_id: int,
    admin: dict = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    row = db.execute(
        text("""
            SELECT id, nome, whatsapp_raw, whatsapp_normalizado, empresa_nome, segmento,
                   event_slug, source, consent_whatsapp, consent_at, consent_version,
                   status, contacted_at, notes, cidade, quantidade_unidades, sistema_atual,
                   principal_dor, interesse, melhor_horario_contato, created_at, updated_at
            FROM koma_event_leads WHERE id = :lead_id
        """),
        {"lead_id": lead_id},
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Lead não encontrado.")
    return _row_to_crm_lead(row)


@router.patch("/admin/{lead_id}", summary="Atualizar lead no CRM (Super Admin)")
def update_event_lead(
    lead_id: int,
    payload: LeadCrmUpdate,
    admin: dict = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=422, detail="Nenhuma alteração informada.")

    allowed = {
        "status", "notes", "contacted_at", "cidade", "quantidade_unidades",
        "sistema_atual", "principal_dor", "interesse", "melhor_horario_contato",
    }
    changes = {key: value for key, value in changes.items() if key in allowed}
    if changes.get("status") == "contacted" and "contacted_at" not in changes:
        changes["contacted_at"] = datetime.datetime.now(datetime.timezone.utc)

    assignments = [f"{key} = :{key}" for key in changes]
    changes["updated_at"] = datetime.datetime.now(datetime.timezone.utc)
    assignments.append("updated_at = :updated_at")
    params = {**changes, "lead_id": lead_id}
    result = db.execute(
        text(f"UPDATE koma_event_leads SET {', '.join(assignments)} WHERE id = :lead_id"),
        params,
    )
    if result.rowcount == 0:
        db.rollback()
        raise HTTPException(status_code=404, detail="Lead não encontrado.")
    db.commit()
    return get_event_lead(lead_id, admin=admin, db=db)


@router.post("/cearatech/print", summary="Disparar impressão da ficha promocional (1, 20, 30, 50 cópias)")
def print_cearatech_promo(
    req: PrintPromoRequest,
    admin: dict = Depends(get_current_admin),
):
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
