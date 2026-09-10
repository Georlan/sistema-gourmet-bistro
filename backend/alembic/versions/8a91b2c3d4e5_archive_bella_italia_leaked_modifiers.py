"""archive leaked Bella Italia modifier presets

Revision ID: 8a91b2c3d4e5
Revises: 7f8091a2b3c4
Create Date: 2026-09-10 10:50:00.000000

Reparo de dados estritamente delimitado ao tenant #2. Os grupos não são apagados
porque já existem referências em pedidos cancelados; eles ficam arquivados para
preservar integridade e histórico, mas deixam de fazer parte da configuração ativa.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "8a91b2c3d4e5"
down_revision = "7f8091a2b3c4"
branch_labels = None
depends_on = None

TENANT_ID = 2
CATEGORY_ID = "cat-2-hamburgueres"
CATEGORY_NAME = "Hambúrgueres"
ARCHIVED_TYPE = "__archived__"
TARGET_GROUPS = {
    "gmod-2-carnes-proteinas": "Carnes e Proteínas",
    "gmod-2-molhos-sabores": "Molhos e Sabores",
    "gmod-2-paes": "Pães",
    "gmod-2-queijos-cremosos": "Queijos e Cremosos",
    "gmod-2-vegetais-extras": "Vegetais e Extras",
}


def _scalar(bind, sql: str, params: dict | None = None) -> int:
    value = bind.execute(sa.text(sql), params or {}).scalar_one()
    return int(value or 0)


def upgrade() -> None:
    bind = op.get_bind()

    # Em bancos vazios de CI/teste o tenant não existe: a migration é no-op.
    restaurant_count = _scalar(
        bind,
        "SELECT count(*) FROM restaurantes WHERE id = :tenant_id",
        {"tenant_id": TENANT_ID},
    )
    if restaurant_count == 0:
        return

    group_ids = tuple(TARGET_GROUPS.keys())
    placeholders = ", ".join(f":g{i}" for i in range(len(group_ids)))
    params = {"tenant_id": TENANT_ID, **{f"g{i}": gid for i, gid in enumerate(group_ids)}}

    category_rows = bind.execute(
        sa.text(
            "SELECT id, nome FROM categorias "
            "WHERE restaurante_id = :tenant_id AND id = :category_id"
        ),
        {"tenant_id": TENANT_ID, "category_id": CATEGORY_ID},
    ).mappings().all()
    groups = bind.execute(
        sa.text(
            f"SELECT id, nome, tipo FROM grupo_modificadores "
            f"WHERE restaurante_id = :tenant_id AND id IN ({placeholders}) ORDER BY id"
        ),
        params,
    ).mappings().all()

    # Se a árvore alvo já não existe, não inventamos nada nem tocamos no tenant.
    if not category_rows and not groups:
        return

    # Reexecução externa segura: categoria já saiu e os cinco grupos já estão tombstoned.
    if (
        not category_rows
        and len(groups) == len(TARGET_GROUPS)
        and all(str(row["tipo"]) == ARCHIVED_TYPE for row in groups)
    ):
        return

    if len(category_rows) != 1 or str(category_rows[0]["nome"]) != CATEGORY_NAME:
        raise RuntimeError("Reparo Bella Italia abortado: categoria alvo não corresponde ao snapshot esperado.")

    if len(groups) != len(TARGET_GROUPS):
        raise RuntimeError("Reparo Bella Italia abortado: conjunto de grupos alvo está incompleto.")
    for row in groups:
        expected_name = TARGET_GROUPS.get(str(row["id"]))
        if expected_name is None or str(row["nome"]) != expected_name:
            raise RuntimeError("Reparo Bella Italia abortado: nome/ID de grupo divergiu do snapshot esperado.")

    category_products = _scalar(
        bind,
        "SELECT count(*) FROM produtos WHERE restaurante_id = :tenant_id AND categoria_id = :category_id",
        {"tenant_id": TENANT_ID, "category_id": CATEGORY_ID},
    )
    category_observations = _scalar(
        bind,
        "SELECT count(*) FROM observacoes_predefinidas WHERE restaurante_id = :tenant_id AND categoria_id = :category_id",
        {"tenant_id": TENANT_ID, "category_id": CATEGORY_ID},
    )
    direct_product_links = _scalar(
        bind,
        f"SELECT count(*) FROM produto_grupo_modificadores "
        f"WHERE restaurante_id = :tenant_id AND grupo_id IN ({placeholders})",
        params,
    )
    target_category_links = _scalar(
        bind,
        f"SELECT count(*) FROM categoria_grupo_modificadores "
        f"WHERE restaurante_id = :tenant_id AND categoria_id = :category_id "
        f"AND grupo_id IN ({placeholders})",
        {**params, "category_id": CATEGORY_ID},
    )
    other_category_links = _scalar(
        bind,
        f"SELECT count(*) FROM categoria_grupo_modificadores "
        f"WHERE restaurante_id = :tenant_id AND categoria_id <> :category_id "
        f"AND grupo_id IN ({placeholders})",
        {**params, "category_id": CATEGORY_ID},
    )
    historical_uses = _scalar(
        bind,
        f"SELECT count(*) FROM item_modificadores im "
        f"JOIN opcao_modificadores om "
        f"ON om.restaurante_id = im.restaurante_id AND om.id = im.opcao_modificador_id "
        f"WHERE im.restaurante_id = :tenant_id AND om.grupo_id IN ({placeholders})",
        params,
    )

    if category_products != 0 or category_observations != 0:
        raise RuntimeError("Reparo Bella Italia abortado: a categoria órfã ganhou produtos ou observações.")
    if direct_product_links != 0:
        raise RuntimeError("Reparo Bella Italia abortado: um grupo alvo ganhou vínculo direto com produto.")
    if target_category_links != len(TARGET_GROUPS) or other_category_links != 0:
        raise RuntimeError("Reparo Bella Italia abortado: vínculos de categoria divergiram do snapshot esperado.")

    # Preserva as opções e os grupos para que pedidos históricos continuem íntegros.
    # O tombstone tira os grupos da configuração ativa; as opções também são desativadas
    # como defesa adicional caso algum consumidor legado tente resolvê-las diretamente.
    bind.execute(
        sa.text(
            f"UPDATE opcao_modificadores SET ativo = false "
            f"WHERE restaurante_id = :tenant_id AND grupo_id IN ({placeholders})"
        ),
        params,
    )
    bind.execute(
        sa.text(
            f"UPDATE grupo_modificadores SET tipo = :archived_type "
            f"WHERE restaurante_id = :tenant_id AND id IN ({placeholders})"
        ),
        {**params, "archived_type": ARCHIVED_TYPE},
    )
    bind.execute(
        sa.text(
            f"DELETE FROM categoria_grupo_modificadores "
            f"WHERE restaurante_id = :tenant_id AND categoria_id = :category_id "
            f"AND grupo_id IN ({placeholders})"
        ),
        {**params, "category_id": CATEGORY_ID},
    )
    bind.execute(
        sa.text(
            "DELETE FROM categorias "
            "WHERE restaurante_id = :tenant_id AND id = :category_id"
        ),
        {"tenant_id": TENANT_ID, "category_id": CATEGORY_ID},
    )

    if bind.dialect.name == "postgresql":
        bind.execute(
            sa.text("SELECT set_config('app.current_restaurante_id', :tenant_id, true)"),
            {"tenant_id": str(TENANT_ID)},
        )

    audit = sa.table(
        "super_admin_audit_logs",
        sa.column("restaurante_id", sa.Integer()),
        sa.column("actor", sa.String()),
        sa.column("action", sa.String()),
        sa.column("reason", sa.Text()),
        sa.column("before_data", sa.JSON()),
        sa.column("after_data", sa.JSON()),
    )
    bind.execute(
        audit.insert().values(
            restaurante_id=TENANT_ID,
            actor="system:data-repair",
            action="DATA_REPAIR_ARCHIVE_LEAKED_MODIFIERS",
            reason=(
                "Remoção da configuração ativa de presets de hamburgueria vazados "
                "indevidamente para a Pizzeria Bella Italia (#2)."
            ),
            before_data={
                "categoria_id": CATEGORY_ID,
                "grupo_ids": list(group_ids),
                "historical_item_modifier_references": historical_uses,
            },
            after_data={
                "categoria_removida": True,
                "grupos_arquivados": list(group_ids),
                "opcoes_desativadas": True,
                "historico_preservado": True,
            },
        )
    )


def downgrade() -> None:
    # Reparo de produção deliberadamente não recria dados vazados em downgrade.
    pass
