"""add fiscal core foundation

Revision ID: d6f31a8c2b74
Revises: c38e1a9f5d72
Create Date: 2026-09-15
"""

from alembic import op
import sqlalchemy as sa


revision = "d6f31a8c2b74"
down_revision = "c38e1a9f5d72"
branch_labels = None
depends_on = None


TENANT_TABLES = (
    "restaurant_fiscal_profiles",
    "product_fiscal_profiles",
    "fiscal_documents",
    "fiscal_document_items",
    "fiscal_payments",
    "fiscal_events",
    "fiscal_sequences",
)


def _enable_tenant_rls(table: str) -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON {table}
        USING (
            restaurante_id = current_setting('app.current_restaurante_id', true)::int
        )
        WITH CHECK (
            restaurante_id = current_setting('app.current_restaurante_id', true)::int
        )
        """
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO koma_app")


def upgrade() -> None:
    op.create_table(
        "restaurant_fiscal_profiles",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "restaurante_id",
            sa.Integer(),
            sa.ForeignKey("restaurantes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("country_code", sa.String(length=2), nullable=False, server_default="BR"),
        sa.Column("uf", sa.String(length=2), nullable=False, server_default="CE"),
        sa.Column("document_model", sa.String(length=2), nullable=False, server_default="65"),
        sa.Column("environment", sa.String(length=16), nullable=False, server_default="homologacao"),
        sa.Column("series", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("provider", sa.String(length=32), nullable=False, server_default="direct_sefaz"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="draft"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "compliance_baseline",
            sa.String(length=64),
            nullable=False,
            server_default="ce-nfce-2026-09-15",
        ),
        sa.Column("cnpj", sa.String(length=14), nullable=True),
        sa.Column("inscricao_estadual", sa.String(length=32), nullable=True),
        sa.Column("razao_social", sa.String(length=160), nullable=True),
        sa.Column("nome_fantasia", sa.String(length=160), nullable=True),
        sa.Column("crt", sa.String(length=2), nullable=True),
        sa.Column("cnae_principal", sa.String(length=7), nullable=True),
        sa.Column("municipio_codigo_ibge", sa.String(length=7), nullable=True),
        sa.Column("endereco_fiscal", sa.JSON(), nullable=True),
        sa.Column("certificate_secret_ref", sa.String(length=255), nullable=True),
        sa.Column("certificate_fingerprint", sa.String(length=128), nullable=True),
        sa.Column("certificate_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("csc_id", sa.String(length=16), nullable=True),
        sa.Column("csc_secret_ref", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("restaurante_id", name="uq_restaurant_fiscal_profile_tenant"),
        sa.CheckConstraint("document_model = '65'", name="ck_restaurant_fiscal_profile_model"),
        sa.CheckConstraint(
            "environment IN ('homologacao', 'producao')",
            name="ck_restaurant_fiscal_profile_environment",
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'ready', 'blocked')",
            name="ck_restaurant_fiscal_profile_status",
        ),
        sa.CheckConstraint("series > 0", name="ck_restaurant_fiscal_profile_series"),
    )
    op.create_index(
        "ix_restaurant_fiscal_profiles_restaurante_id",
        "restaurant_fiscal_profiles",
        ["restaurante_id"],
    )

    op.create_table(
        "product_fiscal_profiles",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "restaurante_id",
            sa.Integer(),
            sa.ForeignKey("restaurantes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("produto_id", sa.String(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="draft"),
        sa.Column("source", sa.String(length=16), nullable=False, server_default="manual"),
        sa.Column("ncm", sa.String(length=8), nullable=True),
        sa.Column("cest", sa.String(length=7), nullable=True),
        sa.Column("cfop", sa.String(length=4), nullable=True),
        sa.Column("origem", sa.String(length=1), nullable=True),
        sa.Column("cst_icms", sa.String(length=3), nullable=True),
        sa.Column("csosn", sa.String(length=3), nullable=True),
        sa.Column("cst_pis", sa.String(length=2), nullable=True),
        sa.Column("cst_cofins", sa.String(length=2), nullable=True),
        sa.Column("gtin", sa.String(length=14), nullable=True),
        sa.Column("commercial_unit", sa.String(length=6), nullable=True),
        sa.Column("tax_unit", sa.String(length=6), nullable=True),
        sa.Column("ibs_cbs_classification", sa.String(length=32), nullable=True),
        sa.Column("tax_metadata", sa.JSON(), nullable=True),
        sa.Column("valid_from", sa.Date(), nullable=True),
        sa.Column("valid_until", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["restaurante_id", "produto_id"],
            ["produtos.restaurante_id", "produtos.id"],
            name="fk_product_fiscal_profile_product_tenant",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "restaurante_id",
            "produto_id",
            "revision",
            name="uq_product_fiscal_profile_revision",
        ),
        sa.CheckConstraint("revision > 0", name="ck_product_fiscal_profile_revision"),
        sa.CheckConstraint(
            "status IN ('draft', 'ready', 'blocked')",
            name="ck_product_fiscal_profile_status",
        ),
        sa.CheckConstraint(
            "source IN ('contador', 'manual', 'importacao', 'migration')",
            name="ck_product_fiscal_profile_source",
        ),
    )
    op.create_index(
        "ix_product_fiscal_profile_tenant_product_status",
        "product_fiscal_profiles",
        ["restaurante_id", "produto_id", "status"],
    )

    op.create_table(
        "fiscal_documents",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "restaurante_id",
            sa.Integer(),
            sa.ForeignKey("restaurantes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("comanda_id", sa.String(), sa.ForeignKey("comandas.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="draft"),
        sa.Column("model", sa.String(length=2), nullable=False, server_default="65"),
        sa.Column("environment", sa.String(length=16), nullable=False, server_default="homologacao"),
        sa.Column("series", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("number", sa.Integer(), nullable=True),
        sa.Column("access_key", sa.String(length=44), nullable=True),
        sa.Column("provider", sa.String(length=32), nullable=False, server_default="direct_sefaz"),
        sa.Column("provider_operation_key", sa.String(length=128), nullable=True),
        sa.Column("authorization_protocol", sa.String(length=64), nullable=True),
        sa.Column("rejection_code", sa.String(length=16), nullable=True),
        sa.Column("rejection_message", sa.String(length=512), nullable=True),
        sa.Column("total_amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("sale_snapshot", sa.JSON(), nullable=False),
        sa.Column("calculation_snapshot", sa.JSON(), nullable=True),
        sa.Column("rule_set_version", sa.String(length=64), nullable=True),
        sa.Column("xml_storage_ref", sa.String(length=512), nullable=True),
        sa.Column("authorized_xml_storage_ref", sa.String(length=512), nullable=True),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("authorized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("contingency_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("restaurante_id", "id", name="uq_fiscal_document_tenant_id"),
        sa.UniqueConstraint(
            "restaurante_id",
            "idempotency_key",
            name="uq_fiscal_document_tenant_idempotency",
        ),
        sa.UniqueConstraint("access_key", name="uq_fiscal_document_access_key"),
        sa.UniqueConstraint(
            "restaurante_id",
            "environment",
            "model",
            "series",
            "number",
            name="uq_fiscal_document_number",
        ),
        sa.CheckConstraint(
            "status IN ('draft','ready','submitting','authorized','rejected','unknown',"
            "'reconciling','contingency','pending_transmission','cancel_pending','cancelled')",
            name="ck_fiscal_document_status",
        ),
        sa.CheckConstraint("model = '65'", name="ck_fiscal_document_model"),
        sa.CheckConstraint(
            "environment IN ('homologacao', 'producao')",
            name="ck_fiscal_document_environment",
        ),
        sa.CheckConstraint("series > 0", name="ck_fiscal_document_series"),
        sa.CheckConstraint("number IS NULL OR number > 0", name="ck_fiscal_document_number_positive"),
        sa.CheckConstraint("total_amount >= 0", name="ck_fiscal_document_total_nonnegative"),
    )
    op.create_index(
        "ix_fiscal_document_tenant_status_created",
        "fiscal_documents",
        ["restaurante_id", "status", "created_at"],
    )
    op.create_index(
        "ix_fiscal_document_tenant_comanda",
        "fiscal_documents",
        ["restaurante_id", "comanda_id"],
    )

    op.create_table(
        "fiscal_document_items",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "restaurante_id",
            sa.Integer(),
            sa.ForeignKey("restaurantes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("document_id", sa.String(length=36), nullable=False),
        sa.Column("item_order", sa.Integer(), nullable=False),
        sa.Column("produto_id", sa.String(), nullable=True),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False),
        sa.Column("unit_amount", sa.Numeric(14, 4), nullable=False),
        sa.Column("total_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("fiscal_profile_revision", sa.Integer(), nullable=True),
        sa.Column("product_snapshot", sa.JSON(), nullable=False),
        sa.Column("tax_calculation", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["restaurante_id", "document_id"],
            ["fiscal_documents.restaurante_id", "fiscal_documents.id"],
            name="fk_fiscal_document_item_document_tenant",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "restaurante_id",
            "document_id",
            "item_order",
            name="uq_fiscal_document_item_order",
        ),
        sa.CheckConstraint("item_order > 0", name="ck_fiscal_document_item_order"),
        sa.CheckConstraint("quantity > 0", name="ck_fiscal_document_item_quantity"),
        sa.CheckConstraint("unit_amount >= 0", name="ck_fiscal_document_item_unit_amount"),
        sa.CheckConstraint("total_amount >= 0", name="ck_fiscal_document_item_total_amount"),
    )

    op.create_table(
        "fiscal_payments",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "restaurante_id",
            sa.Integer(),
            sa.ForeignKey("restaurantes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("document_id", sa.String(length=36), nullable=False),
        sa.Column("pagamento_id", sa.String(), sa.ForeignKey("pagamentos.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("payment_order", sa.Integer(), nullable=False),
        sa.Column("tpag", sa.String(length=3), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("tp_integra", sa.String(length=1), nullable=True),
        sa.Column("institution_cnpj", sa.String(length=14), nullable=True),
        sa.Column("authorization_code", sa.String(length=128), nullable=True),
        sa.Column("terminal_id", sa.String(length=128), nullable=True),
        sa.Column("end_to_end_id", sa.String(length=128), nullable=True),
        sa.Column("provider_name", sa.String(length=32), nullable=True),
        sa.Column("provider_reference", sa.String(length=128), nullable=True),
        sa.Column("provider_metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["restaurante_id", "document_id"],
            ["fiscal_documents.restaurante_id", "fiscal_documents.id"],
            name="fk_fiscal_payment_document_tenant",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "restaurante_id",
            "document_id",
            "payment_order",
            name="uq_fiscal_payment_order",
        ),
        sa.CheckConstraint("payment_order > 0", name="ck_fiscal_payment_order"),
        sa.CheckConstraint("amount > 0", name="ck_fiscal_payment_amount"),
    )

    op.create_table(
        "fiscal_events",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "restaurante_id",
            sa.Integer(),
            sa.ForeignKey("restaurantes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("document_id", sa.String(length=36), nullable=False),
        sa.Column("event_key", sa.String(length=128), nullable=False),
        sa.Column("event_type", sa.String(length=48), nullable=False),
        sa.Column("from_status", sa.String(length=24), nullable=True),
        sa.Column("to_status", sa.String(length=24), nullable=True),
        sa.Column("actor_id", sa.String(), nullable=True),
        sa.Column("external_protocol", sa.String(length=128), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["restaurante_id", "document_id"],
            ["fiscal_documents.restaurante_id", "fiscal_documents.id"],
            name="fk_fiscal_event_document_tenant",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "restaurante_id",
            "document_id",
            "event_key",
            name="uq_fiscal_event_key",
        ),
    )
    op.create_index(
        "ix_fiscal_event_tenant_document_created",
        "fiscal_events",
        ["restaurante_id", "document_id", "created_at"],
    )

    op.create_table(
        "fiscal_sequences",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "restaurante_id",
            sa.Integer(),
            sa.ForeignKey("restaurantes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("environment", sa.String(length=16), nullable=False, server_default="homologacao"),
        sa.Column("model", sa.String(length=2), nullable=False, server_default="65"),
        sa.Column("series", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("next_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "restaurante_id",
            "environment",
            "model",
            "series",
            name="uq_fiscal_sequence_scope",
        ),
        sa.CheckConstraint("model = '65'", name="ck_fiscal_sequence_model"),
        sa.CheckConstraint(
            "environment IN ('homologacao', 'producao')",
            name="ck_fiscal_sequence_environment",
        ),
        sa.CheckConstraint("series > 0", name="ck_fiscal_sequence_series"),
        sa.CheckConstraint("next_number > 0", name="ck_fiscal_sequence_next_number"),
        sa.CheckConstraint("version > 0", name="ck_fiscal_sequence_version"),
    )
    op.create_index(
        "ix_fiscal_sequences_restaurante_id",
        "fiscal_sequences",
        ["restaurante_id"],
    )

    for table in TENANT_TABLES:
        _enable_tenant_rls(table)

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "GRANT USAGE, SELECT ON SEQUENCE restaurant_fiscal_profiles_id_seq TO koma_app"
        )
        op.execute("GRANT USAGE, SELECT ON SEQUENCE fiscal_sequences_id_seq TO koma_app")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for table in TENANT_TABLES:
            op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")

    op.drop_index("ix_fiscal_sequences_restaurante_id", table_name="fiscal_sequences")
    op.drop_table("fiscal_sequences")
    op.drop_index("ix_fiscal_event_tenant_document_created", table_name="fiscal_events")
    op.drop_table("fiscal_events")
    op.drop_table("fiscal_payments")
    op.drop_table("fiscal_document_items")
    op.drop_index("ix_fiscal_document_tenant_comanda", table_name="fiscal_documents")
    op.drop_index("ix_fiscal_document_tenant_status_created", table_name="fiscal_documents")
    op.drop_table("fiscal_documents")
    op.drop_index(
        "ix_product_fiscal_profile_tenant_product_status",
        table_name="product_fiscal_profiles",
    )
    op.drop_table("product_fiscal_profiles")
    op.drop_index(
        "ix_restaurant_fiscal_profiles_restaurante_id",
        table_name="restaurant_fiscal_profiles",
    )
    op.drop_table("restaurant_fiscal_profiles")
