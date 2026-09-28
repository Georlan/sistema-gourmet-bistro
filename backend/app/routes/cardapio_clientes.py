"""Verified customer identity for the public digital menu."""
from __future__ import annotations

import datetime
import logging
import uuid
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
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db, tenant_session_scope
from ..models import (
    Cliente,
    CustomerRegistrationChallenge,
    OtpChallenge,
    PublicRateLimit,
    Restaurante,
)
from ..schemas import (
    CustomerEmailRegistrationRequest,
    CustomerLoginRequest,
    CustomerOtpRequest,
    CustomerOtpVerify,
    CustomerProfileResponse,
    CustomerProfileUpdate,
    CustomerRegisterRequest,
    CustomerRegistrationPhoneConfirmRequest,
    CustomerRegistrationSessionResponse,
    CustomerRegistrationTokenRequest,
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
    generate_otp,
    hash_otp,
    hash_phone_for_otp,
    hash_public_rate_key,
    otp_matches,
)
from ..services.customer_registration import (
    decode_registration_token,
    hash_registration_token,
    issue_registration_token,
    registration_available,
    registration_token_matches,
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
_GENERIC_REGISTRATION_ERROR = (
    "Link de confirmação inválido ou expirado. Solicite um novo e-mail."
)


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


def _aware_datetime(value: datetime.datetime) -> datetime.datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=datetime.timezone.utc)
    return value.astimezone(datetime.timezone.utc)


def _issue_customer_phone_otp(
    db: Session,
    *,
    request: Request,
    restaurante_id: int,
    telefone: str,
) -> dict[str, object]:
    """Emite OTP telefônico somente para fluxos que realmente exigem posse do número."""
    if not getattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", False):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Autenticação por WhatsApp indisponível no momento.",
        )

    now = _utcnow()
    _consume_rate_limit(
        db,
        restaurante_id=restaurante_id,
        scope="customer_otp_request_ip",
        raw_key=_client_ip(request),
        max_requests=settings.CUSTOMER_OTP_MAX_IP_REQUESTS,
        window_seconds=settings.CUSTOMER_OTP_WINDOW_SECONDS,
    )

    telefone_hash = hash_phone_for_otp(restaurante_id, telefone)
    challenge = db.query(OtpChallenge).filter(
        OtpChallenge.restaurante_id == restaurante_id,
        OtpChallenge.telefone_hash == telefone_hash,
    ).with_for_update().first()

    if challenge is not None:
        last_send = _aware_datetime(challenge.ultimo_envio_em)
        retry_after = max(1, settings.CUSTOMER_OTP_RESEND_SECONDS)
        elapsed = (now - last_send).total_seconds()
        if elapsed < retry_after:
            db.commit()
            return {
                "detail": "Código já solicitado. Aguarde antes de reenviar.",
                "retry_after_seconds": int(retry_after - elapsed) + 1,
            }

        window_start = _aware_datetime(challenge.janela_iniciada_em)
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
    codigo_hash = hash_otp(restaurante_id, telefone, codigo)
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
    restaurante = db.query(Restaurante).filter(
        Restaurante.id == restaurante_id,
    ).first()
    nome_rest = restaurante.nome if restaurante and restaurante.nome else "Kôma"

    try:
        sent_ok = enviar_codigo_otp_whatsapp(telefone, codigo, nome_rest)
    except TypeError:
        sent_ok = enviar_codigo_otp_whatsapp(telefone, codigo)

    if not sent_ok:
        db.query(OtpChallenge).filter(
            OtpChallenge.restaurante_id == restaurante_id,
            OtpChallenge.id == challenge_id,
            OtpChallenge.otp_hash == codigo_hash,
        ).delete(synchronize_session=False)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Não foi possível enviar o código agora. Tente novamente em instantes.",
        )

    return {
        "detail": "Código enviado ao WhatsApp informado.",
        "expires_in_seconds": max(60, settings.CUSTOMER_OTP_TTL_SECONDS),
    }


def _load_registration_challenge(
    db: Session,
    *,
    restaurante_id: int,
    registration_id: str,
    raw_token: str,
    for_update: bool = False,
    require_email_verified: bool = False,
) -> CustomerRegistrationChallenge:
    query = db.query(CustomerRegistrationChallenge).filter(
        CustomerRegistrationChallenge.restaurante_id == restaurante_id,
        CustomerRegistrationChallenge.id == registration_id,
    )
    if for_update:
        query = query.with_for_update()
    challenge = query.first()
    now = _utcnow()
    if (
        challenge is None
        or not registration_token_matches(
            restaurante_id,
            raw_token,
            challenge.token_hash if challenge else "",
        )
    ):
        raise HTTPException(status_code=400, detail=_GENERIC_REGISTRATION_ERROR)
    if _aware_datetime(challenge.expira_em) <= now:
        db.delete(challenge)
        db.commit()
        raise HTTPException(status_code=400, detail=_GENERIC_REGISTRATION_ERROR)
    if require_email_verified and challenge.email_verificado_em is None:
        raise HTTPException(status_code=400, detail=_GENERIC_REGISTRATION_ERROR)
    return challenge


def _registration_session_response(
    cliente: Cliente,
    *,
    restaurante_id: int,
) -> CustomerRegistrationSessionResponse:
    return CustomerRegistrationSessionResponse(
        access_token=create_customer_access_token(
            cliente_id=cliente.id,
            restaurante_id=restaurante_id,
        ),
        restaurante_id=restaurante_id,
        cliente=_profile(cliente),
    )


def _customer_update_broadcast(
    background_tasks: BackgroundTasks,
    *,
    restaurante_id: int,
    cliente_id: str,
    action: str,
) -> None:
    background_tasks.add_task(
        manager.broadcast,
        {
            "event": "customers_updated",
            "detail": {"action": action, "cliente_id": cliente_id},
        },
        restaurante_id,
        target_audience="internal",
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


@router.post("/cadastro/solicitar", status_code=status.HTTP_202_ACCEPTED)
def request_customer_email_registration(
    payload: CustomerEmailRegistrationRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Inicia cadastro por e-mail sem provar ou reivindicar o telefone informado."""
    if not registration_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cadastro por e-mail indisponível no momento. Tente novamente mais tarde.",
        )

    with public_tenant_scope(str(payload.restaurante_id), None, db) as restaurante_id:
        now = _utcnow()
        email = payload.email.strip().lower()
        telefone = normalizar_telefone_cliente(payload.telefone)
        nome = normalizar_nome_cliente(payload.nome)

        _consume_rate_limit(
            db,
            restaurante_id=restaurante_id,
            scope="customer_email_registration_ip",
            raw_key=_client_ip(request),
            max_requests=settings.CUSTOMER_EMAIL_MAX_IP_REQUESTS,
            window_seconds=settings.CUSTOMER_OTP_WINDOW_SECONDS,
            detail="Muitas tentativas de cadastro a partir deste IP. Tente novamente mais tarde.",
        )
        db.commit()
        _consume_rate_limit(
            db,
            restaurante_id=restaurante_id,
            scope="customer_email_registration_email",
            raw_key=email,
            max_requests=settings.CUSTOMER_EMAIL_MAX_SENDS,
            window_seconds=settings.CUSTOMER_OTP_WINDOW_SECONDS,
            detail="Muitas solicitações para este e-mail. Aguarde alguns minutos e tente novamente.",
        )
        db.commit()
        _consume_rate_limit(
            db,
            restaurante_id=restaurante_id,
            scope="customer_email_registration_phone",
            raw_key=telefone,
            max_requests=settings.CUSTOMER_EMAIL_MAX_SENDS,
            window_seconds=settings.CUSTOMER_OTP_WINDOW_SECONDS,
            detail="Muitas solicitações para este telefone. Aguarde alguns minutos e tente novamente.",
        )
        db.commit()

        existing_account = db.query(Cliente).filter(
            Cliente.restaurante_id == restaurante_id,
            Cliente.email == email,
        ).first()
        if existing_account is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Já existe uma conta com este e-mail neste restaurante. Faça login.",
            )

        challenge = db.query(CustomerRegistrationChallenge).filter(
            CustomerRegistrationChallenge.restaurante_id == restaurante_id,
            CustomerRegistrationChallenge.email == email,
        ).with_for_update().first()

        if challenge is not None and challenge.ultimo_envio_em is not None:
            elapsed = (
                now - _aware_datetime(challenge.ultimo_envio_em)
            ).total_seconds()
            retry_after = max(1, settings.CUSTOMER_EMAIL_RESEND_SECONDS)
            if elapsed < retry_after:
                db.commit()
                return {
                    "detail": "O e-mail de confirmação já foi enviado. Aguarde antes de reenviar.",
                    "retry_after_seconds": int(retry_after - elapsed) + 1,
                    "expires_in_seconds": max(
                        60,
                        settings.CUSTOMER_EMAIL_VERIFICATION_TTL_SECONDS,
                    ),
                }

        if challenge is not None:
            window_start = _aware_datetime(challenge.janela_iniciada_em)
            if now - window_start >= datetime.timedelta(
                seconds=max(60, settings.CUSTOMER_OTP_WINDOW_SECONDS)
            ):
                challenge.janela_iniciada_em = now
                challenge.envios_na_janela = 0
            if int(challenge.envios_na_janela or 0) >= max(
                1,
                settings.CUSTOMER_EMAIL_MAX_SENDS,
            ):
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Muitas solicitações. Aguarde alguns minutos e tente novamente.",
                )
        else:
            challenge = CustomerRegistrationChallenge(
                id=str(uuid.uuid4()),
                restaurante_id=restaurante_id,
                nome=nome,
                email=email,
                telefone=telefone,
                endereco=(payload.endereco or "").strip() or None,
                senha_hash=get_password_hash(payload.senha),
                token_hash="pending",
                expira_em=now,
                ultimo_envio_em=None,
                janela_iniciada_em=now,
                envios_na_janela=0,
                criado_em=now,
            )
            db.add(challenge)

        challenge.nome = nome
        challenge.telefone = telefone
        challenge.endereco = (payload.endereco or "").strip() or None
        challenge.senha_hash = get_password_hash(payload.senha)
        challenge.email_verificado_em = None
        token = issue_registration_token(
            restaurante_id=restaurante_id,
            registration_id=challenge.id,
        )
        challenge.token_hash = hash_registration_token(restaurante_id, token)
        challenge.expira_em = now + datetime.timedelta(
            seconds=max(60, settings.CUSTOMER_EMAIL_VERIFICATION_TTL_SECONDS)
        )
        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Já existe uma solicitação de cadastro em andamento. Tente novamente.",
            ) from exc

        restaurante = db.query(Restaurante).filter(
            Restaurante.id == restaurante_id,
        ).first()
        restaurant_name = restaurante.nome if restaurante and restaurante.nome else "KÔMA"
        delivery_id = (
            f"customer-registration:{challenge.id}:"
            f"{int(challenge.envios_na_janela or 0) + 1}"
        )
        if not send_registration_email(
            email,
            token,
            restaurant_name,
            delivery_id=delivery_id,
        ):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Não foi possível enviar o e-mail de confirmação agora. "
                    "Tente novamente em instantes."
                ),
            )

        challenge.ultimo_envio_em = now
        challenge.envios_na_janela = int(challenge.envios_na_janela or 0) + 1
        db.commit()
        return {
            "detail": "Enviamos um link de confirmação para seu e-mail.",
            "expires_in_seconds": max(
                60,
                settings.CUSTOMER_EMAIL_VERIFICATION_TTL_SECONDS,
            ),
            "retry_after_seconds": max(1, settings.CUSTOMER_EMAIL_RESEND_SECONDS),
        }


@router.post(
    "/cadastro/confirmar",
    response_model=CustomerRegistrationSessionResponse,
)
def confirm_customer_email_registration(
    payload: CustomerRegistrationTokenRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Confirma o e-mail; telefone guest preexistente exige uma segunda prova."""
    try:
        restaurante_id, registration_id = decode_registration_token(payload.token)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_GENERIC_REGISTRATION_ERROR,
        ) from exc

    with public_tenant_scope(str(restaurante_id), None, db) as scoped_restaurante_id:
        _consume_rate_limit(
            db,
            restaurante_id=scoped_restaurante_id,
            scope="customer_email_registration_confirm_ip",
            raw_key=_client_ip(request),
            max_requests=max(20, settings.CUSTOMER_EMAIL_MAX_IP_REQUESTS * 2),
            window_seconds=settings.CUSTOMER_OTP_WINDOW_SECONDS,
            detail="Muitas tentativas de confirmação. Tente novamente mais tarde.",
        )
        db.commit()
        challenge = _load_registration_challenge(
            db,
            restaurante_id=scoped_restaurante_id,
            registration_id=registration_id,
            raw_token=payload.token,
            for_update=True,
        )
        now = _utcnow()

        account_by_email = db.query(Cliente).filter(
            Cliente.restaurante_id == scoped_restaurante_id,
            Cliente.email == challenge.email,
        ).with_for_update().first()
        if account_by_email is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Já existe uma conta com este e-mail neste restaurante. Faça login.",
            )

        cliente_por_telefone = db.query(Cliente).filter(
            Cliente.restaurante_id == scoped_restaurante_id,
            Cliente.telefone == challenge.telefone,
        ).with_for_update().first()

        if cliente_por_telefone is not None:
            if cliente_por_telefone.email or cliente_por_telefone.senha_hash:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Este telefone já está associado a outra conta neste restaurante.",
                )
            challenge.email_verificado_em = challenge.email_verificado_em or now
            db.commit()
            return JSONResponse(
                status_code=status.HTTP_409_CONFLICT,
                content={
                    "code": "phone_verification_required",
                    "detail": (
                        "E-mail confirmado. Para proteger seu histórico, pontos e cashback, "
                        "confirme também a posse do telefone já cadastrado neste restaurante."
                    ),
                },
            )

        cliente = Cliente(
            id=str(uuid.uuid4()),
            restaurante_id=scoped_restaurante_id,
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
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Os dados do cadastro entraram em conflito com outra conta. "
                    "Revise e tente novamente."
                ),
            ) from exc
        db.refresh(cliente)
        _customer_update_broadcast(
            background_tasks,
            restaurante_id=scoped_restaurante_id,
            cliente_id=cliente.id,
            action="created",
        )
        return _registration_session_response(
            cliente,
            restaurante_id=scoped_restaurante_id,
        )


@router.post(
    "/cadastro/telefone/solicitar",
    status_code=status.HTTP_202_ACCEPTED,
)
def request_registration_phone_verification(
    payload: CustomerRegistrationTokenRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Só entra no WhatsApp quando há uma ficha guest anterior a proteger."""
    try:
        restaurante_id, registration_id = decode_registration_token(payload.token)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_GENERIC_REGISTRATION_ERROR,
        ) from exc

    with public_tenant_scope(str(restaurante_id), None, db) as scoped_restaurante_id:
        challenge = _load_registration_challenge(
            db,
            restaurante_id=scoped_restaurante_id,
            registration_id=registration_id,
            raw_token=payload.token,
            for_update=True,
            require_email_verified=True,
        )
        guest = db.query(Cliente).filter(
            Cliente.restaurante_id == scoped_restaurante_id,
            Cliente.telefone == challenge.telefone,
        ).with_for_update().first()
        if guest is None or guest.email or guest.senha_hash:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Não há uma ficha de visitante segura para vincular com este telefone.",
            )
        return _issue_customer_phone_otp(
            db,
            request=request,
            restaurante_id=scoped_restaurante_id,
            telefone=challenge.telefone,
        )


@router.post(
    "/cadastro/telefone/confirmar",
    response_model=CustomerRegistrationSessionResponse,
)
def confirm_registration_phone_verification(
    payload: CustomerRegistrationPhoneConfirmRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Adota a ficha guest somente depois de e-mail e telefone comprovados."""
    try:
        restaurante_id, registration_id = decode_registration_token(payload.token)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_GENERIC_REGISTRATION_ERROR,
        ) from exc

    with public_tenant_scope(str(restaurante_id), None, db) as scoped_restaurante_id:
        _consume_rate_limit(
            db,
            restaurante_id=scoped_restaurante_id,
            scope="customer_registration_phone_confirm_ip",
            raw_key=_client_ip(request),
            max_requests=max(10, settings.CUSTOMER_OTP_MAX_IP_REQUESTS * 2),
            window_seconds=settings.CUSTOMER_OTP_WINDOW_SECONDS,
        )
        challenge = _load_registration_challenge(
            db,
            restaurante_id=scoped_restaurante_id,
            registration_id=registration_id,
            raw_token=payload.token,
            for_update=True,
            require_email_verified=True,
        )
        otp_challenge = _consume_otp_challenge(
            db,
            restaurante_id=scoped_restaurante_id,
            telefone=challenge.telefone,
            codigo=payload.codigo,
        )
        guest = db.query(Cliente).filter(
            Cliente.restaurante_id == scoped_restaurante_id,
            Cliente.telefone == challenge.telefone,
        ).with_for_update().first()
        if guest is None or guest.email or guest.senha_hash:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Este telefone não pode mais ser vinculado a esta solicitação.",
            )

        now = _utcnow()
        guest.nome = challenge.nome
        guest.endereco = challenge.endereco or guest.endereco
        guest.email = challenge.email
        guest.senha_hash = challenge.senha_hash
        guest.email_verificado_em = challenge.email_verificado_em or now
        guest.telefone_verificado_em = now
        db.delete(otp_challenge)
        db.delete(challenge)
        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Os dados do cadastro entraram em conflito com outra conta. "
                    "Revise e tente novamente."
                ),
            ) from exc
        db.refresh(guest)
        _customer_update_broadcast(
            background_tasks,
            restaurante_id=scoped_restaurante_id,
            cliente_id=guest.id,
            action="updated",
        )
        return _registration_session_response(
            guest,
            restaurante_id=scoped_restaurante_id,
        )


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
    with public_tenant_scope(str(payload.restaurante_id), None, db) as restaurante_id:
        return _issue_customer_phone_otp(
            db,
            request=request,
            restaurante_id=restaurante_id,
            telefone=payload.telefone,
        )


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
