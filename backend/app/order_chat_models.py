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
        Index(
            "ix_order_conversations_tenant_open_updated",
            "restaurante_id",
            "closed_at",
            "updated_at",
        ),
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
    sender_user_id = Column(String, ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    body = Column(Text, nullable=False)
    # Mensagens históricas eram persistidas com html.escape(). O formato explícito
    # permite decodificá-las na borda sem continuar armazenando entidades HTML.
    body_format = Column(
        String(32),
        nullable=False,
        default="plain_text_v2",
        server_default="plain_text_v2",
    )
    event_key = Column(String(64), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )

    conversation = relationship("OrderConversation", back_populates="messages")
    sender_user = relationship("Usuario", foreign_keys=[sender_user_id])
    restaurante = relationship("Restaurante", foreign_keys=[restaurante_id])


class OrderPushSubscription(Base):
    """Associação segura entre uma assinatura Web Push e um pedido.

    O endpoint Web Push e as chaves de criptografia são capability URLs/segredos e
    permanecem cifrados em repouso. ``endpoint_hash`` existe somente para
    deduplicação/lookup e nunca substitui o endpoint no transporte.
    """

    __tablename__ = "order_push_subscriptions"
    __table_args__ = (
        UniqueConstraint(
            "conversation_id",
            "endpoint_hash",
            name="uq_order_push_subscriptions_conv_endpoint",
        ),
        Index(
            "ix_order_push_subscriptions_tenant_order",
            "restaurante_id",
            "pedido_id",
        ),
        Index("ix_order_push_subscriptions_endpoint_hash", "endpoint_hash"),
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
    pedido_id = Column(
        String(64),
        ForeignKey("comandas.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    endpoint_hash = Column(String(64), nullable=False)
    endpoint_ciphertext = Column(Text, nullable=False)
    p256dh_ciphertext = Column(Text, nullable=False)
    auth_ciphertext = Column(Text, nullable=False)
    enabled = Column(Boolean, nullable=False, default=True, server_default="1")
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
    last_sent_at = Column(DateTime(timezone=True), nullable=True)

    conversation = relationship("OrderConversation", foreign_keys=[conversation_id])
    comanda = relationship("Comanda", foreign_keys=[pedido_id])
    restaurante = relationship("Restaurante", foreign_keys=[restaurante_id])
