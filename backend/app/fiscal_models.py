import datetime
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    UniqueConstraint,
)

from .database import Base, current_restaurante_id


FISCAL_DOCUMENT_STATUSES = (
    "draft",
    "ready",
    "submitting",
    "authorized",
    "rejected",
    "unknown",
    "reconciling",
    "contingency",
    "pending_transmission",
    "cancel_pending",
    "cancelled",
)


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


class RestaurantFiscalProfile(Base):
    """Configuração fiscal do tenant sem guardar segredos criptográficos em claro."""

    __tablename__ = "restaurant_fiscal_profiles"
    __table_args__ = (
        UniqueConstraint("restaurante_id", name="uq_restaurant_fiscal_profile_tenant"),
        CheckConstraint("document_model = '65'", name="ck_restaurant_fiscal_profile_model"),
        CheckConstraint(
            "environment IN ('homologacao', 'producao')",
            name="ck_restaurant_fiscal_profile_environment",
        ),
        CheckConstraint(
            "status IN ('draft', 'ready', 'blocked')",
            name="ck_restaurant_fiscal_profile_status",
        ),
        CheckConstraint("series > 0", name="ck_restaurant_fiscal_profile_series"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    country_code = Column(String(2), nullable=False, default="BR")
    uf = Column(String(2), nullable=False, default="CE")
    document_model = Column(String(2), nullable=False, default="65")
    environment = Column(String(16), nullable=False, default="homologacao")
    series = Column(Integer, nullable=False, default=1)
    provider = Column(String(32), nullable=False, default="direct_sefaz")
    status = Column(String(16), nullable=False, default="draft")
    enabled = Column(Boolean, nullable=False, default=False)
    compliance_baseline = Column(String(64), nullable=False, default="ce-nfce-2026-09-15")

    # Identidade fiscal. Validação/ativação pertence ao onboarding fiscal (F2).
    cnpj = Column(String(14), nullable=True)
    inscricao_estadual = Column(String(32), nullable=True)
    razao_social = Column(String(160), nullable=True)
    nome_fantasia = Column(String(160), nullable=True)
    crt = Column(String(2), nullable=True)
    cnae_principal = Column(String(7), nullable=True)
    municipio_codigo_ibge = Column(String(7), nullable=True)
    endereco_fiscal = Column(JSON, nullable=True)

    # Referências para secret manager; nunca PEM/PFX/CSC em claro nesta tabela.
    certificate_secret_ref = Column(String(255), nullable=True)
    certificate_fingerprint = Column(String(128), nullable=True)
    certificate_expires_at = Column(DateTime(timezone=True), nullable=True)
    csc_id = Column(String(16), nullable=True)
    csc_secret_ref = Column(String(255), nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )


class ProductFiscalProfile(Base):
    """Classificação fiscal versionada do produto.

    O KÔMA aplica a configuração aprovada; ele não adivinha tributação pelo nome
    do item. Perfis podem nascer em draft e só depois avançar para ready.
    """

    __tablename__ = "product_fiscal_profiles"
    __table_args__ = (
        ForeignKeyConstraint(
            ["restaurante_id", "produto_id"],
            ["produtos.restaurante_id", "produtos.id"],
            name="fk_product_fiscal_profile_product_tenant",
            ondelete="CASCADE",
        ),
        UniqueConstraint(
            "restaurante_id",
            "produto_id",
            "revision",
            name="uq_product_fiscal_profile_revision",
        ),
        CheckConstraint("revision > 0", name="ck_product_fiscal_profile_revision"),
        CheckConstraint(
            "status IN ('draft', 'ready', 'blocked')",
            name="ck_product_fiscal_profile_status",
        ),
        CheckConstraint(
            "source IN ('contador', 'manual', 'importacao', 'migration')",
            name="ck_product_fiscal_profile_source",
        ),
        Index(
            "ix_product_fiscal_profile_tenant_product_status",
            "restaurante_id",
            "produto_id",
            "status",
        ),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
    )
    produto_id = Column(String, nullable=False)
    revision = Column(Integer, nullable=False, default=1)
    status = Column(String(16), nullable=False, default="draft")
    source = Column(String(16), nullable=False, default="manual")

    ncm = Column(String(8), nullable=True)
    cest = Column(String(7), nullable=True)
    cfop = Column(String(4), nullable=True)
    origem = Column(String(1), nullable=True)
    cst_icms = Column(String(3), nullable=True)
    csosn = Column(String(3), nullable=True)
    cst_pis = Column(String(2), nullable=True)
    cst_cofins = Column(String(2), nullable=True)
    gtin = Column(String(14), nullable=True)
    commercial_unit = Column(String(6), nullable=True)
    tax_unit = Column(String(6), nullable=True)
    ibs_cbs_classification = Column(String(32), nullable=True)
    tax_metadata = Column(JSON, nullable=True)

    valid_from = Column(Date, nullable=True)
    valid_until = Column(Date, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )


class FiscalDocument(Base):
    """Fonte de verdade fiscal separada do pagamento e do fechamento operacional."""

    __tablename__ = "fiscal_documents"
    __table_args__ = (
        UniqueConstraint("restaurante_id", "id", name="uq_fiscal_document_tenant_id"),
        UniqueConstraint(
            "restaurante_id",
            "idempotency_key",
            name="uq_fiscal_document_tenant_idempotency",
        ),
        UniqueConstraint("access_key", name="uq_fiscal_document_access_key"),
        UniqueConstraint(
            "restaurante_id",
            "environment",
            "model",
            "series",
            "number",
            name="uq_fiscal_document_number",
        ),
        CheckConstraint(
            "status IN ("
            "'draft','ready','submitting','authorized','rejected','unknown',"
            "'reconciling','contingency','pending_transmission','cancel_pending','cancelled'"
            ")",
            name="ck_fiscal_document_status",
        ),
        CheckConstraint("model = '65'", name="ck_fiscal_document_model"),
        CheckConstraint(
            "environment IN ('homologacao', 'producao')",
            name="ck_fiscal_document_environment",
        ),
        CheckConstraint("series > 0", name="ck_fiscal_document_series"),
        CheckConstraint(
            "number IS NULL OR number > 0", name="ck_fiscal_document_number_positive"
        ),
        CheckConstraint("total_amount >= 0", name="ck_fiscal_document_total_nonnegative"),
        Index(
            "ix_fiscal_document_tenant_status_created",
            "restaurante_id",
            "status",
            "created_at",
        ),
        Index(
            "ix_fiscal_document_tenant_comanda",
            "restaurante_id",
            "comanda_id",
        ),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
    )
    comanda_id = Column(String, ForeignKey("comandas.id", ondelete="RESTRICT"), nullable=True)
    idempotency_key = Column(String(128), nullable=False)
    status = Column(String(24), nullable=False, default="draft")
    model = Column(String(2), nullable=False, default="65")
    environment = Column(String(16), nullable=False, default="homologacao")
    series = Column(Integer, nullable=False, default=1)
    number = Column(Integer, nullable=True)
    access_key = Column(String(44), nullable=True)
    provider = Column(String(32), nullable=False, default="direct_sefaz")
    provider_operation_key = Column(String(128), nullable=True)
    authorization_protocol = Column(String(64), nullable=True)
    rejection_code = Column(String(16), nullable=True)
    rejection_message = Column(String(512), nullable=True)

    total_amount = Column(Numeric(14, 2), nullable=False, default=0)
    sale_snapshot = Column(JSON, nullable=False)
    calculation_snapshot = Column(JSON, nullable=True)
    rule_set_version = Column(String(64), nullable=True)
    xml_storage_ref = Column(String(512), nullable=True)
    authorized_xml_storage_ref = Column(String(512), nullable=True)

    issued_at = Column(DateTime(timezone=True), nullable=True)
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    authorized_at = Column(DateTime(timezone=True), nullable=True)
    contingency_at = Column(DateTime(timezone=True), nullable=True)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )


class FiscalDocumentItem(Base):
    __tablename__ = "fiscal_document_items"
    __table_args__ = (
        ForeignKeyConstraint(
            ["restaurante_id", "document_id"],
            ["fiscal_documents.restaurante_id", "fiscal_documents.id"],
            name="fk_fiscal_document_item_document_tenant",
            ondelete="CASCADE",
        ),
        UniqueConstraint(
            "restaurante_id",
            "document_id",
            "item_order",
            name="uq_fiscal_document_item_order",
        ),
        CheckConstraint("item_order > 0", name="ck_fiscal_document_item_order"),
        CheckConstraint("quantity > 0", name="ck_fiscal_document_item_quantity"),
        CheckConstraint("unit_amount >= 0", name="ck_fiscal_document_item_unit_amount"),
        CheckConstraint("total_amount >= 0", name="ck_fiscal_document_item_total_amount"),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
    )
    document_id = Column(String(36), nullable=False)
    item_order = Column(Integer, nullable=False)
    produto_id = Column(String, nullable=True)
    description = Column(String(255), nullable=False)
    quantity = Column(Numeric(14, 4), nullable=False)
    unit_amount = Column(Numeric(14, 4), nullable=False)
    total_amount = Column(Numeric(14, 2), nullable=False)
    fiscal_profile_revision = Column(Integer, nullable=True)
    product_snapshot = Column(JSON, nullable=False)
    tax_calculation = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)


class FiscalPayment(Base):
    __tablename__ = "fiscal_payments"
    __table_args__ = (
        ForeignKeyConstraint(
            ["restaurante_id", "document_id"],
            ["fiscal_documents.restaurante_id", "fiscal_documents.id"],
            name="fk_fiscal_payment_document_tenant",
            ondelete="CASCADE",
        ),
        UniqueConstraint(
            "restaurante_id",
            "document_id",
            "payment_order",
            name="uq_fiscal_payment_order",
        ),
        CheckConstraint("payment_order > 0", name="ck_fiscal_payment_order"),
        CheckConstraint("amount > 0", name="ck_fiscal_payment_amount"),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
    )
    document_id = Column(String(36), nullable=False)
    pagamento_id = Column(String, ForeignKey("pagamentos.id", ondelete="RESTRICT"), nullable=True)
    payment_order = Column(Integer, nullable=False)
    tpag = Column(String(3), nullable=False)
    amount = Column(Numeric(14, 2), nullable=False)
    tp_integra = Column(String(1), nullable=True)
    institution_cnpj = Column(String(14), nullable=True)
    authorization_code = Column(String(128), nullable=True)
    terminal_id = Column(String(128), nullable=True)
    end_to_end_id = Column(String(128), nullable=True)
    provider_name = Column(String(32), nullable=True)
    provider_reference = Column(String(128), nullable=True)
    provider_metadata = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)


class FiscalEvent(Base):
    """Trilha imutável de transições e eventos fiscais externos/internos."""

    __tablename__ = "fiscal_events"
    __table_args__ = (
        ForeignKeyConstraint(
            ["restaurante_id", "document_id"],
            ["fiscal_documents.restaurante_id", "fiscal_documents.id"],
            name="fk_fiscal_event_document_tenant",
            ondelete="CASCADE",
        ),
        UniqueConstraint(
            "restaurante_id",
            "document_id",
            "event_key",
            name="uq_fiscal_event_key",
        ),
        Index(
            "ix_fiscal_event_tenant_document_created",
            "restaurante_id",
            "document_id",
            "created_at",
        ),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
    )
    document_id = Column(String(36), nullable=False)
    event_key = Column(String(128), nullable=False)
    event_type = Column(String(48), nullable=False)
    from_status = Column(String(24), nullable=True)
    to_status = Column(String(24), nullable=True)
    actor_id = Column(String, nullable=True)
    external_protocol = Column(String(128), nullable=True)
    payload = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_utcnow)


class FiscalSequence(Base):
    """Reserva monotônica por tenant/modelo/série/ambiente.

    A alocação transacional será implementada pelo serviço fiscal; esta tabela
    existe desde já para impedir que a numeração fique implícita em MAX()+1.
    """

    __tablename__ = "fiscal_sequences"
    __table_args__ = (
        UniqueConstraint(
            "restaurante_id",
            "environment",
            "model",
            "series",
            name="uq_fiscal_sequence_scope",
        ),
        CheckConstraint("model = '65'", name="ck_fiscal_sequence_model"),
        CheckConstraint(
            "environment IN ('homologacao', 'producao')",
            name="ck_fiscal_sequence_environment",
        ),
        CheckConstraint("series > 0", name="ck_fiscal_sequence_series"),
        CheckConstraint("next_number > 0", name="ck_fiscal_sequence_next_number"),
        CheckConstraint("version > 0", name="ck_fiscal_sequence_version"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    environment = Column(String(16), nullable=False, default="homologacao")
    model = Column(String(2), nullable=False, default="65")
    series = Column(Integer, nullable=False, default=1)
    next_number = Column(Integer, nullable=False, default=1)
    version = Column(Integer, nullable=False, default=1)
    updated_at = Column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )
