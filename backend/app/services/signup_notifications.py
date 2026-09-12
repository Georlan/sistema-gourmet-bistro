"""Durable at-least-once delivery, encrypted payloads, bounded retry and lease."""
import asyncio
import datetime as dt
import json
import logging
import os
import uuid
import httpx
from sqlalchemy import insert, text
from ..database import SessionLocal
from ..signup_models import SignupNotification
from ..crypt import encrypt_field, decrypt_field
from ..config import settings

logger = logging.getLogger(__name__)

def enqueue(db, *, protocol, kind, email, phone, subject, message, expires_hours=72):
    now = dt.datetime.now(dt.timezone.utc)
    channels = []
    if email: channels.append(("email", email))
    if phone: channels.append(("whatsapp", phone))
    for channel, recipient in channels:
        values = dict(id=f"{protocol}:{kind}:{channel}", payload_encrypted=encrypt_field(json.dumps(dict(channel=channel, recipient=recipient, subject=subject, message=message))), status="pending", attempts=0, next_attempt_at=now, expires_at=now+dt.timedelta(hours=expires_hours))
        if db.get_bind().dialect.name == "postgresql":
            from sqlalchemy.dialects.postgresql import insert as pg_insert
            db.execute(pg_insert(SignupNotification.__table__).values(**values).on_conflict_do_nothing())
        else:
            from sqlalchemy.dialects.sqlite import insert as sqlite_insert
            db.execute(sqlite_insert(SignupNotification.__table__).values(**values).on_conflict_do_nothing())


def enqueue_acceptance(db, *, protocol, restaurant_name, representative_name, email, phone):
    message = f"Olá, {representative_name}! A inscrição do {restaurant_name} no KÔMA foi recebida. Protocolo: {protocol}. Conclua o pagamento para liberar o acesso."
    enqueue(db, protocol=protocol, kind="accepted", email=email, phone=phone, subject="Inscrição recebida — KÔMA", message=message)
    owner_phone = os.getenv("KOMA_OWNER_WHATSAPP_PHONE", "").strip()
    if owner_phone:
        enqueue(db, protocol=protocol, kind="owner", email=None, phone=owner_phone, subject="Nova inscrição", message=f"Nova contratação KÔMA: {restaurant_name}. Protocolo: {protocol}. Consulte Inscrições no superadmin.")


def enqueue_activation(db, *, protocol, restaurant_name, representative_name, email, phone, token):
    link = f"{settings.KOMA_PUBLIC_APP_URL}/ativar#token={token}"
    enqueue(db, protocol=protocol, kind="activation", email=email, phone=phone, subject="Crie sua senha — KÔMA", message=f"Olá, {representative_name}! O {restaurant_name} está liberado. Crie sua senha: {link} . Link pessoal válido por 72 horas. No primeiro acesso, importe o cardápio, confira preços, configure horários e faça um pedido de teste.")


def _deliver(payload, delivery_id):
    if payload["channel"] == "email":
        if not settings.RESEND_API_KEY or not settings.EMAIL_FROM:
            raise RuntimeError("email_not_configured")
        response = httpx.post("https://api.resend.com/emails", timeout=15,
            headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}", "Idempotency-Key": delivery_id},
            json={"from": settings.EMAIL_FROM, "to": [payload["recipient"]], "subject": payload["subject"], "text": payload["message"]})
        if not response.is_success: raise RuntimeError("email_provider_rejected")
    else:
        if not settings.KOMA_WHATSAPP_AUTOMATION_ENABLED:
            raise RuntimeError("whatsapp_not_configured")
        from .whatsapp import enviar_texto_whatsapp_detalhado
        result = enviar_texto_whatsapp_detalhado(payload["recipient"], payload["message"], contexto="inscrição KÔMA")
        if not result.sucesso: raise RuntimeError("whatsapp_provider_rejected")


def dispatch_batch():
    now = dt.datetime.now(dt.timezone.utc)
    claim = str(uuid.uuid4())
    with SessionLocal() as db:
        if db.get_bind().dialect.name == "postgresql":
            rows = db.execute(text("SELECT * FROM koma_internal.claim_signup_notifications(:claim)"), {"claim": claim}).mappings().all()
        else:
            candidates = db.query(SignupNotification).filter(SignupNotification.status.in_(["pending", "sending"]), SignupNotification.next_attempt_at <= now, SignupNotification.expires_at > now).limit(10).all()
            rows = []
            for row in candidates:
                row.status = "sending"; row.claim_token = claim; row.attempts += 1; row.next_attempt_at = now + dt.timedelta(minutes=5)
                rows.append({c.name: getattr(row,c.name) for c in SignupNotification.__table__.columns})
        db.commit()
    for row in rows:
        error = None
        try: _deliver(json.loads(decrypt_field(row["payload_encrypted"])), row["id"])
        except Exception as exc:
            error = str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__
            error = error[:100]
        state = "sent" if error is None else "failed" if row["attempts"] >= 12 else "pending"
        due = now + dt.timedelta(seconds=min(3600, 30 * 2 ** min(row["attempts"], 7)))
        with SessionLocal() as db:
            values = dict(id=row["id"], claim=claim, status=state, error=error, due=due)
            if db.get_bind().dialect.name == "postgresql":
                db.execute(text("SELECT koma_internal.settle_signup_notification(:id,:claim,:status,:error,:due)"), values)
            else:
                db.query(SignupNotification).filter(SignupNotification.id == row["id"], SignupNotification.claim_token == claim).update({"status": state, "last_error": error, "next_attempt_at": due, "claim_token": None, **({"payload_encrypted": ""} if state == "sent" else {})})
            db.commit()


async def run_worker():
    while True:
        try: await asyncio.to_thread(dispatch_batch)
        except Exception: logger.exception("Signup notification worker failed")
        await asyncio.sleep(30)
