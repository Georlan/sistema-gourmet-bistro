"""Per-delivery receipt codes: customer-only disclosure, locked courier verification."""
import datetime
import hmac
import secrets

from fastapi import HTTPException
from ..domain.orders.types import OrderStatus, normalize_to_order_status
from ..crypt import encrypt_field, decrypt_field


def issue_delivery_receipt(order):
    if not order.delivery_receipt_secret:
        order.delivery_receipt_secret = encrypt_field(f'{secrets.randbelow(10_000):04d}')


def customer_delivery_receipt(order):
    if order.fechada or normalize_to_order_status(order.delivery_status) in {OrderStatus.COMPLETED, OrderStatus.CANCELLED, OrderStatus.REJECTED}:
        return None
    if (order.tipo or '').strip().casefold() not in {'delivery', 'entrega'}:
        return None
    code = decrypt_field(order.delivery_receipt_secret) if order.delivery_receipt_secret else None
    return code if isinstance(code, str) and len(code) == 4 and code.isascii() and code.isdigit() else None


def verify_delivery_receipt(db, order, code):
    """Caller holds the order row lock and has checked tenant/courier assignment."""
    if not order.delivery_receipt_secret:
        return  # Existing deliveries retain their original confirmation contract.
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    retry_at = order.delivery_receipt_retry_at
    if retry_at and retry_at.replace(tzinfo=None) > now:
        seconds = max(1, int((retry_at.replace(tzinfo=None) - now).total_seconds()))
        raise HTTPException(429, 'Muitas tentativas. Aguarde um minuto para tentar novamente.', headers={'Retry-After': str(seconds)})
    if retry_at:
        order.delivery_receipt_retry_at = None
        order.delivery_receipt_failed_attempts = 0
    if not code or len(code) != 4 or not code.isascii() or not code.isdigit():
        raise HTTPException(422, 'Peça ao cliente o código de 4 dígitos da entrega.')
    if hmac.compare_digest(code, decrypt_field(order.delivery_receipt_secret)):
        order.delivery_receipt_failed_attempts = 0
        order.delivery_receipt_retry_at = None
        return
    attempts = (order.delivery_receipt_failed_attempts or 0) + 1
    order.delivery_receipt_failed_attempts = attempts
    if attempts >= 5:
        order.delivery_receipt_retry_at = now + datetime.timedelta(seconds=60)
    db.commit()  # Persist failed attempts without transitioning the order.
    if attempts >= 5:
        raise HTTPException(429, 'Muitas tentativas. Aguarde um minuto para tentar novamente.', headers={'Retry-After': '60'})
    raise HTTPException(422, 'Código incorreto. Confira os 4 dígitos com o cliente.')
