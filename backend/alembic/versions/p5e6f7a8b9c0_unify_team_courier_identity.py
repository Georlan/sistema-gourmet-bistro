"""Unify team and courier identities with tenant-scoped operational profiles.

Revision ID: p5e6f7a8b9c0
Revises: o4d5e6f7a8b9
Create Date: 2026-09-25
"""

import datetime
import re
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text


revision: str = "p5e6f7a8b9c0"
down_revision: Union[str, Sequence[str], None] = "o4d5e6f7a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _clean_phone(phone: Union[str, None]) -> str:
    return re.sub(r"\D", "", phone or "")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    motoboy_cols = {col["name"] for col in inspector.get_columns("motoboys")}

    if "usuario_id" not in motoboy_cols:
        with op.batch_alter_table("motoboys") as batch_op:
            batch_op.add_column(
                sa.Column("usuario_id", sa.String(length=36), nullable=True)
            )

    # -------------------------------------------------------------------------
    # Reconciliação segura de dados existentes
    # -------------------------------------------------------------------------
    users_rows = bind.execute(
        text(
            "SELECT id, restaurante_id, nome, telefone, cargo, status "
            "FROM usuarios WHERE cargo = 'motoboy'"
        )
    ).fetchall()

    motoboys_rows = bind.execute(
        text(
            "SELECT id, restaurante_id, nome, telefone, ativo, usuario_id "
            "FROM motoboys"
        )
    ).fetchall()

    # Mapeamentos tenant-scoped
    motoboys_by_id = {row.id: dict(row._mapping) for row in motoboys_rows}
    
    # 1. Vincular Usuários (cargo=motoboy) existentes a seus perfis de Motoboy
    for u in users_rows:
        u_dict = dict(u._mapping)
        u_id = u_dict["id"]
        u_rest_id = u_dict["restaurante_id"]
        u_phone_clean = _clean_phone(u_dict["telefone"])

        # Candidatos no mesmo restaurante
        matching_mbs = [
            m for m in motoboys_by_id.values()
            if m["restaurante_id"] == u_rest_id
            and (m["usuario_id"] is None or m["usuario_id"] == u_id)
            and u_phone_clean
            and _clean_phone(m["telefone"]) == u_phone_clean
        ]

        if len(matching_mbs) == 1:
            matched_mb = matching_mbs[0]
            matched_mb["usuario_id"] = u_id
            bind.execute(
                text(
                    "UPDATE motoboys SET usuario_id = :u_id WHERE id = :m_id"
                ),
                {"u_id": u_id, "m_id": matched_mb["id"]},
            )
        elif len(matching_mbs) == 0:
            # Usuário da equipe sem nenhum perfil operacional: provisiona perfil
            is_active = (u_dict.get("status") or "ativo") != "inativo"
            bind.execute(
                text(
                    "INSERT INTO motoboys (restaurante_id, usuario_id, nome, telefone, ativo) "
                    "VALUES (:rest_id, :u_id, :nome, :telefone, :ativo)"
                ),
                {
                    "rest_id": u_rest_id,
                    "u_id": u_id,
                    "nome": u_dict["nome"],
                    "telefone": u_dict["telefone"] or "",
                    "ativo": is_active,
                },
            )

    # 2. Para motoboys legados que ainda estão sem usuario_id
    updated_motoboys = bind.execute(
        text("SELECT id, restaurante_id, nome, telefone, ativo, usuario_id FROM motoboys WHERE usuario_id IS NULL")
    ).fetchall()

    for m in updated_motoboys:
        m_dict = dict(m._mapping)
        m_id = m_dict["id"]
        m_rest_id = m_dict["restaurante_id"]
        m_phone_clean = _clean_phone(m_dict["telefone"])

        if not m_phone_clean or len(m_phone_clean) < 10:
            # Telefone ausente ou incompleto: preserva registro sem adivinhar
            continue

        existing_user = bind.execute(
            text(
                "SELECT id, cargo, status FROM usuarios "
                "WHERE restaurante_id = :rest_id AND telefone = :tel"
            ),
            {"rest_id": m_rest_id, "tel": m_phone_clean},
        ).fetchone()

        if existing_user:
            eu_dict = dict(existing_user._mapping)
            if eu_dict["cargo"] == "motoboy":
                # Já existe o usuário correspondente: vincula se não ocupado
                already_linked = bind.execute(
                    text(
                        "SELECT 1 FROM motoboys "
                        "WHERE restaurante_id = :rest_id AND usuario_id = :u_id"
                    ),
                    {"rest_id": m_rest_id, "u_id": eu_dict["id"]},
                ).fetchone()
                if not already_linked:
                    bind.execute(
                        text("UPDATE motoboys SET usuario_id = :u_id WHERE id = :m_id"),
                        {"u_id": eu_dict["id"], "m_id": m_id},
                    )
            # Se for outro cargo, preserva sem colidir
        else:
            # Telefone livre: provisiona identidade na equipe
            new_u_id = str(uuid.uuid4())[:8]
            token_convite = str(uuid.uuid4())
            now_utc = datetime.datetime.now(datetime.timezone.utc)
            token_exp = now_utc + datetime.timedelta(hours=24)
            u_status = "ativo" if m_dict.get("ativo", True) else "inativo"

            bind.execute(
                text(
                    "INSERT INTO usuarios "
                    "(id, nome, telefone, email, cargo, restaurante_id, senha_hash, "
                    "token_convite, token_expira_em, status, created_at) "
                    "VALUES (:id, :nome, :tel, NULL, 'motoboy', :rest_id, NULL, "
                    ":tok, :tok_exp, :status, :created_at)"
                ),
                {
                    "id": new_u_id,
                    "nome": m_dict["nome"],
                    "tel": m_phone_clean,
                    "rest_id": m_rest_id,
                    "tok": token_convite,
                    "tok_exp": token_exp,
                    "status": u_status,
                    "created_at": now_utc,
                },
            )
            bind.execute(
                text("UPDATE motoboys SET usuario_id = :u_id WHERE id = :m_id"),
                {"u_id": new_u_id, "m_id": m_id},
            )

    # 3. Adicionar constraints e índices
    with op.batch_alter_table("motoboys") as batch_op:
        batch_op.create_foreign_key(
            "fk_motoboys_usuario_id",
            "usuarios",
            ["usuario_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_unique_constraint(
            "uq_motoboys_restaurante_usuario",
            ["restaurante_id", "usuario_id"],
        )
        batch_op.create_index(
            "ix_motoboys_usuario_id",
            ["usuario_id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("motoboys") as batch_op:
        batch_op.drop_index("ix_motoboys_usuario_id")
        batch_op.drop_constraint("uq_motoboys_restaurante_usuario", type_="unique")
        batch_op.drop_constraint("fk_motoboys_usuario_id", type_="foreignkey")
        batch_op.drop_column("usuario_id")
