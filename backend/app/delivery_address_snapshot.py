"""Persistência do snapshot estruturado do endereço de entrega.

O endereço pertence ao pedido, não ao cadastro mutável do cliente. O payload é
criptografado em repouso por conter PII. `delivery_endereco` continua existindo
na Comanda como compatibilidade para consumidores legados.
"""

from __future__ import annotations

import datetime
import json
from typing import Any

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Session

from .crypt import decrypt_field, encrypt_field
from .database import Base, current_restaurante_id
from .domain.orders.errors import OrderValidationError
from .models import Comanda
from .application.orders.commands import DeliveryAddressInput


class ComandaDeliveryAddressSnapshot(Base):
    __tablename__ = "comanda_delivery_address_snapshots"
    __table_args__ = (
        Index(
            "ix_comanda_delivery_address_snapshots_tenant_order",
            "restaurante_id",
            "comanda_id",
            unique=True,
        ),
    )

    comanda_id = Column(
        String,
        ForeignKey("comandas.id", ondelete="CASCADE"),
        primary_key=True,
    )
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    payload_encrypted = Column(Text, nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
    )

    @property
    def payload(self) -> dict[str, Any]:
        decrypted = decrypt_field(self.payload_encrypted)
        if not decrypted:
            return {}
        return json.loads(decrypted)


def _canonical_payload(address: DeliveryAddressInput) -> dict[str, Any]:
    return address.to_snapshot()


def persist_delivery_address_snapshot(
    db: Session,
    *,
    restaurante_id: int,
    comanda_id: str,
    address: DeliveryAddressInput | None,
) -> ComandaDeliveryAddressSnapshot | None:
    """Grava uma única vez o destino estruturado de um pedido.

    A chamada é idempotente para o mesmo payload. Uma tentativa de sobrescrever
    o snapshot com outro endereço falha para preservar o histórico do pedido.
    """
    if address is None:
        return None

    comanda = (
        db.query(Comanda.id)
        .filter(
            Comanda.id == comanda_id,
            Comanda.restaurante_id == restaurante_id,
        )
        .first()
    )
    if comanda is None:
        raise OrderValidationError(
            "Comanda não encontrada no tenant para persistir o endereço de entrega."
        )

    payload = _canonical_payload(address)
    existing = (
        db.query(ComandaDeliveryAddressSnapshot)
        .filter(
            ComandaDeliveryAddressSnapshot.comanda_id == comanda_id,
            ComandaDeliveryAddressSnapshot.restaurante_id == restaurante_id,
        )
        .first()
    )
    if existing is not None:
        if existing.payload != payload:
            raise OrderValidationError(
                "O snapshot do endereço de entrega é imutável e não pode ser sobrescrito."
            )
        return existing

    serialized = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    snapshot = ComandaDeliveryAddressSnapshot(
        comanda_id=comanda_id,
        restaurante_id=restaurante_id,
        payload_encrypted=encrypt_field(serialized),
    )
    db.add(snapshot)
    db.flush()
    return snapshot


def load_delivery_address_snapshot(
    db: Session,
    *,
    restaurante_id: int,
    comanda_id: str,
) -> dict[str, Any] | None:
    snapshot = (
        db.query(ComandaDeliveryAddressSnapshot)
        .filter(
            ComandaDeliveryAddressSnapshot.comanda_id == comanda_id,
            ComandaDeliveryAddressSnapshot.restaurante_id == restaurante_id,
        )
        .first()
    )
    return snapshot.payload if snapshot is not None else None
