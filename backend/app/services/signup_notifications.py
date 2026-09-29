"""Durable at-least-once delivery, encrypted payloads, bounded retry and lease."""
import asyncio
import datetime as dt
import hashlib
import json
import logging
import os
import uuid

import httpx
from sqlalchemy import text

from ..config import settings
from ..crypt import decrypt_field, encrypt_field
from ..database import SessionLocal
from ..signup_models import RestaurantSignup, SignupNotification

logger = logging.getLogger(__name__)


def _owner_telegram_chat():
    if not os.getenv("TELEGRAM_BOT_TOKEN", "").strip():
        return None
    return os.getenv("TELEGRAM_CHAT_ID", "").strip() or None


def enqueue(
    db, *, protocol, kind, email, phone, subject, message,
    telegram_chat=None, expires_hours=72, context=None,
):
    now = dt.datetime.now(dt.timezone.utc)
    channels = []
    if email:
        channels.append(("email", email))
    if phone:
        channels.append(("whatsapp", phone))
    if telegram_chat:
        channels.append(("telegram", telegram_chat))
    for channel, recipient in channels:
        values = dict(
            id=f"{protocol}:{kind}:{channel}",
            payload_encrypted=encrypt_field(
                json.dumps(
                    dict(
                        channel=channel,
                        recipient=recipient,
                        subject=subject,
                        message=message,
                        context=context,
                    )
                )
            ),
            status="pending",
            attempts=0,
            next_attempt_at=now,
            expires_at=now + dt.timedelta(hours=expires_hours),
        )
        if db.get_bind().dialect.name == "postgresql":
            from sqlalchemy.dialects.postgresql import insert as pg_insert

            db.execute(
                pg_insert(SignupNotification.__table__)
                .values(**values)
                .on_conflict_do_nothing()
            )
        else:
            from sqlalchemy.dialects.sqlite import insert as sqlite_insert

            db.execute(
                sqlite_insert(SignupNotification.__table__)
                .values(**values)
                .on_conflict_do_nothing()
            )


def enqueue_signup_started(db, *, signup_id, restaurant_name, plan, billing_cycle):
    """Queue an idempotent owner notice when a resumable signup first exists."""
    owner_email = settings.KOMA_OWNER_EMAIL
    owner_telegram = _owner_telegram_chat()
    if not (owner_email or owner_telegram):
        return
    enqueue(
        db,
        protocol=signup_id,
        kind="signup-started-owner",
        email=owner_email,
        phone=None,
        telegram_chat=owner_telegram,
        subject="Nova inscrição iniciada — KÔMA",
        message=(
            f"Nova inscrição KÔMA iniciada: {restaurant_name}. Plano: {plan} ({billing_cycle}). "
            f"Identificador: {signup_id}. Acompanhe o status em "
            f"{settings.KOMA_PUBLIC_APP_URL}/super-admin (aba Inscrições)."
        ),
    )


def enqueue_trial_started(
    db, *, tenant_id, restaurant_name, plan, billing_cycle,
    customer_name, customer_email, customer_phone, trial_ends_at,
):
    """Queue customer and owner notices with stable IDs for release retries."""
    protocol = f"tenant-{tenant_id}"
    cycle = "anual" if billing_cycle in {"annual", "anual"} else "mensal"
    end_label = trial_ends_at.strftime("%d/%m/%Y às %H:%M UTC")
    enqueue(
        db,
        protocol=protocol,
        kind="trial-started-customer",
        email=customer_email,
        phone=customer_phone,
        subject="Seus 7 dias grátis começaram — KÔMA",
        message=(
            f"Olá, {customer_name}! A operação do {restaurant_name} foi liberada. "
            f"Seus 7 dias grátis começaram agora e terminam em {end_label}. "
            f"Plano {plan} ({cycle}). Nenhuma mensalidade fixa foi cobrada na liberação. "
            f"Acesse {settings.KOMA_PUBLIC_APP_URL}/?view=caixa para continuar."
        ),
    )
    owner_email = settings.KOMA_OWNER_EMAIL
    owner_telegram = _owner_telegram_chat()
    if owner_email or owner_telegram:
        enqueue(
            db,
            protocol=protocol,
            kind="trial-started-owner",
            email=owner_email,
            phone=None,
            telegram_chat=owner_telegram,
            subject="Operação liberada e trial iniciado — KÔMA",
            message=(
                f"Operação liberada: {restaurant_name} (#{tenant_id}), plano {plan} ({cycle}). "
                f"Trial termina em {end_label}. Acompanhe no SuperAdmin."
            ),
        )


def enqueue_acceptance(
    db, *, protocol, restaurant_name, representative_name, email, phone
):
    message = (
        f"Olá, {representative_name}! A inscrição do {restaurant_name} no KÔMA foi recebida. "
        f"Protocolo: {protocol}. Agora escolha o meio de pagamento. A mensalidade fixa é R$ 0 hoje. "
        "Depois da liberação você configura o restaurante com calma; os 7 dias grátis só começam "
        "após os 4 itens essenciais da implantação e a liberação da operação pela equipe KÔMA."
    )
    enqueue(
        db,
        protocol=protocol,
        kind="accepted",
        email=email,
        phone=phone,
        subject="Inscrição recebida — KÔMA",
        message=message,
    )
    owner_email = settings.KOMA_OWNER_EMAIL
    owner_telegram = _owner_telegram_chat()
    if owner_email or owner_telegram:
        enqueue(
            db,
            protocol=protocol,
            kind="owner",
            email=owner_email,
            phone=None,
            telegram_chat=owner_telegram,
            subject="Nova inscrição iniciada — KÔMA",
            message=(
                f"Nova inscrição KÔMA iniciada: {restaurant_name}. Protocolo: {protocol}. "
                "Acompanhe o status na aba Inscrições do SuperAdmin."
            ),
        )


def enqueue_activation(
    db,
    *,
    protocol,
    restaurant_name,
    representative_name,
    email,
    phone,
    token,
    kind="activation",
):
    link = f"{settings.KOMA_PUBLIC_APP_URL}/ativar#token={token}"
    enqueue(
        db,
        protocol=protocol,
        kind=kind,
        email=email,
        phone=phone,
        subject="Seu KÔMA foi liberado — crie sua senha",
        message=(
            f"Olá, {representative_name}! O {restaurant_name} foi liberado. Crie sua senha para o "
            f"primeiro acesso: {link} . O link é pessoal e válido por 72 horas. Depois do login, "
            "conclua dados do restaurante, horários, cardápio e modalidades de operação. Seus 7 dias grátis ainda não estão "
            "correndo: depois dos 4 itens essenciais, a equipe KÔMA liberará a operação e iniciará o período grátis."
        ),
    )


def staff_invite_delivery_id(*, restaurante_id: int, usuario_id: str, token: str) -> str:
    token_ref = hashlib.sha256(token.encode("utf-8")).hexdigest()[:12]
    protocol = f"staff-{int(restaurante_id)}-{usuario_id}-{token_ref}"
    return f"{protocol}:team-invite:whatsapp"


def enqueue_staff_invite(
    db,
    *,
    restaurante_id: int,
    usuario_id: str,
    phone: str,
    person_name: str,
    restaurant_name: str,
    token: str,
) -> str:
    """Persist a staff invitation in the existing durable notification outbox.

    The raw activation token only exists inside the encrypted payload. The
    delivery identifier stores a short one-way reference so logs/status rows
    never expose the invitation secret.
    """
    token_ref = hashlib.sha256(token.encode("utf-8")).hexdigest()[:12]
    protocol = f"staff-{int(restaurante_id)}-{usuario_id}-{token_ref}"
    link = f"{settings.KOMA_PUBLIC_APP_URL}/ativar#token={token}"
    enqueue(
        db,
        protocol=protocol,
        kind="team-invite",
        email=None,
        phone=phone,
        subject="Convite para a equipe KÔMA",
        message=(
            f"Olá, {person_name}! Você foi convidado para trabalhar no "
            f"*{restaurant_name}*.\n\nCrie sua senha e ative sua conta: {link}\n\n"
            "Este convite expira em 24 horas."
        ),
        expires_hours=24,
        context="convite de equipe",
    )
    return f"{protocol}:team-invite:whatsapp"


def enqueue_release_required(db, *, protocol, restaurant_name, plan, billing_cycle):
    """Avisa o operador uma única vez quando uma autorização aguarda liberação manual."""
    message = (
        f"Autorização recorrente confirmada para {restaurant_name}. Protocolo: {protocol}. "
        f"Plano: {plan} ({billing_cycle}). Nenhuma mensalidade fixa foi cobrada hoje. "
        "Revise e libere o acesso. A recorrência ficará pausada durante a implantação e os 7 dias "
        "grátis só começarão depois dos 4 itens essenciais e da liberação pelo SuperAdmin: "
        f"{settings.KOMA_PUBLIC_APP_URL}/super-admin"
    )
    enqueue(
        db,
        protocol=protocol,
        kind="release-required",
        email=settings.KOMA_OWNER_EMAIL,
        phone=None,
        telegram_chat=_owner_telegram_chat(),
        subject="Restaurante aguardando liberação — KÔMA",
        message=message,
    )


def _deliver(payload, delivery_id):
    if payload["channel"] == "email":
        if not settings.RESEND_API_KEY or not settings.EMAIL_FROM:
            raise RuntimeError("email_not_configured")
        response = httpx.post(
            "https://api.resend.com/emails",
            timeout=15,
            headers={
                "Authorization": f"Bearer {settings.RESEND_API_KEY}",
                "Idempotency-Key": delivery_id,
            },
            json={
                "from": settings.EMAIL_FROM,
                "to": [payload["recipient"]],
                "subject": payload["subject"],
                "text": payload["message"],
            },
        )
        if not response.is_success:
            raise RuntimeError("email_provider_rejected")
    elif payload["channel"] == "telegram":
        bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
        if not bot_token or not payload["recipient"]:
            raise RuntimeError("telegram_not_configured")
        response = httpx.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            timeout=15,
            json={"chat_id": payload["recipient"], "text": payload["message"]},
        )
        if not response.is_success or not response.json().get("ok"):
            raise RuntimeError("telegram_provider_rejected")
    elif payload["channel"] == "whatsapp":
        if not settings.KOMA_WHATSAPP_AUTOMATION_ENABLED:
            raise RuntimeError("whatsapp_not_configured")
        from .whatsapp import enviar_texto_whatsapp_detalhado

        result = enviar_texto_whatsapp_detalhado(
            payload["recipient"],
            payload["message"],
            contexto=payload.get("context") or "inscrição KÔMA",
        )
        if not result.sucesso:
            raise RuntimeError("whatsapp_provider_rejected")
    else:
        raise RuntimeError("unknown_notification_channel")


def dispatch_batch():
    now = dt.datetime.now(dt.timezone.utc)
    claim = str(uuid.uuid4())
    with SessionLocal() as db:
        if db.get_bind().dialect.name == "postgresql":
            rows = db.execute(
                text("SELECT * FROM koma_internal.claim_signup_notifications(:claim)"),
                {"claim": claim},
            ).mappings().all()
        else:
            db.query(RestaurantSignup).filter(
                RestaurantSignup.expires_at < now
            ).delete(synchronize_session=False)
            db.query(SignupNotification).filter(
                SignupNotification.expires_at < now,
                SignupNotification.status.in_(["pending", "sending", "failed"]),
                SignupNotification.payload_encrypted != "",
            ).update(
                {
                    "status": "failed",
                    "last_error": "expired",
                    "payload_encrypted": "",
                },
                synchronize_session=False,
            )
            candidates = db.query(SignupNotification).filter(
                SignupNotification.status.in_(["pending", "sending"]),
                SignupNotification.next_attempt_at <= now,
                SignupNotification.expires_at > now,
            ).limit(10).all()
            rows = []
            for row in candidates:
                row.status = "sending"
                row.claim_token = claim
                row.attempts += 1
                row.next_attempt_at = now + dt.timedelta(minutes=5)
                rows.append(
                    {c.name: getattr(row, c.name) for c in SignupNotification.__table__.columns}
                )
        db.commit()

    for row in rows:
        error = None
        try:
            _deliver(json.loads(decrypt_field(row["payload_encrypted"])), row["id"])
        except Exception as exc:
            error = str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__
            error = error[:100]
        state = (
            "sent"
            if error is None
            else "failed"
            if row["attempts"] >= 12
            else "pending"
        )
        due = now + dt.timedelta(seconds=min(3600, 30 * 2 ** min(row["attempts"], 7)))
        with SessionLocal() as db:
            values = dict(
                id=row["id"], claim=claim, status=state, error=error, due=due
            )
            if db.get_bind().dialect.name == "postgresql":
                db.execute(
                    text(
                        "SELECT koma_internal.settle_signup_notification(:id,:claim,:status,:error,:due)"
                    ),
                    values,
                )
            else:
                db.query(SignupNotification).filter(
                    SignupNotification.id == row["id"],
                    SignupNotification.claim_token == claim,
                ).update(
                    {
                        "status": state,
                        "last_error": error,
                        "next_attempt_at": due,
                        "claim_token": None,
                        **({"payload_encrypted": ""} if state == "sent" else {}),
                    }
                )
            db.commit()


async def run_worker():
    while True:
        try:
            await asyncio.to_thread(dispatch_batch)
        except Exception:
            logger.exception("Signup notification worker failed")
        await asyncio.sleep(30)
