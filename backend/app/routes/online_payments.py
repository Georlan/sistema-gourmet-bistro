from __future__ import annotations

import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db, tenant_session_scope
from ..models import OnlinePaymentWebhookEvent, RestaurantPaymentAccount
from ..services.online_payments import OnlinePaymentService, OnlinePaymentValidationError
from ..services.online_payments.signature import verify_mercado_pago_signature
from ..websocket_manager import manager


router = APIRouter(prefix="/payments", tags=["Pagamentos online"])


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


@router.post("/webhooks/mercado-pago/{account_id}")
async def mercado_pago_webhook(
    account_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    payload = await request.json()
    body_data = payload.get("data") if isinstance(payload, dict) else None
    body_payment_id = str(body_data.get("id") or "") if isinstance(body_data, dict) else ""
    query_payment_id = str(request.query_params.get("data.id") or "")
    payment_id = query_payment_id or body_payment_id
    if not payment_id or (query_payment_id and body_payment_id and query_payment_id != body_payment_id):
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
