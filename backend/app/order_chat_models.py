import datetime
import uuid

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from .database import Base, current_restaurante_id


class OrderConversation(Base):
    """Conversa oficial associada a um pedido (Comanda) no KÔMA.

    Contém isolamento multi-tenant por restaurante_id (RLS) e chave de acesso
    público de alta entropia armazenada exclusivamente como hash SHA-256 para
    garantir anti-enumeração e segurança no Cardápio Digital.
    """

    __tablename__ = "order_conversations"
    __table_args__ = (
        UniqueConstraint("restaurante_id", "pedido_id", name="uq_order_conversations_tenant_pedido"),
        UniqueConstraint("public_access_token_hash", name="uq_order_conversations_token_hash"),
        Index("ix_order_conversations_token_hash", "public_access_token_hash", unique=True),
        Index("ix_order_conversations_tenant_updated", "restaurante_id", "updated_at"),
        Index("ix_order_conversations_pedido_id", "pedido_id"),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    pedido_id = Column(String(64), ForeignKey("comandas.id", ondelete="CASCADE"), nullable=False)
    public_access_token_hash = Column(String(64), nullable=False, unique=True)
    customer_last_read_at = Column(DateTime(timezone=True), nullable=True)
    staff_last_read_at = Column(DateTime(timezone=True), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        onupdate=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )

    messages = relationship(
        "OrderMessage",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="OrderMessage.created_at",
    )
    comanda = relationship("Comanda", foreign_keys=[pedido_id], backref="order_conversation")
    restaurante = relationship("Restaurante", foreign_keys=[restaurante_id])


class OrderMessage(Base):
    """Mensagem de texto (cliente, staff ou sistema) em uma conversa de pedido."""

    __tablename__ = "order_messages"
    __table_args__ = (
        CheckConstraint(
            "sender_type IN ('customer', 'staff', 'system')",
            name="ck_order_messages_sender_type",
        ),
        UniqueConstraint("conversation_id", "event_key", name="uq_order_messages_conv_event_key"),
        Index("ix_order_messages_conv_created", "conversation_id", "created_at"),
        Index("ix_order_messages_tenant_created", "restaurante_id", "created_at"),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    conversation_id = Column(
        String(36),
        ForeignKey("order_conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    pedido_id = Column(String(64), nullable=False)
    sender_type = Column(String(20), nullable=False)  # customer | staff | system
    sender_user_id = Column(Integer, ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    body = Column(Text, nullable=False)
    event_key = Column(String(64), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )

    conversation = relationship("OrderConversation", back_populates="messages")
    sender_user = relationship("Usuario", foreign_keys=[sender_user_id])
    restaurante = relationship("Restaurante", foreign_keys=[restaurante_id])
