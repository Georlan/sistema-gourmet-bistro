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
from ..models import Cliente, CustomerRegistrationChallenge, OtpChallenge, PublicRateLimit
from ..schemas import (
    CustomerLoginRequest,
    CustomerOtpRequest,
    CustomerOtpVerify,
    CustomerProfileResponse,
    CustomerRegistrationConfirm,
    CustomerRegistrationPhoneConfirm,
    CustomerRegistrationRequest,
    CustomerProfileUpdate,
    CustomerRegisterRequest,
    CustomerSessionResponse,
)
from ..security import get_password_hash, verify_password
from ..services.clientes import (
    buscar_cliente_por_id,
    buscar_cliente_por_telefone,
    cadastrar_ou_atualizar_cliente,
    normalizar_nome_cliente,
    normalizar_telefone_cliente,
)
from ..services.customer_auth import (
    CustomerTokenClaims,
    create_customer_access_token,
    decode_customer_access_token,
    generate_customer_registration_token,
    generate_otp,
    hash_customer_registration_token,
    hash_otp,
    hash_phone_for_otp,
    hash_public_rate_key,
    otp_matches,
    registration_token_restaurante_id,
)
from ..services.customer_registration import (
    registration_email_available,
    send_registration_email,
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
        email=cliente.email,
        endereco=cliente.endereco or "",
        saldo_pontos=int(cliente.saldo_pontos or 0),
        saldo_cashback=float(cliente.saldo_cashback or 0),
        email_verificado=cliente.email_verificado_em is not None,
        telefone_verificado=cliente.telefone_verificado_em is not None,
    )


def _consume_otp_challenge(
    db: Session,
    *,
    restaurante_id: int,
    telefone: str,
    codigo: str,
) -> OtpChallenge:
    telefone_hash = hash_phone_for_otp(restaurante_id, telefone)
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
    max_attempts = max(1, settings.CUSTOMER_OTP_MAX_ATTEMPTS)
    if expires_at <= now or int(challenge.tentativas or 0) >= max_attempts:
        db.delete(challenge)
        db.commit()
        raise HTTPException(status_code=400, detail=_GENERIC_OTP_ERROR)
    if not otp_matches(restaurante_id, telefone, codigo, challenge.otp_hash):
        challenge.tentativas = int(challenge.tentativas or 0) + 1
        if challenge.tentativas >= max_attempts:
            db.delete(challenge)
        db.commit()
        raise HTTPException(status_code=400, detail=_GENERIC_OTP_ERROR)
    return challenge


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
        authenticated_customer(db, raw_token=raw_token, expected_restaurante_id=claims.restaurante_id)
        yield claims


def _registration_challenge(
    db: Session,
    *,
    restaurante_id: int,
    token: str,
    lock: bool = False,
) -> CustomerRegistrationChallenge:
    try:
        token_hash = hash_customer_registration_token(restaurante_id, token)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link de confirmação inválido ou expirado.",
        ) from exc

    query = db.query(CustomerRegistrationChallenge).filter(
        CustomerRegistrationChallenge.restaurante_id == restaurante_id,
        CustomerRegistrationChallenge.token_hash == token_hash,
    )
    if lock:
        query = query.with_for_update()
    challenge = query.first()
    if challenge is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link de confirmação inválido ou expirado.",
        )

    expires_at = challenge.expira_em
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=datetime.timezone.utc)
    if expires_at <= _utcnow():
        db.delete(challenge)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link de confirmação inválido ou expirado.",
        )
    return challenge


def _registration_restaurante_id(token: str) -> int:
    try:
        return registration_token_restaurante_id(token)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link de confirmação inválido ou expirado.",
        ) from exc


@router.post(
    "/cadastro/solicitar",
    status_code=status.HTTP_202_ACCEPTED,
)
def request_customer_registration(
    payload: CustomerRegistrationRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    if not registration_email_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cadastro por e-mail indisponível no momento. Tente novamente mais tarde.",
        )

    with public_tenant_scope(str(payload.restaurante_id), None, db) as restaurante_id:
        try:
            telefone = normalizar_telefone_cliente(payload.telefone)
            nome = normalizar_nome_cliente(payload.nome)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        email = payload.email.strip().lower()
        if len(payload.senha.encode("utf-8")) > 72:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A senha deve conter no máximo 72 bytes.",
            )

        for scope, raw_key, maximum, detail in (
            (
                "customer_email_registration_ip",
                _client_ip(request),
                settings.CUSTOMER_OTP_MAX_IP_REQUESTS,
                "Muitas tentativas de cadastro a partir deste IP. Tente novamente mais tarde.",
            ),
            (
                "customer_email_registration_email",
                email,
                settings.CUSTOMER_OTP_MAX_SENDS,
                "Muitas solicitações para este e-mail. Aguarde alguns minutos e tente novamente.",
            ),
            (
                "customer_email_registration_phone",
                telefone,
                settings.CUSTOMER_OTP_MAX_SENDS,
                "Muitas solicitações para este telefone. Aguarde alguns minutos e tente novamente.",
            ),
        ):
            _consume_rate_limit(
                db,
                restaurante_id=restaurante_id,
                scope=scope,
                raw_key=raw_key,
                max_requests=max(1, maximum),
                window_seconds=settings.CUSTOMER_OTP_WINDOW_SECONDS,
                detail=detail,
            )
            db.commit()

        existing_account = db.query(Cliente).filter(
            Cliente.restaurante_id == restaurante_id,
            Cliente.email == email,
            Cliente.senha_hash.isnot(None),
        ).first()
        if existing_account is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Já existe uma conta com este e-mail neste restaurante. Faça login.",
            )

        now = _utcnow()
        challenge = db.query(CustomerRegistrationChallenge).filter(
            CustomerRegistrationChallenge.restaurante_id == restaurante_id,
            CustomerRegistrationChallenge.email == email,
        ).with_for_update().first()
        if challenge is not None:
            last_send = challenge.ultimo_envio_em
            if last_send.tzinfo is None:
                last_send = last_send.replace(tzinfo=datetime.timezone.utc)
            elapsed = (now - last_send).total_seconds()
            if elapsed < settings.CUSTOMER_EMAIL_RESEND_SECONDS:
                db.rollback()
                return {
                    "detail": "E-mail já solicitado. Aguarde antes de reenviar.",
                    "retry_after_seconds": int(settings.CUSTOMER_EMAIL_RESEND_SECONDS - elapsed) + 1,
                }

        token = generate_customer_registration_token(restaurante_id)
        token_hash = hash_customer_registration_token(restaurante_id, token)
        expires_at = now + datetime.timedelta(
            seconds=settings.CUSTOMER_EMAIL_VERIFICATION_TTL_SECONDS
        )
        password_hash = get_password_hash(payload.senha)

        if challenge is None:
            import uuid
            challenge = CustomerRegistrationChallenge(
                id=str(uuid.uuid4()),
                restaurante_id=restaurante_id,
                nome=nome,
                email=email,
                telefone=telefone,
                endereco=(payload.endereco or "").strip() or None,
                senha_hash=password_hash,
                token_hash=token_hash,
                expira_em=expires_at,
                criado_em=now,
                ultimo_envio_em=now,
                email_verificado_em=None,
            )
            db.add(challenge)
        else:
            challenge.nome = nome
            challenge.telefone = telefone
            challenge.endereco = (payload.endereco or "").strip() or None
            challenge.senha_hash = password_hash
            challenge.token_hash = token_hash
            challenge.expira_em = expires_at
            challenge.ultimo_envio_em = now
            challenge.email_verificado_em = None

        db.flush([challenge])
        from ..models import Restaurante
        restaurante = db.query(Restaurante).filter(Restaurante.id == restaurante_id).first()
        sent = send_registration_email(
            email,
            name=nome,
            token=token,
            restaurant_name=restaurante.nome if restaurante else "KÔMA",
            idempotency_key=f"customer-registration:{challenge.id}:{token_hash[:24]}",
        )
        if not sent:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Não foi possível enviar o e-mail de confirmação agora. Tente novamente em instantes.",
            )
        db.commit()
        return {
            "detail": "Enviamos um link de confirmação para seu e-mail.",
            "expires_in_seconds": settings.CUSTOMER_EMAIL_VERIFICATION_TTL_SECONDS,
        }


@router.post("/cadastro/confirmar")
def confirm_customer_registration(
    payload: CustomerRegistrationConfirm,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    restaurante_id = _registration_restaurante_id(payload.token)
    with public_tenant_scope(str(restaurante_id), None, db):
        challenge = _registration_challenge(
            db,
            restaurante_id=restaurante_id,
            token=payload.token,
            lock=True,
        )
        now = _utcnow()

        existing_email = db.query(Cliente).filter(
            Cliente.restaurante_id == restaurante_id,
            Cliente.email == challenge.email,
            Cliente.senha_hash.isnot(None),
        ).first()
        if existing_email is not None:
            db.delete(challenge)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Esta conta já foi criada. Faça login.",
            )

        existing_phone = db.query(Cliente).filter(
            Cliente.restaurante_id == restaurante_id,
            Cliente.telefone == challenge.telefone,
        ).with_for_update().first()

        if existing_phone is not None:
            if existing_phone.senha_hash:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Este telefone já possui uma conta neste restaurante.",
                )
            challenge.email_verificado_em = challenge.email_verificado_em or now
            db.commit()
            return {
                "status": "phone_verification_required",
                "restaurante_id": restaurante_id,
                "detail": (
                    "Seu e-mail foi confirmado. Como este telefone já possui histórico no restaurante, "
                    "confirme também o número para vincular a conta com segurança."
                ),
            }

        import uuid
        cliente = Cliente(
            id=str(uuid.uuid4()),
            restaurante_id=restaurante_id,
            telefone=challenge.telefone,
            nome=challenge.nome,
            endereco=challenge.endereco,
            email=challenge.email,
            senha_hash=challenge.senha_hash,
            email_verificado_em=now,
            telefone_verificado_em=None,
            saldo_pontos=0,
            saldo_cashback=0.0,
        )
        db.add(cliente)
        db.delete(challenge)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="O cadastro entrou em conflito com outra operação. Abra novamente o link de confirmação.",
            ) from None
        db.refresh(cliente)
        access_token = create_customer_access_token(
            cliente_id=cliente.id,
            restaurante_id=restaurante_id,
        )
        background_tasks.add_task(
            manager.broadcast,
            {
                "event": "customers_updated",
                "detail": {"action": "created", "cliente_id": cliente.id},
            },
            restaurante_id,
            target_audience="internal",
        )
        return {
            "access_token": access_token,
            "token_type": "customer",
            "restaurante_id": restaurante_id,
            "cliente": _profile(cliente).model_dump(),
        }


@router.post(
    "/cadastro/telefone/solicitar",
    status_code=status.HTTP_202_ACCEPTED,
)
def request_registration_phone_verification(
    payload: CustomerRegistrationConfirm,
    request: Request,
    db: Session = Depends(get_db),
):
    if not getattr(settings, "CUSTOMER_PHONE_VERIFICATION_ENABLED", False):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="A confirmação deste telefone está indisponível no momento.",
        )

    restaurante_id = _registration_restaurante_id(payload.token)
    with public_tenant_scope(str(restaurante_id), None, db):
        challenge = _registration_challenge(
            db,
            restaurante_id=restaurante_id,
            token=payload.token,
        )
        if challenge.email_verificado_em is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Confirme primeiro o e-mail enviado pelo KÔMA.",
            )
        guest = db.query(Cliente).filter(
            Cliente.restaurante_id == restaurante_id,
            Cliente.telefone == challenge.telefone,
            Cliente.senha_hash.is_(None),
        ).first()
        if guest is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Não há uma ficha de visitante disponível para vinculação.",
            )

        now = _utcnow()
        _consume_rate_limit(
            db,
            restaurante_id=restaurante_id,
            scope="customer_registration_phone_otp_ip",
            raw_key=_client_ip(request),
            max_requests=settings.CUSTOMER_OTP_MAX_IP_REQUESTS,
            window_seconds=settings.CUSTOMER_OTP_WINDOW_SECONDS,
        )

        telefone_hash = hash_phone_for_otp(restaurante_id, challenge.telefone)
        otp = db.query(OtpChallenge).filter(
            OtpChallenge.restaurante_id == restaurante_id,
            OtpChallenge.telefone_hash == telefone_hash,
        ).with_for_update().first()
        if otp is not None:
            last_send = otp.ultimo_envio_em
            if last_send.tzinfo is None:
                last_send = last_send.replace(tzinfo=datetime.timezone.utc)
            elapsed = (now - last_send).total_seconds()
            if elapsed < settings.CUSTOMER_OTP_RESEND_SECONDS:
                db.commit()
                return {
                    "detail": "Código já solicitado. Aguarde antes de reenviar.",
                    "retry_after_seconds": int(settings.CUSTOMER_OTP_RESEND_SECONDS - elapsed) + 1,
                }
            window_start = otp.janela_iniciada_em
            if window_start.tzinfo is None:
                window_start = window_start.replace(tzinfo=datetime.timezone.utc)
            if now - window_start >= datetime.timedelta(
                seconds=max(60, settings.CUSTOMER_OTP_WINDOW_SECONDS)
            ):
                otp.janela_iniciada_em = now
                otp.envios_na_janela = 0
            if int(otp.envios_na_janela or 0) >= max(1, settings.CUSTOMER_OTP_MAX_SENDS):
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Muitas solicitações. Aguarde alguns minutos e tente novamente.",
                )

        codigo = generate_otp()
        codigo_hash = hash_otp(restaurante_id, challenge.telefone, codigo)
        expires_at = now + datetime.timedelta(seconds=max(60, settings.CUSTOMER_OTP_TTL_SECONDS))
        if otp is None:
            otp = OtpChallenge(
                restaurante_id=restaurante_id,
                telefone_hash=telefone_hash,
                otp_hash=codigo_hash,
                expira_em=expires_at,
                tentativas=0,
                ultimo_envio_em=now,
                janela_iniciada_em=now,
                envios_na_janela=1,
            )
            db.add(otp)
        else:
            otp.otp_hash = codigo_hash
            otp.expira_em = expires_at
            otp.tentativas = 0
            otp.ultimo_envio_em = now
            otp.envios_na_janela = int(otp.envios_na_janela or 0) + 1

        db.flush([otp])
        from ..models import Restaurante
        restaurante = db.query(Restaurante).filter(Restaurante.id == restaurante_id).first()
        try:
            sent = enviar_codigo_otp_whatsapp(
                challenge.telefone,
                codigo,
                restaurante.nome if restaurante else "KÔMA",
                customer_verification=True,
            )
        except TypeError:
            sent = enviar_codigo_otp_whatsapp(challenge.telefone, codigo)
        if not sent:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Não foi possível enviar o código agora. Tente novamente em instantes.",
            )
        db.commit()
        return {"detail": "Código enviado ao WhatsApp informado."}


@router.post("/cadastro/telefone/confirmar")
def confirm_registration_phone(
    payload: CustomerRegistrationPhoneConfirm,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    restaurante_id = _registration_restaurante_id(payload.token)
    with public_tenant_scope(str(restaurante_id), None, db):
        _consume_rate_limit(
            db,
            restaurante_id=restaurante_id,
            scope="customer_registration_phone_verify_ip",
            raw_key=_client_ip(request),
            max_requests=max(10, settings.CUSTOMER_OTP_MAX_IP_REQUESTS * 2),
            window_seconds=settings.CUSTOMER_OTP_WINDOW_SECONDS,
        )
        challenge = _registration_challenge(
            db,
            restaurante_id=restaurante_id,
            token=payload.token,
            lock=True,
        )
        if challenge.email_verificado_em is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Confirme primeiro o e-mail enviado pelo KÔMA.",
            )
        otp = _consume_otp_challenge(
            db,
            restaurante_id=restaurante_id,
            telefone=challenge.telefone,
            codigo=payload.codigo,
        )
        cliente = db.query(Cliente).filter(
            Cliente.restaurante_id == restaurante_id,
            Cliente.telefone == challenge.telefone,
        ).with_for_update().first()
        if cliente is None or cliente.senha_hash:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Esta ficha de cliente não está mais disponível para vinculação.",
            )

        cliente.nome = challenge.nome
        cliente.email = challenge.email
        cliente.senha_hash = challenge.senha_hash
        cliente.endereco = challenge.endereco or cliente.endereco
        cliente.email_verificado_em = challenge.email_verificado_em
        cliente.telefone_verificado_em = _utcnow()
        db.delete(otp)
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
                "detail": {"action": "updated", "cliente_id": cliente.id},
            },
            restaurante_id,
            target_audience="internal",
        )
        return {
            "access_token": access_token,
            "token_type": "customer",
            "restaurante_id": restaurante_id,
            "cliente": _profile(cliente).model_dump(),
        }


@router.post(
    "/cadastro",
    response_model=CustomerSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
def register_customer(
    payload: CustomerRegisterRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    with public_tenant_scope(str(payload.restaurante_id), None, db) as restaurante_id:
        try:
            telefone_normalizado = normalizar_telefone_cliente(payload.telefone)
            nome_normalizado = normalizar_nome_cliente(payload.nome)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

        email_normalizado = payload.email.strip().lower()
        if len(payload.senha) < 8:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A senha deve conter no mínimo 8 caracteres.",
            )
        if len(payload.senha) > 128:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A senha deve conter no máximo 128 caracteres.",
            )

        # Rate limits persistidos por IP, por e-mail e por telefone
        _consume_rate_limit(
            db,
            restaurante_id=restaurante_id,
            scope="customer_register_ip",
            raw_key=_client_ip(request),
            max_requests=20,
            window_seconds=settings.CUSTOMER_OTP_WINDOW_SECONDS,
            detail="Muitas tentativas de cadastro a partir deste IP. Tente novamente mais tarde.",
        )
        db.commit()

        _consume_rate_limit(
            db,
            restaurante_id=restaurante_id,
            scope="customer_register_account",
            raw_key=email_normalizado,
            max_requests=5,
            window_seconds=settings.CUSTOMER_OTP_WINDOW_SECONDS,
            detail="Muitas tentativas de cadastro para este e-mail. Tente novamente mais tarde.",
        )
        db.commit()

        _consume_rate_limit(
            db,
            restaurante_id=restaurante_id,
            scope="customer_register_phone",
            raw_key=telefone_normalizado,
            max_requests=5,
            window_seconds=settings.CUSTOMER_OTP_WINDOW_SECONDS,
            detail="Muitas tentativas de cadastro para este telefone. Tente novamente mais tarde.",
        )
        db.commit()

        # 1. Verificar se já existe cliente com este e-mail neste restaurante
        cliente_por_email = db.query(Cliente).filter(
            Cliente.restaurante_id == restaurante_id,
            Cliente.email == email_normalizado,
        ).first()

        if cliente_por_email is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Já existe uma conta com este e-mail neste restaurante. Faça login.",
            )

        challenge = _consume_otp_challenge(
            db,
            restaurante_id=restaurante_id,
            telefone=telefone_normalizado,
            codigo=payload.codigo,
        )

        # Com o telefone confirmado, o cadastro pode adotar com segurança a ficha
        # criada anteriormente pelo Caixa e manter histórico, pontos e cashback.
        cliente_por_tel = db.query(Cliente).filter(
            Cliente.restaurante_id == restaurante_id,
            Cliente.telefone == telefone_normalizado,
        ).with_for_update().first()

        if cliente_por_tel is not None and (cliente_por_tel.email or cliente_por_tel.senha_hash):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Este telefone já possui uma conta neste restaurante. Faça login.",
            )

        import uuid
        senha_hasheada = get_password_hash(payload.senha)
        created = cliente_por_tel is None
        cliente = cliente_por_tel or Cliente(
            id=str(uuid.uuid4()), restaurante_id=restaurante_id,
            telefone=telefone_normalizado, saldo_pontos=0, saldo_cashback=0.0,
        )
        cliente.nome = nome_normalizado
        cliente.email = email_normalizado
        cliente.senha_hash = senha_hasheada
        cliente.endereco = (payload.endereco or "").strip() or cliente.endereco
        cliente.telefone_verificado_em = _utcnow()
        if created:
            db.add(cliente)
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


@router.post(
    "/login",
    response_model=CustomerSessionResponse,
)
def login_customer(
    payload: CustomerLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    with public_tenant_scope(str(payload.restaurante_id), None, db) as restaurante_id:
        email_normalizado = payload.email.strip().lower()

        # Rate limits persistidos por IP e por conta (e-mail)
        _consume_rate_limit(
            db,
            restaurante_id=restaurante_id,
            scope="customer_login_ip",
            raw_key=_client_ip(request),
            max_requests=30,
            window_seconds=settings.CUSTOMER_OTP_WINDOW_SECONDS,
            detail="Muitas tentativas de login a partir deste IP. Tente novamente mais tarde.",
        )
        db.commit()

        _consume_rate_limit(
            db,
            restaurante_id=restaurante_id,
            scope="customer_login_account",
            raw_key=email_normalizado,
            max_requests=5,
            window_seconds=settings.CUSTOMER_OTP_WINDOW_SECONDS,
            detail="Muitas tentativas de login para este e-mail. Tente novamente mais tarde.",
        )
        db.commit()

        cliente = db.query(Cliente).filter(
            Cliente.restaurante_id == restaurante_id,
            Cliente.email == email_normalizado,
        ).first()

        if cliente is None or not cliente.senha_hash:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="E-mail ou senha incorretos.",
            )

        if not verify_password(payload.senha, cliente.senha_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="E-mail ou senha incorretos.",
            )

        access_token = create_customer_access_token(
            cliente_id=cliente.id,
            restaurante_id=restaurante_id,
        )
        return CustomerSessionResponse(
            access_token=access_token,
            cliente=_profile(cliente),
        )


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

        challenge = _consume_otp_challenge(
            db,
            restaurante_id=restaurante_id,
            telefone=payload.telefone,
            codigo=payload.codigo,
        )

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
        cliente.telefone_verificado_em = _utcnow()
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
