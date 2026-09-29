"""Archive team memberships while releasing login contacts."""
from alembic import op
import sqlalchemy as sa

revision = "v2f3a4b5c6d7"
down_revision = "u1e2f3a4b5c6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("usuarios", sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column("usuarios", "removed_at")
