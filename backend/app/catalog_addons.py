"""Categoria hierárquica e resolução canônica de complementos do catálogo.

Este módulo mantém os vínculos por categoria separados do cadastro de produtos:
- CategoriaRelacao representa a árvore lógica sem mover produtos de categoria.
- CategoriaGrupoModificador permite herdar grupos para subcategorias.
- effective_modifier_payloads_by_product é a única resolução usada pelos canais.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Iterable, Sequence

from sqlalchemy import Boolean, Column, ForeignKey, ForeignKeyConstraint, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Session

from .database import Base, current_restaurante_id
from .models import Categoria, GrupoModificador, OpcaoModificador, Produto, ProdutoGrupoModificador


class CategoriaRelacao(Base):
    __tablename__ = "categoria_relacoes"
    __table_args__ = (
        UniqueConstraint(
            "restaurante_id",
            "categoria_id",
            name="uq_categoria_relacoes_tenant_child",
        ),
        ForeignKeyConstraint(
            ["restaurante_id", "categoria_id"],
            ["categorias.restaurante_id", "categorias.id"],
            name="fk_categoria_relacoes_child_tenant",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["restaurante_id", "categoria_pai_id"],
            ["categorias.restaurante_id", "categorias.id"],
            name="fk_categoria_relacoes_parent_tenant",
            ondelete="CASCADE",
        ),
        Index(
            "ix_categoria_relacoes_tenant_parent",
            "restaurante_id",
            "categoria_pai_id",
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    categoria_id = Column(String, nullable=False)
    categoria_pai_id = Column(String, nullable=False)


class CategoriaGrupoModificador(Base):
    __tablename__ = "categoria_grupo_modificadores"
    __table_args__ = (
        UniqueConstraint(
            "restaurante_id",
            "categoria_id",
            "grupo_id",
            name="uq_categoria_grupo_modificadores_tenant",
        ),
        ForeignKeyConstraint(
            ["restaurante_id", "categoria_id"],
            ["categorias.restaurante_id", "categorias.id"],
            name="fk_categoria_grupo_categoria_tenant",
            ondelete="CASCADE",
        ),
        Index(
            "ix_categoria_grupo_tenant_categoria",
            "restaurante_id",
            "categoria_id",
        ),
        Index(
            "ix_categoria_grupo_tenant_grupo",
            "restaurante_id",
            "grupo_id",
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    restaurante_id = Column(
        Integer,
        ForeignKey("restaurantes.id", ondelete="CASCADE"),
        default=lambda: current_restaurante_id.get(),
        nullable=False,
        index=True,
    )
    categoria_id = Column(String, nullable=False)
    grupo_id = Column(
        String,
        ForeignKey("grupo_modificadores.id", ondelete="CASCADE"),
        nullable=False,
    )
    incluir_subcategorias = Column(Boolean, nullable=False, default=True)


def normalize_catalog_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    ascii_value = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "-", ascii_value.casefold()).strip("-")


def category_parent_map(db: Session, restaurante_id: int) -> dict[str, str]:
    rows = (
        db.query(CategoriaRelacao)
        .filter(CategoriaRelacao.restaurante_id == restaurante_id)
        .all()
    )
    return {str(row.categoria_id): str(row.categoria_pai_id) for row in rows}


def category_lineage(category_id: str, parents: dict[str, str]) -> tuple[str, ...]:
    """Retorna categoria atual + ancestrais, protegendo contra ciclos legados."""
    lineage: list[str] = []
    current = str(category_id)
    visited: set[str] = set()
    while current and current not in visited:
        visited.add(current)
        lineage.append(current)
        current = parents.get(current, "")
    return tuple(lineage)


def effective_modifier_group_ids_by_product(
    db: Session,
    restaurante_id: int,
    products: Sequence[Produto] | None = None,
) -> dict[str, tuple[str, ...]]:
    """Resolve vínculos diretos + categoria + ancestrais em uma única regra canônica."""
    if products is None:
        products = (
            db.query(Produto)
            .filter(Produto.restaurante_id == restaurante_id)
            .all()
        )

    product_ids = [str(product.id) for product in products]
    direct_by_product: dict[str, list[str]] = {}
    if product_ids:
        direct_rows = (
            db.query(ProdutoGrupoModificador)
            .filter(
                ProdutoGrupoModificador.restaurante_id == restaurante_id,
                ProdutoGrupoModificador.produto_id.in_(product_ids),
            )
            .all()
        )
        for row in direct_rows:
            direct_by_product.setdefault(str(row.produto_id), []).append(str(row.grupo_id))

    category_links = (
        db.query(CategoriaGrupoModificador)
        .filter(CategoriaGrupoModificador.restaurante_id == restaurante_id)
        .all()
    )
    links_by_category: dict[str, list[CategoriaGrupoModificador]] = {}
    for link in category_links:
        links_by_category.setdefault(str(link.categoria_id), []).append(link)

    parents = category_parent_map(db, restaurante_id)
    resolved: dict[str, tuple[str, ...]] = {}
    for product in products:
        ordered: list[str] = []
        seen: set[str] = set()

        for group_id in direct_by_product.get(str(product.id), []):
            if group_id not in seen:
                seen.add(group_id)
                ordered.append(group_id)

        lineage = category_lineage(str(product.categoria_id), parents)
        for index, category_id in enumerate(lineage):
            for link in links_by_category.get(category_id, []):
                if index > 0 and not bool(link.incluir_subcategorias):
                    continue
                group_id = str(link.grupo_id)
                if group_id not in seen:
                    seen.add(group_id)
                    ordered.append(group_id)

        resolved[str(product.id)] = tuple(ordered)
    return resolved


def effective_modifier_payloads_by_product(
    db: Session,
    restaurante_id: int,
    products: Sequence[Produto] | None = None,
) -> dict[str, list[dict]]:
    """Serializa os grupos efetivos usando os mesmos IDs em todos os canais."""
    if products is None:
        products = (
            db.query(Produto)
            .filter(Produto.restaurante_id == restaurante_id)
            .all()
        )
    products = list(products)
    groups_by_product = effective_modifier_group_ids_by_product(
        db,
        restaurante_id,
        products,
    )

    needed_group_ids = {
        group_id
        for group_ids in groups_by_product.values()
        for group_id in group_ids
    }
    if not needed_group_ids:
        return {str(product.id): [] for product in products}

    groups = (
        db.query(GrupoModificador)
        .filter(
            GrupoModificador.restaurante_id == restaurante_id,
            GrupoModificador.id.in_(needed_group_ids),
        )
        .all()
    )
    options = (
        db.query(OpcaoModificador)
        .filter(
            OpcaoModificador.restaurante_id == restaurante_id,
            OpcaoModificador.grupo_id.in_(needed_group_ids),
            OpcaoModificador.ativo.is_(True),
        )
        .all()
    )

    options_by_group: dict[str, list[dict]] = {}
    for option in options:
        options_by_group.setdefault(str(option.grupo_id), []).append(
            {
                "id": option.id,
                "grupo_id": option.grupo_id,
                "nome": option.nome,
                "preco_adicional": float(option.preco_adicional or 0.0),
                "ativo": bool(option.ativo),
            }
        )
    for group_options in options_by_group.values():
        group_options.sort(key=lambda item: (normalize_catalog_name(item["nome"]), item["id"]))

    group_payload = {
        str(group.id): {
            "id": group.id,
            "nome": group.nome,
            "min_selecoes": int(group.min_selecoes or 0),
            "max_selecoes": int(group.max_selecoes or 1),
            "tipo": group.tipo,
            "opcoes": options_by_group.get(str(group.id), []),
        }
        for group in groups
    }

    return {
        str(product.id): [
            group_payload[group_id]
            for group_id in groups_by_product.get(str(product.id), ())
            if group_id in group_payload
        ]
        for product in products
    }


def replace_category_links_for_group(
    db: Session,
    *,
    restaurante_id: int,
    grupo_id: str,
    categoria_ids: Iterable[str],
    incluir_subcategorias: bool = True,
) -> None:
    normalized_ids = list(dict.fromkeys(str(item).strip() for item in categoria_ids if str(item).strip()))
    if normalized_ids:
        existing_count = (
            db.query(Categoria)
            .filter(
                Categoria.restaurante_id == restaurante_id,
                Categoria.id.in_(normalized_ids),
            )
            .count()
        )
        if existing_count != len(normalized_ids):
            raise ValueError("Uma ou mais categorias não pertencem ao restaurante ativo.")

    db.query(CategoriaGrupoModificador).filter(
        CategoriaGrupoModificador.restaurante_id == restaurante_id,
        CategoriaGrupoModificador.grupo_id == grupo_id,
    ).delete(synchronize_session=False)
    for category_id in normalized_ids:
        db.add(
            CategoriaGrupoModificador(
                restaurante_id=restaurante_id,
                categoria_id=category_id,
                grupo_id=grupo_id,
                incluir_subcategorias=incluir_subcategorias,
            )
        )


def category_hierarchy_payload(db: Session, restaurante_id: int) -> list[dict]:
    categories = (
        db.query(Categoria)
        .filter(Categoria.restaurante_id == restaurante_id)
        .all()
    )
    parents = category_parent_map(db, restaurante_id)
    return [
        {
            "id": category.id,
            "nome": category.nome,
            "destino_impressao": category.destino_impressao,
            "parent_id": parents.get(str(category.id)),
        }
        for category in sorted(categories, key=lambda item: (normalize_catalog_name(item.nome), str(item.id)))
    ]


@dataclass(frozen=True)
class SuggestedModifierGroup:
    slug: str
    name: str
    max_selections: int
    options: tuple[tuple[str, float], ...]


HAMBURGER_ADDON_SUGGESTIONS: tuple[SuggestedModifierGroup, ...] = (
    SuggestedModifierGroup(
        "queijos-cremosos",
        "Queijos e Cremosos",
        4,
        (
            ("Queijo Coalho", 4.0),
            ("Mussarela Derretida", 8.0),
            ("Cream Cheese Original", 4.0),
            ("Cheddar Cremoso", 3.0),
            ("Catupiry Original", 4.0),
        ),
    ),
    SuggestedModifierGroup(
        "carnes-proteinas",
        "Carnes e Proteínas",
        4,
        (
            ("Presunto", 4.0),
            ("Ovos", 3.0),
            ("Hambúrguer Frango", 8.0),
            ("Hambúrguer Bovino", 8.0),
            ("Cupim Desfiado", 10.0),
            ("Calabresa", 4.0),
            ("Bacon Fatiado", 4.0),
            ("Bacon Cubos", 4.0),
        ),
    ),
    SuggestedModifierGroup(
        "molhos-sabores",
        "Molhos e Sabores",
        2,
        (("Molho de Alho", 3.0), ("Geleia de Pimenta", 3.0)),
    ),
    SuggestedModifierGroup(
        "vegetais-extras",
        "Vegetais e Extras",
        4,
        (
            ("Picles", 3.0),
            ("Milho Verde", 2.0),
            ("Cebola Caramelizada", 3.0),
            ("Azeitona Fatiada", 2.0),
        ),
    ),
    SuggestedModifierGroup(
        "paes",
        "Pães",
        2,
        (("Pão Brioche Hambúrguer", 3.0), ("Pão Brioche Baguete", 6.0)),
    ),
)


def _hamburger_category(category: Categoria) -> bool:
    normalized = normalize_catalog_name(category.nome)
    return "hamburg" in normalized or "burger" in normalized


def ensure_hamburger_addon_suggestions(db: Session, restaurante_id: int) -> dict:
    """Provisiona sugestões sem apagar customizações e sem duplicar reexecuções."""
    categories = (
        db.query(Categoria)
        .filter(Categoria.restaurante_id == restaurante_id)
        .all()
    )
    parent = next(
        (category for category in categories if normalize_catalog_name(category.nome) == "hamburgueres"),
        None,
    )
    created_parent = False
    if parent is None:
        parent = Categoria(
            id=f"cat-{restaurante_id}-hamburgueres",
            restaurante_id=restaurante_id,
            nome="Hambúrgueres",
            destino_impressao="COZINHA",
        )
        db.add(parent)
        db.flush()
        categories.append(parent)
        created_parent = True

    linked_children = 0
    preserved_parent_links = 0
    for category in categories:
        if category.id == parent.id or not _hamburger_category(category):
            continue
        relation = (
            db.query(CategoriaRelacao)
            .filter(
                CategoriaRelacao.restaurante_id == restaurante_id,
                CategoriaRelacao.categoria_id == category.id,
            )
            .first()
        )
        if relation is None:
            db.add(
                CategoriaRelacao(
                    restaurante_id=restaurante_id,
                    categoria_id=category.id,
                    categoria_pai_id=parent.id,
                )
            )
            linked_children += 1
        elif relation.categoria_pai_id == parent.id:
            continue
        else:
            # Não destrói uma hierarquia criada manualmente.
            preserved_parent_links += 1

    created_groups = 0
    created_options = 0
    updated_options = 0
    group_ids: list[str] = []
    existing_groups = (
        db.query(GrupoModificador)
        .filter(GrupoModificador.restaurante_id == restaurante_id)
        .all()
    )
    for suggestion in HAMBURGER_ADDON_SUGGESTIONS:
        group = next(
            (
                existing
                for existing in existing_groups
                if normalize_catalog_name(existing.nome) == normalize_catalog_name(suggestion.name)
            ),
            None,
        )
        if group is None:
            group = GrupoModificador(
                id=f"gmod-{restaurante_id}-{suggestion.slug}",
                restaurante_id=restaurante_id,
                nome=suggestion.name,
                min_selecoes=0,
                max_selecoes=suggestion.max_selections,
                tipo="opcional",
            )
            db.add(group)
            db.flush()
            existing_groups.append(group)
            created_groups += 1
        else:
            group.min_selecoes = 0
            group.max_selecoes = suggestion.max_selections
            group.tipo = "opcional"
        group_ids.append(str(group.id))

        current_options = (
            db.query(OpcaoModificador)
            .filter(
                OpcaoModificador.restaurante_id == restaurante_id,
                OpcaoModificador.grupo_id == group.id,
            )
            .all()
        )
        by_name = {normalize_catalog_name(option.nome): option for option in current_options}
        for option_name, price in suggestion.options:
            option = by_name.get(normalize_catalog_name(option_name))
            if option is None:
                db.add(
                    OpcaoModificador(
                        id=(
                            f"opmod-{restaurante_id}-{suggestion.slug}-"
                            f"{normalize_catalog_name(option_name)}"
                        ),
                        restaurante_id=restaurante_id,
                        grupo_id=group.id,
                        nome=option_name,
                        preco_adicional=price,
                        ativo=True,
                    )
                )
                created_options += 1
            else:
                changed = float(option.preco_adicional or 0.0) != float(price) or not bool(option.ativo)
                option.preco_adicional = price
                option.ativo = True
                if changed:
                    updated_options += 1

        category_link = (
            db.query(CategoriaGrupoModificador)
            .filter(
                CategoriaGrupoModificador.restaurante_id == restaurante_id,
                CategoriaGrupoModificador.categoria_id == parent.id,
                CategoriaGrupoModificador.grupo_id == group.id,
            )
            .first()
        )
        if category_link is None:
            db.add(
                CategoriaGrupoModificador(
                    restaurante_id=restaurante_id,
                    categoria_id=parent.id,
                    grupo_id=group.id,
                    incluir_subcategorias=True,
                )
            )
        else:
            category_link.incluir_subcategorias = True

    db.flush()
    return {
        "categoria_pai": {"id": parent.id, "nome": parent.nome, "criada": created_parent},
        "subcategorias_vinculadas": linked_children,
        "subcategorias_preservadas": preserved_parent_links,
        "grupos_criados": created_groups,
        "opcoes_criadas": created_options,
        "opcoes_atualizadas": updated_options,
        "grupo_ids": group_ids,
        "total_sugestoes": sum(len(group.options) for group in HAMBURGER_ADDON_SUGGESTIONS),
    }
