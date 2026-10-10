"""Platform event acquisition, durable notices and signed campaign attribution."""
import datetime as dt
import jwt
from sqlalchemy import text
from ..config import settings
from ..models import KomaEventLead, KomaEventAttribution, KomaEventVisit
from .signup_notifications import enqueue, _owner_telegram_chat

EVENT = "ceara-tech-summit-2026"

def signup_url(lead):
    if lead.event_slug == "koma-landing":
        return "/contratar"
    token = jwt.encode({"lead_id": lead.id, "aud": "event-acquisition",
        "exp": dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=30)},
        settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return "/contratar?event_ref=" + token

def attribute_signup(db, signup_id, token):
    if not token:
        return
    try:
        claims = jwt.decode(token, settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM], audience="event-acquisition")
        lead_id = int(claims["lead_id"])
    except (jwt.PyJWTError, KeyError, ValueError, TypeError):
        return  # Expired campaign links never prevent normal customer signup.
    lead = db.query(KomaEventLead).filter(KomaEventLead.id == lead_id,
        KomaEventLead.event_slug == EVENT).first()
    if lead:
        db.add(KomaEventAttribution(signup_id=signup_id, lead_id=lead.id))

def enqueue_owner(db, lead, *, include_telegram=True):
    return enqueue(db, protocol=f"event-lead-{lead.id}", kind="event-lead-owner",
        email=settings.EVENT_LEADS_OWNER_EMAIL or settings.KOMA_OWNER_EMAIL, phone=None,
        telegram_chat=_owner_telegram_chat() if include_telegram else None,
        subject="Novo lead — Demonstração KÔMA" if lead.event_slug == "koma-landing" else "Novo lead — Siará Tech Summit — KÔMA",
        message=f"Nome: {lead.nome}\nWhatsApp: {lead.whatsapp_raw}\nEstabelecimento: {lead.empresa_nome or '-'}\nSistema atual: {lead.sistema_atual or '-'}\nPrincipal dor: {lead.principal_dor or '-'}\nAcompanhe em {settings.KOMA_PUBLIC_APP_URL}/super-admin (Leads).")

def backfill_owner_notices():
    from ..database import SessionLocal
    with SessionLocal() as db:
        leads = db.query(KomaEventLead).filter(KomaEventLead.event_slug == EVENT).order_by(KomaEventLead.id.desc()).limit(500).all()
        for lead in leads:
            enqueue_owner(db, lead, include_telegram=False)
        db.commit()

def record_visit(db, visit_id, source):
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    db.execute(insert(KomaEventVisit).values(visit_id=str(visit_id), event_slug=EVENT,
        source=source).on_conflict_do_nothing())

FUNNEL_SQL = """SELECT
 (SELECT count(*) FROM public.koma_event_visits WHERE event_slug=:event) AS visits,
 count(DISTINCT a.signup_id) AS signups,
 count(DISTINCT r.restaurante_id) AS accounts,
 count(DISTINCT CASE WHEN b.status='ready' THEN b.protocol END) AS confirmed_plans
 FROM public.koma_event_attributions a
 JOIN public.koma_event_leads l ON l.id=a.lead_id
 LEFT JOIN public.contract_acceptances c ON c.request_id=a.signup_id
 LEFT JOIN public.restaurant_contract_acceptances r ON r.acceptance_id=c.id
 LEFT JOIN public.saas_billing_setups b ON b.protocol=c.protocol
 WHERE l.event_slug=:event"""

def funnel_stats(db, event=EVENT):
    if db.get_bind().dialect.name == "postgresql":
        query = "SELECT * FROM koma_internal.event_funnel_stats(:event)"
    else:
        query = FUNNEL_SQL.replace("public.", "")
    row = db.execute(text(query), {"event": event}).mappings().one()
    return {key: int(value or 0) for key, value in row.items()}


def owner_notice_status(db, lead_id):
    notice_id = f"event-lead-{lead_id}:event-lead-owner:email"
    if db.get_bind().dialect.name == "postgresql":
        row = db.execute(text("SELECT * FROM koma_internal.event_notice_status(:id)"), {"id": notice_id}).mappings().first()
    else:
        row = db.execute(text("SELECT n.status AS queue_status, r.status AS delivery_status FROM signup_notifications n LEFT JOIN email_delivery_receipts r ON r.notification_id=n.id WHERE n.id=:id"), {"id": notice_id}).mappings().first()
    return dict(row) if row else {"queue_status": "not_queued", "delivery_status": None}
