from __future__ import annotations

import datetime
from urllib.parse import urlencode

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db, require_tenant_id, tenant_session_scope
from ..models import OnlinePaymentWebhookEvent, RestaurantPaymentAccount, Usuario
from ..security import ensure_permission, require_permission
from ..services.online_payments import OnlinePaymentService, OnlinePaymentValidationError
from ..services.online_payments.account_connection import (
    MercadoPagoAccountConnectionError,
    payment_account_status,
    upsert_mercado_pago_account,
)
from ..services.online_payments.oauth import (
    MercadoPagoOAuthConfigurationError,
    MercadoPagoOAuthError,
    MercadoPagoOAuthStateError,
    build_authorization_url,
    exchange_authorization_code,
)
from ..services.online_payments.signature import verify_mercado_pago_signature
from ..websocket_manager import manager


router = APIRouter(prefix="/payments", tags=["Pagamentos online"])


def _frontend_oauth_result(result: str) -> str:
    query = urlencode(
        {
            "view": "caixa",
            "tab": "cardapio_digital",
            "mercado_pago": result,
        }
    )
    return f"{settings.KOMA_PUBLIC_APP_URL}/?{query}"


def _resolve_account_tenant(db: Session, account_id: str) -> int | None:
    if db.get_bind().dialect.name == "postgresql":
        return db.execute(
            text("SELECT koma_internal.resolve_payment_account_tenant(:account_id)"),
            {"account_id": account_id},
        ).scalar_one_or_none()
    return db.execute(
        text(
            "SELECT restaurante_id FROM restaurant_payment_accounts "
            "WHERE id = :account_id AND status = 'active' LIMIT 1"
        ),
        {"account_id": account_id},
    ).scalar_one_or_none()


def _resolve_mercado_pago_account_id(
    db: Session,
    provider_user_id: str,
) -> str | None:
    normalized_user_id = str(provider_user_id or "").strip()
    if not normalized_user_id:
        return None
    if db.get_bind().dialect.name == "postgresql":
        return db.execute(
            text(
                "SELECT koma_internal.resolve_mercado_pago_account_id("
                ":provider_user_id)"
            ),
            {"provider_user_id": normalized_user_id},
        ).scalar_one_or_none()
    return db.execute(
        text(
            "SELECT id FROM restaurant_payment_accounts "
            "WHERE provider = 'mercado_pago' "
            "AND provider_user_id = :provider_user_id "
            "AND status = 'active' LIMIT 1"
        ),
        {"provider_user_id": normalized_user_id},
    ).scalar_one_or_none()


def _resolve_mercado_pago_account_id_by_payment(
    db: Session,
    external_payment_id: str,
) -> str | None:
    payment_id = str(external_payment_id or "").strip()
    if not payment_id:
        return None
    if db.get_bind().dialect.name == "postgresql":
        return db.execute(
            text(
                "SELECT koma_internal.resolve_mercado_pago_account_id_by_payment("
                ":payment_id)"
            ),
            {"payment_id": payment_id},
        ).scalar_one_or_none()
    return db.execute(
        text(
            "SELECT a.id FROM online_payment_intents AS i "
            "JOIN restaurant_payment_accounts AS a "
            "ON a.restaurante_id = i.restaurante_id "
            "AND a.provider = 'mercado_pago' AND a.status = 'active' "
            "WHERE i.provider = 'mercado_pago' "
            "AND i.external_payment_id = :payment_id LIMIT 1"
        ),
        {"payment_id": payment_id},
    ).scalar_one_or_none()


def _mercado_pago_webhook_provider_user_id(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    raw_user_id = payload.get("user_id")
    if raw_user_id is None:
        return ""
    return str(raw_user_id).strip()


def _mercado_pago_webhook_payment_id(payload: object, request: Request) -> str:
    body_data = payload.get("data") if isinstance(payload, dict) else None
    body_payment_id = str(body_data.get("id") or "") if isinstance(body_data, dict) else ""
    query_payment_id = str(request.query_params.get("data.id") or "")
    if query_payment_id and body_payment_id and query_payment_id != body_payment_id:
        return ""
    return query_payment_id or body_payment_id


@router.get("/mercado-pago/status")
def mercado_pago_connection_status(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("configuracoes:administrar")),
):
    rest_id = require_tenant_id()
    account = (
        db.query(RestaurantPaymentAccount)
        .filter(
            RestaurantPaymentAccount.restaurante_id == rest_id,
            RestaurantPaymentAccount.provider == "mercado_pago",
        )
        .first()
    )
    return payment_account_status(account)


@router.get("/mercado-pago/connect")
def mercado_pago_connect(
    current_user: Usuario = Depends(require_permission("configuracoes:administrar")),
):
    rest_id = require_tenant_id()
    try:
        authorization_url = build_authorization_url(
            restaurant_id=rest_id,
            user_id=current_user.id,
        )
    except MercadoPagoOAuthConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    return {"authorization_url": authorization_url}


@router.get("/mercado-pago/oauth/callback")
def mercado_pago_oauth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    if error:
        return RedirectResponse(
            url=_frontend_oauth_result("cancelled"),
            status_code=status.HTTP_303_SEE_OTHER,
        )
    if not code or not state:
        raise HTTPException(status_code=400, detail="Retorno OAuth incompleto.")

    try:
        oauth_state, tokens = exchange_authorization_code(code=code, state=state)
    except MercadoPagoOAuthStateError as exc:
        raise HTTPException(status_code=400, detail="Estado OAuth inválido ou expirado.") from exc
    except MercadoPagoOAuthConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except MercadoPagoOAuthError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Não foi possível concluir a autorização do Mercado Pago.",
        ) from exc

    try:
        with tenant_session_scope(db, oauth_state.restaurant_id):
            initiator = (
                db.query(Usuario)
                .filter(
                    Usuario.restaurante_id == oauth_state.restaurant_id,
                    Usuario.id == oauth_state.user_id,
                )
                .first()
            )
            if initiator is None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Usuário que iniciou a autorização não está mais disponível.",
                )
            ensure_permission(initiator, "configuracoes:administrar")

            upsert_mercado_pago_account(
                db,
                restaurant_id=oauth_state.restaurant_id,
                tokens=tokens,
            )
            db.commit()
    except MercadoPagoAccountConnectionError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Esta conta Mercado Pago já está vinculada a outro restaurante.",
        ) from exc

    return RedirectResponse(
        url=_frontend_oauth_result("connected"),
        status_code=status.HTTP_303_SEE_OTHER,
    )


@router.post("/webhooks/mercado-pago")
async def mercado_pago_application_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Recebe o Webhook fixo da aplicação e roteia pelo vendedor OAuth.

    Algumas atualizações do Mercado Pago não carregam ``user_id`` no topo. Nesses
    casos roteamos por ``data.id`` somente quando esse payment_id já pertence a
    uma intenção conhecida; a assinatura ainda é validada com o segredo da conta
    antes de qualquer reconciliação.
    """
    payload = await request.json()
    if not isinstance(payload, dict) or str(payload.get("type") or "").strip() != "payment":
        raise HTTPException(status_code=400, detail="Notificação de pagamento inválida.")

    payment_id = _mercado_pago_webhook_payment_id(payload, request)
    if not payment_id:
        raise HTTPException(status_code=400, detail="Notificação de pagamento inválida.")

    provider_user_id = _mercado_pago_webhook_provider_user_id(payload)
    account_id = (
        _resolve_mercado_pago_account_id(db, provider_user_id)
        if provider_user_id
        else None
    )
    if not account_id:
        account_id = _resolve_mercado_pago_account_id_by_payment(db, payment_id)
    if not account_id:
        # Não revelar se seller/payment existe antes de validar uma conta conhecida.
        raise HTTPException(status_code=401, detail="Assinatura de pagamento inválida.")

    return await mercado_pago_webhook(
        account_id=str(account_id),
        request=request,
        background_tasks=background_tasks,
        db=db,
    )


@router.post("/webhooks/mercado-pago/{account_id}")
async def mercado_pago_webhook(
    account_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    payload = await request.json()
    payment_id = _mercado_pago_webhook_payment_id(payload, request)
    if not payment_id:
        raise HTTPException(status_code=400, detail="Notificação de pagamento inválida.")

    rest_id = _resolve_account_tenant(db, account_id)
    if rest_id is None:
        raise HTTPException(status_code=404, detail="Conta de pagamento não encontrada.")

    with tenant_session_scope(db, int(rest_id)):
        account = db.query(RestaurantPaymentAccount).filter(
            RestaurantPaymentAccount.restaurante_id == int(rest_id),
            RestaurantPaymentAccount.id == account_id,
            RestaurantPaymentAccount.status == "active",
        ).first()
        if account is None:
            raise HTTPException(status_code=404, detail="Conta de pagamento não encontrada.")

        request_id = (request.headers.get("x-request-id") or "").strip()
        if not verify_mercado_pago_signature(
            signature_header=request.headers.get("x-signature") or "",
            request_id=request_id,
            data_id=payment_id,
            secret=account.webhook_secret,
        ):
            raise HTTPException(status_code=401, detail="Assinatura de pagamento inválida.")

        event = db.query(OnlinePaymentWebhookEvent).filter(
            OnlinePaymentWebhookEvent.restaurante_id == int(rest_id),
            OnlinePaymentWebhookEvent.provider == "mercado_pago",
            OnlinePaymentWebhookEvent.request_id == request_id,
        ).first()
        if event is not None and event.status in {"processed", "ignored"}:
            return {"status": "already_processed"}
        if event is not None and event.external_payment_id != payment_id:
            raise HTTPException(status_code=409, detail="Identificador da notificação inconsistente.")
        if event is None:
            event = OnlinePaymentWebhookEvent(
                restaurante_id=int(rest_id),
                provider="mercado_pago",
                request_id=request_id,
                external_payment_id=payment_id,
                raw_payload=payload,
            )
            db.add(event)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                event = db.query(OnlinePaymentWebhookEvent).filter(
                    OnlinePaymentWebhookEvent.restaurante_id == int(rest_id),
                    OnlinePaymentWebhookEvent.provider == "mercado_pago",
                    OnlinePaymentWebhookEvent.request_id == request_id,
                ).first()
                if event is not None and event.status in {"processed", "ignored"}:
                    return {"status": "already_processed"}
        else:
            event.status = "received"
            event.last_error = None
            event.raw_payload = payload
            db.commit()

        try:
            intent, became_approved = OnlinePaymentService.reconcile_provider_payment(
                db,
                account=account,
                external_payment_id=payment_id,
            )
            event = db.query(OnlinePaymentWebhookEvent).filter(
                OnlinePaymentWebhookEvent.restaurante_id == int(rest_id),
                OnlinePaymentWebhookEvent.id == event.id,
            ).first()
            if event:
                event.status = "processed" if intent else "ignored"
                event.processed_at = datetime.datetime.now(datetime.timezone.utc)
                db.commit()
            if became_approved and intent is not None:
                background_tasks.add_task(
                    manager.broadcast,
                    {"event": "tables_updated"},
                    int(rest_id),
                )
                background_tasks.add_task(
                    manager.broadcast,
                    {"event": "new_delivery_order", "message": "Novo pedido online pago recebido!"},
                    int(rest_id),
                )
            return {"status": "processed"}
        except OnlinePaymentValidationError as exc:
            db.rollback()
            event = db.query(OnlinePaymentWebhookEvent).filter(
                OnlinePaymentWebhookEvent.restaurante_id == int(rest_id),
                OnlinePaymentWebhookEvent.request_id == request_id,
            ).first()
            if event:
                event.status = "failed"
                event.last_error = str(exc)[:1000]
                db.commit()
            raise HTTPException(status_code=409, detail="Pagamento não corresponde ao pedido.")
        except Exception as exc:
            db.rollback()
            failed_event = db.query(OnlinePaymentWebhookEvent).filter(
                OnlinePaymentWebhookEvent.restaurante_id == int(rest_id),
                OnlinePaymentWebhookEvent.provider == "mercado_pago",
                OnlinePaymentWebhookEvent.request_id == request_id,
            ).first()
            if failed_event is not None:
                failed_event.status = "failed"
                failed_event.last_error = str(exc)[:1000]
                db.commit()
            # 5xx faz o provedor tentar novamente; o evento falho pode ser
            # reprocessado por rotina de conciliação usando o payment_id.
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Pagamento ainda não conciliado.",
            )
