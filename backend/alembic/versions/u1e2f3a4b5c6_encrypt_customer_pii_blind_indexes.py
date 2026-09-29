"""encrypt canonical customer PII and add tenant-scoped blind indexes

Revision ID: u1e2f3a4b5c6
Revises: t0d1e2f3a4b5
Create Date: 2026-09-29

Customer identity remains stable through clientes.id. Phone/e-mail become
encrypted at rest while deterministic tenant-scoped HMAC blind indexes preserve
lookup and uniqueness without exposing the raw values.
"""

from alembic import op
import sqlalchemy as sa

from app.crypt import decrypt_field, encrypt_field, pii_lookup_hash


revision = "u1e2f3a4b5c6"
down_revision = "t0d1e2f3a4b5"
branch_labels = None
depends_on = None


def _normalize_phone(value: str) -> str:
    raw = (value or "").strip()
    digits = "".join(char for char in raw if char.isdigit())
    return digits if len(digits) in {10, 11} else raw


def _normalize_email(value: str | None) -> str | None:
    normalized = (value or "").strip().lower()
    return normalized or None


def _customer_phone_hash(restaurante_id: int, value: str) -> str:
    return pii_lookup_hash(
        "cliente-telefone",
        restaurante_id,
        _normalize_phone(value),
    )


def _customer_email_hash(restaurante_id: int, value: str | None) -> str | None:
    normalized = _normalize_email(value)
    if normalized is None:
        return None
    return pii_lookup_hash("cliente-email", restaurante_id, normalized)


def _assert_no_blind_index_collisions(bind) -> None:
    customers = bind.execute(
        sa.text(
            "SELECT id, restaurante_id, telefone, email FROM clientes "
            "ORDER BY restaurante_id, id"
        )
    ).mappings().all()

    seen_phone: dict[tuple[int, str], str] = {}
    seen_email: dict[tuple[int, str], str] = {}
    for row in customers:
        rid = int(row["restaurante_id"])
        phone = _normalize_phone(str(decrypt_field(row["telefone"]) or ""))
        phone_key = (rid, _customer_phone_hash(rid, phone))
        previous = seen_phone.get(phone_key)
        if previous is not None and previous != str(row["id"]):
            raise RuntimeError(
                "Migração de PII bloqueada: clientes distintos normalizam para "
                f"o mesmo telefone no restaurante {rid}: {previous} e {row['id']}."
            )
        seen_phone[phone_key] = str(row["id"])

        email = _normalize_email(decrypt_field(row["email"]))
        if email:
            email_key = (rid, _customer_email_hash(rid, email))
            previous = seen_email.get(email_key)
            if previous is not None and previous != str(row["id"]):
                raise RuntimeError(
                    "Migração de PII bloqueada: clientes distintos normalizam para "
                    f"o mesmo e-mail no restaurante {rid}: {previous} e {row['id']}."
                )
            seen_email[email_key] = str(row["id"])


def _backfill_customer_pii(bind) -> None:
    rows = bind.execute(
        sa.text(
            "SELECT id, restaurante_id, telefone, nome, endereco, email FROM clientes"
        )
    ).mappings().all()
    for row in rows:
        rid = int(row["restaurante_id"])
        phone = _normalize_phone(str(decrypt_field(row["telefone"]) or ""))
        name = " ".join(str(decrypt_field(row["nome"]) or "").strip().split())
        address = str(decrypt_field(row["endereco"]) or "").strip() or None
        email = _normalize_email(decrypt_field(row["email"]))

        bind.execute(
            sa.text(
                """
                UPDATE clientes
                SET telefone = :telefone,
                    telefone_hash = :telefone_hash,
                    nome = :nome,
                    endereco = :endereco,
                    email = :email,
                    email_hash = :email_hash
                WHERE id = :id AND restaurante_id = :restaurante_id
                """
            ),
            {
                "id": row["id"],
                "restaurante_id": rid,
                "telefone": encrypt_field(phone),
                "telefone_hash": _customer_phone_hash(rid, phone),
                "nome": encrypt_field(name),
                "endereco": encrypt_field(address),
                "email": encrypt_field(email),
                "email_hash": _customer_email_hash(rid, email),
            },
        )


def _backfill_registration_challenge_pii(bind) -> None:
    rows = bind.execute(
        sa.text(
            """
            SELECT id, restaurante_id, nome, email, telefone, endereco
            FROM customer_registration_challenges
            """
        )
    ).mappings().all()
    for row in rows:
        rid = int(row["restaurante_id"])
        name = " ".join(str(decrypt_field(row["nome"]) or "").strip().split())
        email = _normalize_email(decrypt_field(row["email"]))
        phone = _normalize_phone(str(decrypt_field(row["telefone"]) or ""))
        address = str(decrypt_field(row["endereco"]) or "").strip() or None
        if not email:
            raise RuntimeError(
                "Migração de PII bloqueada: desafio de cadastro sem e-mail "
                f"(id={row['id']})."
            )
        bind.execute(
            sa.text(
                """
                UPDATE customer_registration_challenges
                SET nome = :nome,
                    email = :email,
                    email_hash = :email_hash,
                    telefone = :telefone,
                    endereco = :endereco
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "nome": encrypt_field(name),
                "email": encrypt_field(email),
                "email_hash": _customer_email_hash(rid, email),
                "telefone": encrypt_field(phone),
                "endereco": encrypt_field(address),
            },
        )


def _decrypt_for_downgrade(bind) -> None:
    customer_rows = bind.execute(
        sa.text(
            "SELECT id, restaurante_id, telefone, nome, endereco, email FROM clientes"
        )
    ).mappings().all()
    for row in customer_rows:
        bind.execute(
            sa.text(
                """
                UPDATE clientes
                SET telefone = :telefone,
                    nome = :nome,
                    endereco = :endereco,
                    email = :email
                WHERE id = :id AND restaurante_id = :restaurante_id
                """
            ),
            {
                "id": row["id"],
                "restaurante_id": row["restaurante_id"],
                "telefone": decrypt_field(row["telefone"]),
                "nome": decrypt_field(row["nome"]),
                "endereco": decrypt_field(row["endereco"]),
                "email": decrypt_field(row["email"]),
            },
        )

    challenge_rows = bind.execute(
        sa.text(
            "SELECT id, nome, email, telefone, endereco "
            "FROM customer_registration_challenges"
        )
    ).mappings().all()
    for row in challenge_rows:
        bind.execute(
            sa.text(
                """
                UPDATE customer_registration_challenges
                SET nome = :nome,
                    email = :email,
                    telefone = :telefone,
                    endereco = :endereco
                WHERE id = :id
                """
            ),
            {
                "id": row["id"],
                "nome": decrypt_field(row["nome"]),
                "email": decrypt_field(row["email"]),
                "telefone": decrypt_field(row["telefone"]),
                "endereco": decrypt_field(row["endereco"]),
            },
        )


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    customer_columns = {column["name"] for column in inspector.get_columns("clientes")}
    with op.batch_alter_table("clientes") as batch:
        if "telefone_hash" not in customer_columns:
            batch.add_column(sa.Column("telefone_hash", sa.String(64), nullable=True))
        if "email_hash" not in customer_columns:
            batch.add_column(sa.Column("email_hash", sa.String(64), nullable=True))

    challenge_columns = {
        column["name"]
        for column in inspector.get_columns("customer_registration_challenges")
    }
    with op.batch_alter_table("customer_registration_challenges") as batch:
        if "email_hash" not in challenge_columns:
            batch.add_column(sa.Column("email_hash", sa.String(64), nullable=True))

    if bind.dialect.name == "postgresql":
        for column in ("telefone", "nome", "endereco", "email"):
            op.alter_column("clientes", column, type_=sa.Text(), existing_nullable=(column == "endereco" or column == "email"))
        for column in ("nome", "email", "telefone", "endereco"):
            op.alter_column(
                "customer_registration_challenges",
                column,
                type_=sa.Text(),
                existing_nullable=(column == "endereco"),
            )

    _assert_no_blind_index_collisions(bind)
    _backfill_customer_pii(bind)
    _backfill_registration_challenge_pii(bind)

    inspector = sa.inspect(bind)
    customer_constraints = {
        item["name"] for item in inspector.get_unique_constraints("clientes")
    }
    with op.batch_alter_table("clientes") as batch:
        if "uq_restaurante_cliente_telefone" in customer_constraints:
            batch.drop_constraint("uq_restaurante_cliente_telefone", type_="unique")
        if "uq_restaurante_cliente_email" in customer_constraints:
            batch.drop_constraint("uq_restaurante_cliente_email", type_="unique")
        batch.alter_column(
            "telefone_hash",
            existing_type=sa.String(64),
            nullable=False,
        )
        batch.create_unique_constraint(
            "uq_restaurante_cliente_telefone",
            ["restaurante_id", "telefone_hash"],
        )
        batch.create_unique_constraint(
            "uq_restaurante_cliente_email",
            ["restaurante_id", "email_hash"],
        )

    inspector = sa.inspect(bind)
    customer_indexes = {item["name"] for item in inspector.get_indexes("clientes")}
    if "ix_clientes_email" in customer_indexes:
        op.drop_index("ix_clientes_email", table_name="clientes")

    challenge_constraints = {
        item["name"]
        for item in sa.inspect(bind).get_unique_constraints(
            "customer_registration_challenges"
        )
    }
    with op.batch_alter_table("customer_registration_challenges") as batch:
        if "uq_customer_registration_challenges_tenant_email" in challenge_constraints:
            batch.drop_constraint(
                "uq_customer_registration_challenges_tenant_email",
                type_="unique",
            )
        batch.alter_column(
            "email_hash",
            existing_type=sa.String(64),
            nullable=False,
        )
        batch.create_unique_constraint(
            "uq_customer_registration_challenges_tenant_email",
            ["restaurante_id", "email_hash"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    _decrypt_for_downgrade(bind)

    customer_constraints = {
        item["name"] for item in sa.inspect(bind).get_unique_constraints("clientes")
    }
    with op.batch_alter_table("clientes") as batch:
        if "uq_restaurante_cliente_telefone" in customer_constraints:
            batch.drop_constraint("uq_restaurante_cliente_telefone", type_="unique")
        if "uq_restaurante_cliente_email" in customer_constraints:
            batch.drop_constraint("uq_restaurante_cliente_email", type_="unique")
        batch.create_unique_constraint(
            "uq_restaurante_cliente_telefone",
            ["restaurante_id", "telefone"],
        )
        batch.create_unique_constraint(
            "uq_restaurante_cliente_email",
            ["restaurante_id", "email"],
        )
        batch.drop_column("telefone_hash")
        batch.drop_column("email_hash")

    if "ix_clientes_email" not in {
        item["name"] for item in sa.inspect(bind).get_indexes("clientes")
    }:
        op.create_index("ix_clientes_email", "clientes", ["email"], unique=False)

    challenge_constraints = {
        item["name"]
        for item in sa.inspect(bind).get_unique_constraints(
            "customer_registration_challenges"
        )
    }
    with op.batch_alter_table("customer_registration_challenges") as batch:
        if "uq_customer_registration_challenges_tenant_email" in challenge_constraints:
            batch.drop_constraint(
                "uq_customer_registration_challenges_tenant_email",
                type_="unique",
            )
        batch.create_unique_constraint(
            "uq_customer_registration_challenges_tenant_email",
            ["restaurante_id", "email"],
        )
        batch.drop_column("email_hash")
