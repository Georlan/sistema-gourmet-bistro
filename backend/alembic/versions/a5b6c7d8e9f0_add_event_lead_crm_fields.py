"""add CRM fields to event leads

Revision ID: a5b6c7d8e9f0
Revises: f4a5b6c7d8e9
Create Date: 2026-10-07

"""
from alembic import op
import sqlalchemy as sa

revision = "a5b6c7d8e9f0"
down_revision = "f4a5b6c7d8e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "koma_event_lead_history",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("lead_id", sa.Integer(), sa.ForeignKey("koma_event_leads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor", sa.String(255), nullable=False),
        sa.Column("changes", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_event_lead_history_lead_id_id", "koma_event_lead_history", ["lead_id", "id"])
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE koma_event_leads ENABLE ROW LEVEL SECURITY")
        op.execute("REVOKE ALL ON koma_event_leads FROM PUBLIC")
        op.execute("ALTER TABLE koma_event_lead_history ENABLE ROW LEVEL SECURITY")
        op.execute("""DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koma_app') THEN
                CREATE POLICY event_leads_backend ON koma_event_leads
                    FOR ALL TO koma_app USING (true) WITH CHECK (true);
                GRANT SELECT, INSERT ON koma_event_lead_history TO koma_app;
                GRANT USAGE, SELECT ON SEQUENCE koma_event_lead_history_id_seq TO koma_app;
                CREATE POLICY event_lead_history_backend_read ON koma_event_lead_history
                    FOR SELECT TO koma_app USING (true);
                CREATE POLICY event_lead_history_backend_insert ON koma_event_lead_history
                    FOR INSERT TO koma_app WITH CHECK (true);
            END IF;
        END $$""")
        op.execute("REVOKE ALL ON koma_event_lead_history FROM PUBLIC")
        # No browser-role policies: only the trusted backend may access commercial data.
        for role in ("anon", "authenticated"):
            op.execute(sa.text("DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '" + role + "') THEN REVOKE ALL ON koma_event_leads FROM " + role + "; END IF; END $$"))
    op.add_column("koma_event_leads", sa.Column("last_contact_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("koma_event_leads", sa.Column("cidade", sa.String(length=120), nullable=True))
    op.add_column("koma_event_leads", sa.Column("quantidade_unidades", sa.Integer(), nullable=True))
    op.add_column("koma_event_leads", sa.Column("sistema_atual", sa.String(length=120), nullable=True))
    op.add_column("koma_event_leads", sa.Column("principal_dor", sa.Text(), nullable=True))
    op.add_column("koma_event_leads", sa.Column("interesse", sa.Text(), nullable=True))
    op.add_column("koma_event_leads", sa.Column("melhor_horario_contato", sa.String(length=120), nullable=True))
    op.create_check_constraint(
        "ck_koma_event_leads_status",
        "koma_event_leads",
        "status IN ('new', 'contacted', 'qualified', 'demo_scheduled', 'converted', 'lost')",
    )
    op.create_index(
        "ix_koma_event_leads_event_status_created",
        "koma_event_leads",
        ["event_slug", "status", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP POLICY IF EXISTS event_leads_backend ON koma_event_leads")
        op.execute("ALTER TABLE koma_event_leads DISABLE ROW LEVEL SECURITY")
    op.drop_table("koma_event_lead_history")
    op.drop_index("ix_koma_event_leads_event_status_created", table_name="koma_event_leads")
    op.drop_constraint("ck_koma_event_leads_status", "koma_event_leads", type_="check")
    op.drop_column("koma_event_leads", "melhor_horario_contato")
    op.drop_column("koma_event_leads", "interesse")
    op.drop_column("koma_event_leads", "principal_dor")
    op.drop_column("koma_event_leads", "sistema_atual")
    op.drop_column("koma_event_leads", "quantidade_unidades")
    op.drop_column("koma_event_leads", "cidade")
    op.drop_column("koma_event_leads", "last_contact_at")
