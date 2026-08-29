"""Verified customer identity for the public digital menu."""
from __future__ import annotations

import datetime
import logging
from contextlib import contextmanager

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    Header,
    HTTPException,
    Request,
    status,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db, tenant_session_scope
from ..models import Cliente, OtpChallenge, PublicRateLimit
from ..schemas import (
    CustomerOtpRequest,
    CustomerOtpVerify,
    CustomerProfileResponse,
    CustomerProfileUpdate,
    CustomerSessionResponse,
)
from ..services.clientes import (
    buscar_cliente_por_id,
    buscar_cliente_por_telefone,
    cadastrar_ou_atualizar_cliente,
)
from ..services.customer_auth import (
    CustomerTokenClaims,
    create_customer_access_token,
    decode_customer_access_token,
    generate_otp,
    hash_otp,
    hash_phone_for_otp,
    hash_public_rate_key,
    otp_matches,
)
from ..services.whatsapp import enviar_codigo_otp_whatsapp
from ..websocket_manager import manager
from .cardapio_digital import public_tenant_scope


logger = logging.getLogger("koma.cardapio_clientes")
router = APIRouter(
    prefix="/cardapio/clientes",
    tags=["Clientes do Cardápio Digital"],
)

_GENERIC_OTP_ERROR = "Código inválido ou expirado. Solicite um novo código."


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _profile(cliente: Cliente) -> CustomerProfileResponse:
    return CustomerProfileResponse(
        id=cliente.id,
        nome=cliente.nome,
        telefone=cliente.telefone,
        endereco=cliente.endereco or "",
        saldo_pontos=int(cliente.saldo_pontos or 0),
        saldo_cashback=float(cliente.saldo_cashback or 0),
    )


from ..services.public_orders import (
    authenticated_customer,
    client_ip as _client_ip,
    consume_rate_limit as _consume_rate_limit,
)


@contextmanager
def customer_token_scope(
    db: Session,
    raw_token: str,
):
    try:
        claims = decode_customer_access_token(raw_token)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc

    with tenant_session_scope(db, claims.restaurante_id):
        yield claims


@router.post(
    "/otp/solicitar",
    status_code=status.HTTP_202_ACCEPTED,
)
def request_customer_otp(
    payload: CustomerOtpRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    if not getattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", False):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Autenticação por WhatsApp indisponível no momento.",
        )
    with public_tenant_scope(str(payload.restaurante_id), None, db) as restaurante_id:

        now = _utcnow()
        _consume_rate_limit(
            db,
            restaurante_id=restaurante_id,
            scope="customer_otp_request_ip",
            raw_key=_client_ip(request),
            max_requests=settings.CUSTOMER_OTP_MAX_IP_REQUESTS,
            window_seconds=settings.CUSTOMER_OTP_WINDOW_SECONDS,
        )

        telefone_hash = hash_phone_for_otp(restaurante_id, payload.telefone)
        challenge = db.query(OtpChallenge).filter(
            OtpChallenge.restaurante_id == restaurante_id,
            OtpChallenge.telefone_hash == telefone_hash,
        ).with_for_update().first()

        if challenge is not None:
            last_send = challenge.ultimo_envio_em
            if last_send.tzinfo is None:
                last_send = last_send.replace(tzinfo=datetime.timezone.utc)
            retry_after = max(1, settings.CUSTOMER_OTP_RESEND_SECONDS)
            elapsed = (now - last_send).total_seconds()
            if elapsed < retry_after:
                db.commit()
                return {
                    "detail": "Código já solicitado. Aguarde antes de reenviar.",
                    "retry_after_seconds": int(retry_after - elapsed) + 1,
                }

            window_start = challenge.janela_iniciada_em
            if window_start.tzinfo is None:
                window_start = window_start.replace(tzinfo=datetime.timezone.utc)
            if now - window_start >= datetime.timedelta(
                seconds=max(60, settings.CUSTOMER_OTP_WINDOW_SECONDS)
            ):
                challenge.janela_iniciada_em = now
                challenge.envios_na_janela = 0

            if int(challenge.envios_na_janela or 0) >= max(
                1,
                settings.CUSTOMER_OTP_MAX_SENDS,
            ):
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Muitas solicitações. Aguarde alguns minutos e tente novamente.",
                )

        codigo = generate_otp()
        codigo_hash = hash_otp(restaurante_id, payload.telefone, codigo)
        expires_at = now + datetime.timedelta(
            seconds=max(60, settings.CUSTOMER_OTP_TTL_SECONDS)
        )

        if challenge is None:
            challenge = OtpChallenge(
                restaurante_id=restaurante_id,
                telefone_hash=telefone_hash,
                otp_hash=codigo_hash,
                expira_em=expires_at,
                tentativas=0,
                ultimo_envio_em=now,
                janela_iniciada_em=now,
                envios_na_janela=1,
            )
            db.add(challenge)
        else:
            challenge.otp_hash = codigo_hash
            challenge.expira_em = expires_at
            challenge.tentativas = 0
            challenge.ultimo_envio_em = now
            challenge.envios_na_janela = int(challenge.envios_na_janela or 0) + 1

        db.commit()
        challenge_id = challenge.id

        from ..models import Restaurante
        restaurante = db.query(Restaurante).filter(Restaurante.id == restaurante_id).first()
        nome_rest = restaurante.nome if restaurante and restaurante.nome else "Kôma"

        try:
            sent_ok = enviar_codigo_otp_whatsapp(payload.telefone, codigo, nome_rest)
        except TypeError:
            sent_ok = enviar_codigo_otp_whatsapp(payload.telefone, codigo)

        if not sent_ok:
            db.query(OtpChallenge).filter(
                OtpChallenge.restaurante_id == restaurante_id,
                OtpChallenge.id == challenge_id,
                OtpChallenge.otp_hash == codigo_hash,
            ).delete(synchronize_session=False)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Não foi possível enviar o código agora. "
                    "Tente novamente em instantes."
                ),
            )

    return {
        "detail": "Código enviado ao WhatsApp informado.",
        "expires_in_seconds": max(60, settings.CUSTOMER_OTP_TTL_SECONDS),
    }


@router.post(
    "/otp/verificar",
    response_model=CustomerSessionResponse,
)
def verify_customer_otp(
    payload: CustomerOtpVerify,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    with public_tenant_scope(str(payload.restaurante_id), None, db) as restaurante_id:
        _consume_rate_limit(
            db,
            restaurante_id=restaurante_id,
            scope="customer_otp_verify_ip",
            raw_key=_client_ip(request),
            max_requests=max(10, settings.CUSTOMER_OTP_MAX_IP_REQUESTS * 2),
            window_seconds=settings.CUSTOMER_OTP_WINDOW_SECONDS,
        )

        telefone_hash = hash_phone_for_otp(restaurante_id, payload.telefone)
        challenge = db.query(OtpChallenge).filter(
            OtpChallenge.restaurante_id == restaurante_id,
            OtpChallenge.telefone_hash == telefone_hash,
        ).with_for_update().first()
        now = _utcnow()

        if challenge is None:
            raise HTTPException(status_code=400, detail=_GENERIC_OTP_ERROR)

        expires_at = challenge.expira_em
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=datetime.timezone.utc)
        if expires_at <= now:
            db.delete(challenge)
            db.commit()
            raise HTTPException(status_code=400, detail=_GENERIC_OTP_ERROR)

        max_attempts = max(1, settings.CUSTOMER_OTP_MAX_ATTEMPTS)
        if int(challenge.tentativas or 0) >= max_attempts:
            db.delete(challenge)
            db.commit()
            raise HTTPException(status_code=400, detail=_GENERIC_OTP_ERROR)

        if not otp_matches(
            restaurante_id,
            payload.telefone,
            payload.codigo,
            challenge.otp_hash,
        ):
            challenge.tentativas = int(challenge.tentativas or 0) + 1
            if challenge.tentativas >= max_attempts:
                db.delete(challenge)
            db.commit()
            raise HTTPException(status_code=400, detail=_GENERIC_OTP_ERROR)

        cliente = buscar_cliente_por_telefone(
            db,
            restaurante_id=restaurante_id,
            telefone=payload.telefone,
            bloquear=True,
        )
        created = cliente is None
        cliente = cadastrar_ou_atualizar_cliente(
            db,
            restaurante_id=restaurante_id,
            telefone=payload.telefone,
            nome=payload.nome,
            endereco=payload.endereco,
        )
        db.delete(challenge)
        db.commit()
        db.refresh(cliente)

        access_token = create_customer_access_token(
            cliente_id=cliente.id,
            restaurante_id=restaurante_id,
        )
        background_tasks.add_task(
            manager.broadcast,
            {
                "event": "customers_updated",
                "detail": {
                    "action": "created" if created else "updated",
                    "cliente_id": cliente.id,
                },
            },
            restaurante_id,
            target_audience="internal",
        )
        return CustomerSessionResponse(
            access_token=access_token,
            cliente=_profile(cliente),
        )


@router.get("/me", response_model=CustomerProfileResponse)
def get_customer_profile(
    db: Session = Depends(get_db),
    customer_token: str = Header(alias="X-Koma-Customer-Token"),
):
    with customer_token_scope(db, customer_token) as claims:
        cliente = buscar_cliente_por_id(
            db,
            restaurante_id=claims.restaurante_id,
            cliente_id=claims.cliente_id,
        )
        if cliente is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Sessão de cliente inválida ou expirada.",
            )
        return _profile(cliente)


@router.patch("/me", response_model=CustomerProfileResponse)
def update_customer_profile(
    payload: CustomerProfileUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    customer_token: str = Header(alias="X-Koma-Customer-Token"),
):
    with customer_token_scope(db, customer_token) as claims:
        cliente = buscar_cliente_por_id(
            db,
            restaurante_id=claims.restaurante_id,
            cliente_id=claims.cliente_id,
            bloquear=True,
        )
        if cliente is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Sessão de cliente inválida ou expirada.",
            )
        cliente.nome = payload.nome
        cliente.endereco = payload.endereco or None
        db.commit()
        db.refresh(cliente)

        background_tasks.add_task(
            manager.broadcast,
            {
                "event": "customers_updated",
                "detail": {
                    "action": "updated",
                    "cliente_id": cliente.id,
                },
            },
            claims.restaurante_id,
            target_audience="internal",
        )
        return _profile(cliente)
