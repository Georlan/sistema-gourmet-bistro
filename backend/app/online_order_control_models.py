"""Controles operacionais tenant-aware para o canal público de pedidos.

O módulo fica separado de ``models.py`` para manter o hardening do Cardápio
isolado. As rotas que usam estes modelos são importadas no startup, registrando
as tabelas no metadata do SQLAlchemy também nos testes SQLite.
"""

from __future__ import annotations

import datetime
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
)

from .database import Base, current_restaurante_id


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


class OnlineOrderControl(Base):
    __tablename__ = "online_order_controls"
    __table_args__ = (
        CheckConstraint(
            "max_active_orders IS NULL OR max_active_orders BETWEEN 1 AND 500",
            name="ck_online_order_controls_capacity",
        ),
    )

    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        primary_key=True,
        default=lambda: current_restaurante_id.get(),
    )
    paused = Column(Boolean, nullable=False, default=False)
    pause_reason = Column(String(160), nullable=True)
    pause_until = Column(DateTime(timezone=True), nullable=True)
    max_active_orders = Column(Integer, nullable=True)
    auto_pause = Column(Boolean, nullable=False, default=False)
    paused_by_user_id = Column(
        String,
        ForeignKey("usuarios.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow)


class OnlineOrderCustomerBlock(Base):
    __tablename__ = "online_order_customer_blocks"
    __table_args__ = (
        CheckConstraint(
            "cliente_id IS NOT NULL OR phone_hash IS NOT NULL",
            name="ck_online_order_customer_blocks_identity",
        ),
        Index(
            "ix_online_order_customer_blocks_tenant_phone",
            "restaurante_id",
            "phone_hash",
            "active",
        ),
        Index(
            "ix_online_order_customer_blocks_tenant_customer",
            "restaurante_id",
            "cliente_id",
            "active",
        ),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        nullable=False,
        default=lambda: current_restaurante_id.get(),
        index=True,
    )
    cliente_id = Column(String, ForeignKey("clientes.id", ondelete="SET NULL"), nullable=True)
    phone_hash = Column(String(64), nullable=True)
    reason = Column(String(240), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    active = Column(Boolean, nullable=False, default=True)
    created_by_user_id = Column(
        String,
        ForeignKey("usuarios.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)


class OnlineOrderOperationalAudit(Base):
    __tablename__ = "online_order_operational_audit"
    __table_args__ = (
        Index(
            "ix_online_order_operational_audit_tenant_created",
            "restaurante_id",
            "created_at",
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        nullable=False,
        default=lambda: current_restaurante_id.get(),
        index=True,
    )
    actor_user_id = Column(
        String,
        ForeignKey("usuarios.id", ondelete="SET NULL"),
        nullable=True,
    )
    action = Column(String(64), nullable=False)
    reason = Column(Text, nullable=False)
    before_data = Column(JSON, nullable=True)
    after_data = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
