"""Local Pix initiation. Never claims to validate a bank transfer."""
from __future__ import annotations

import datetime
import re
import unicodedata
import uuid
from decimal import Decimal, ROUND_HALF_UP
from typing import TYPE_CHECKING

from fastapi import HTTPException

if TYPE_CHECKING:
    from sqlalchemy.orm import Session
    from ...models import Comanda, OnlinePaymentIntent


def normalize_key(kind: str, value: str) -> str:
    value = value.strip()
    if kind in {'cpf', 'cnpj'}:
        value = re.sub(r'[.\-/\s]', '', value)
        size = 11 if kind == 'cpf' else 14
        if not value.isascii() or not value.isdigit() or len(value) != size or len(set(value)) == 1:
            raise ValueError('CPF/CNPJ inválido.')
        digits = [int(d) for d in value]
        weights = [10,9,8,7,6,5,4,3,2] if kind == 'cpf' else [5,4,3,2,9,8,7,6,5,4,3,2]
        for step in range(2):
            current = weights if step == 0 else ([11]+weights if kind == 'cpf' else [6]+weights)
            remainder = sum(a*b for a,b in zip(digits[:size-2+step], current)) % 11
            expected = 0 if remainder < 2 else 11-remainder
            if digits[size-2+step] != expected:
                raise ValueError('CPF/CNPJ inválido.')
    elif kind == 'phone':
        value = re.sub(r'[()\s-]', '', value)
        if not re.fullmatch(r'\+[1-9][0-9]{7,14}', value):
            raise ValueError('Informe o telefone com código do país, por exemplo +5585999999999.')
    elif kind == 'email':
        value = value.lower()
        if len(value) > 77 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value) or not value.isascii():
            raise ValueError('E-mail Pix inválido.')
    elif kind == 'random':
        try:
            value = str(uuid.UUID(value))
        except ValueError as exc:
            raise ValueError('Chave aleatória inválida.') from exc
    else:
        raise ValueError('Tipo de chave Pix inválido.')
    return value


def merchant_text(value: str, limit: int) -> str:
    normalized = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode().upper()
    normalized = re.sub(r'[^A-Z0-9 $%*+\-./:]', '', normalized).strip()
    if not normalized or len(normalized) > limit:
        raise ValueError(f'Informe um nome/cidade válido de até {limit} caracteres.')
    return normalized


def tlv(tag: str, value: str) -> str:
    length = len(value.encode('utf-8'))
    if length > 99:
        raise ValueError('Campo Pix excede 99 bytes.')
    return f'{tag}{length:02d}{value}'


def crc16(value: str) -> str:
    crc = 0xFFFF
    for byte in value.encode('utf-8'):
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return f'{crc:04X}'


def brcode(*, key: str, name: str, city: str, amount: Decimal, txid: str) -> str:
    if not amount.is_finite() or amount <= 0 or amount != amount.quantize(Decimal('.01'), rounding=ROUND_HALF_UP):
        raise ValueError('Valor Pix inválido.')
    if not re.fullmatch(r'[A-Za-z0-9]{1,25}', txid):
        raise ValueError('Identificador do QR estático inválido.')
    payload = (tlv('00','01') + tlv('26',tlv('00','br.gov.bcb.pix') + tlv('01',key))
               + tlv('52','0000') + tlv('53','986') + tlv('54',f'{amount:.2f}')
               + tlv('58','BR') + tlv('59',merchant_text(name,25)) + tlv('60',merchant_text(city,15))
               + tlv('62',tlv('05',txid)) + '6304')
    return payload + crc16(payload)


def report_direct_pix_payment(
    db: Session,
    *,
    restaurant_id: int,
    comanda: Comanda,
    intent: OnlinePaymentIntent | None,
) -> OnlinePaymentIntent:
    """Registra de forma idempotente que o cliente informou o Pix realizado.

    Nunca aprova o pagamento financeiramente, não cria recibo bancário e não
    libera o pedido para produção/cozinha antes da conferência no Caixa.
    """
    from ...models import OnlinePaymentIntent as IntentModel

    if (
        intent is None
        or int(comanda.restaurante_id) != int(restaurant_id)
        or int(intent.restaurante_id) != int(restaurant_id)
        or str(intent.comanda_id) != str(comanda.id)
    ):
        raise HTTPException(status_code=404, detail="Cobrança Pix não encontrada.")

    if intent.provider != "direct_pix":
        raise HTTPException(status_code=409, detail="Este pagamento não utiliza conferência manual de Pix.")

    locked = (
        db.query(IntentModel)
        .filter(
            IntentModel.restaurante_id == int(restaurant_id),
            IntentModel.id == intent.id,
        )
        .with_for_update()
        .one_or_none()
    )
    if locked is None:
        raise HTTPException(status_code=404, detail="Cobrança Pix não encontrada.")

    if locked.status == "approved":
        return locked

    delivery_status = str(getattr(comanda, "delivery_status", "") or "").strip().lower()
    if (
        locked.status in {"cancelled", "expired", "rejected"}
        or bool(comanda.fechada)
        or delivery_status in {"cancelado", "cancelled", "recusado", "rejected", "finalizado"}
    ):
        raise HTTPException(status_code=409, detail="Este pedido não aceita mais confirmação de Pix.")

    if locked.status not in {"created", "pending"}:
        raise HTTPException(status_code=409, detail="Este pagamento não está mais pendente.")

    if locked.reconciliation_attempted_at is None:
        locked.reconciliation_attempted_at = datetime.datetime.now(datetime.timezone.utc)
        from ...websocket_manager import manager
        from ..order_chat_service import queue_order_tracking_refresh

        manager.queue_committed_broadcast(
            db,
            {
                "event": "tables_updated",
                "detail": {
                    "type": "direct_pix_reported",
                    "comanda_id": str(comanda.id),
                    "intent_id": str(locked.id),
                },
            },
            int(restaurant_id),
        )
        queue_order_tracking_refresh(db, int(restaurant_id), str(comanda.id))
        db.commit()
        db.refresh(locked)

    return locked
