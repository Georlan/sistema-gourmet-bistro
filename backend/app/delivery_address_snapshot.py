"""Persistência do endereço estruturado de entrega.

O primeiro snapshot do pedido permanece imutável e representa o destino
original confirmado. Correções operacionais posteriores são registradas como
revisões append-only, também criptografadas em repouso por conter PII.
`delivery_endereco` continua existindo na Comanda como compatibilidade para
consumidores legados.
"""

from __future__ import annotations

import datetime
import json
import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, event
from sqlalchemy.orm import Session

from .crypt import decrypt_field, encrypt_field
from .database import Base, current_restaurante_id
from .domain.orders.errors import OrderValidationError
from .models import Comanda

if TYPE_CHECKING:
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


class ComandaDeliveryAddressRevision(Base):
    """Correção operacional append-only sem apagar o destino original."""

    __tablename__ = "comanda_delivery_address_revisions"
    __table_args__ = (
        Index(
            "ix_comanda_delivery_address_revisions_tenant_order_created",
            "restaurante_id",
            "comanda_id",
            "created_at",
        ),
    )

    id = Column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    comanda_id = Column(
        String,
        ForeignKey("comandas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    payload_encrypted = Column(Text, nullable=False)
    operator_id = Column(String, nullable=False)
    reason = Column(String(500), nullable=False)
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


@event.listens_for(ComandaDeliveryAddressRevision, "before_update")
def _block_delivery_address_revision_update(mapper, connection, target):
    raise PermissionError("Revisões de endereço são imutáveis e não podem ser atualizadas.")


@event.listens_for(ComandaDeliveryAddressRevision, "before_delete")
def _block_delivery_address_revision_delete(mapper, connection, target):
    raise PermissionError("Revisões de endereço são imutáveis e não podem ser removidas.")


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


def load_original_delivery_address_snapshot(
    db: Session,
    *,
    restaurante_id: int,
    comanda_id: str,
) -> dict[str, Any] | None:
    """Retorna somente o destino original, que nunca é sobrescrito."""
    snapshot = (
        db.query(ComandaDeliveryAddressSnapshot)
        .filter(
            ComandaDeliveryAddressSnapshot.comanda_id == comanda_id,
            ComandaDeliveryAddressSnapshot.restaurante_id == restaurante_id,
        )
        .first()
    )
    return snapshot.payload if snapshot is not None else None


def load_delivery_address_snapshot(
    db: Session,
    *,
    restaurante_id: int,
    comanda_id: str,
) -> dict[str, Any] | None:
    """Retorna o endereço operacional vigente, preservando o original no histórico."""
    revision = (
        db.query(ComandaDeliveryAddressRevision)
        .filter(
            ComandaDeliveryAddressRevision.comanda_id == comanda_id,
            ComandaDeliveryAddressRevision.restaurante_id == restaurante_id,
        )
        .order_by(
            ComandaDeliveryAddressRevision.created_at.desc(),
            ComandaDeliveryAddressRevision.id.desc(),
        )
        .first()
    )
    if revision is not None:
        return revision.payload
    return load_original_delivery_address_snapshot(
        db,
        restaurante_id=restaurante_id,
        comanda_id=comanda_id,
    )


def revise_delivery_address_snapshot(
    db: Session,
    *,
    restaurante_id: int,
    comanda_id: str,
    address: DeliveryAddressInput | None,
    operator_id: str,
    reason: str,
) -> ComandaDeliveryAddressRevision | None:
    """Registra uma correção sem reescrever o snapshot original.

    Se o pedido legado ainda não tiver snapshot estruturado, a primeira gravação
    continua sendo o snapshot original. Repetir o endereço operacional vigente é
    idempotente e não cria uma revisão redundante.
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
            "Comanda não encontrada no tenant para revisar o endereço de entrega."
        )

    payload = _canonical_payload(address)
    original = load_original_delivery_address_snapshot(
        db,
        restaurante_id=restaurante_id,
        comanda_id=comanda_id,
    )
    if original is None:
        persist_delivery_address_snapshot(
            db,
            restaurante_id=restaurante_id,
            comanda_id=comanda_id,
            address=address,
        )
        return None

    current = load_delivery_address_snapshot(
        db,
        restaurante_id=restaurante_id,
        comanda_id=comanda_id,
    )
    if current == payload:
        return None

    serialized = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    revision = ComandaDeliveryAddressRevision(
        restaurante_id=restaurante_id,
        comanda_id=comanda_id,
        payload_encrypted=encrypt_field(serialized),
        operator_id=str(operator_id),
        reason=str(reason).strip(),
    )
    db.add(revision)
    db.flush()
    return revision
