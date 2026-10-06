"""Consumo de complementos pela entrada do pedido. Somente leitura.

Modelo persistido (fonte de verdade histórica):
- ``itens``: uma linha por unidade vendida (``OrderService`` expande ``quantity``),
  portanto 3 × Quentinha G = 3 linhas de ``Item``;
- ``item_modificadores``: uma linha por opção escolhida em cada unidade, com o
  ``opcao_modificador_id`` estável e o ``preco_aplicado`` congelado.

Logo, ``COUNT(item_modificadores)`` já respeita a quantidade do item pai e uma
opção repetida na mesma unidade, sem multiplicação arbitrária.

Limitação conhecida: o pedido não congela nome da opção nem o grupo. O grupo e o
nome exibidos vêm do cadastro atual pelo ID estável (opções e grupos são apenas
arquivados, nunca apagados quando há histórico). Uma opção renomeada aparece com o
nome atual, sem perder as seleções anteriores.

A agregação preserva ``produto → grupo → opção → quantidade`` para o futuro custo
médio ponderado/CMV por produto.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Optional

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from ..catalog_addons import CategoriaGrupoModificador
from ..models import GrupoModificador, Item, ItemModificador, OpcaoModificador, Produto, ProdutoGrupoModificador
from .financial_read import resolve_financial_period
from .menu_intelligence import scope_entered_items

SOURCE = "itens_nao_cancelados_por_entrada_pedido"
UNCATALOGED_GROUP_ID = "__sem_cadastro__"


def _archived_group_type() -> str:
    from ..routes.modificadores import ARCHIVED_MODIFIER_TYPE  # lazy: evita ciclo service → route
    return ARCHIVED_MODIFIER_TYPE


def _share(quantity: int, total: int) -> Optional[float]:
    # Sem seleções no grupo a participação é não calculável, não 0%.
    return round(quantity / total * 100, 1) if total else None


def modifier_consumption(db: Session, tenant: int, start: str | None, end: str | None, product_id: str | None = None):
    period = resolve_financial_period(db, tenant, start, end)
    product_id = (product_id or "").strip() or None

    # 1) Unidades por produto no período (alimenta o filtro e o denominador por produto).
    unit_rows = scope_entered_items(
        db.query(Item.produto_id, func.count(Item.id)), tenant, period.start_utc, period.end_utc,
    ).group_by(Item.produto_id).all()
    units_by_product = {str(pid): int(qty or 0) for pid, qty in unit_rows}

    # 2) Seleções agregadas no banco por produto × opção (grupo pelo cadastro do ID).
    selection_query = scope_entered_items(
        db.query(Item.produto_id, ItemModificador.opcao_modificador_id, func.count(ItemModificador.id))
        .select_from(ItemModificador)
        .join(Item, and_(Item.id == ItemModificador.item_id, Item.restaurante_id == ItemModificador.restaurante_id)),
        tenant, period.start_utc, period.end_utc,
    ).filter(ItemModificador.restaurante_id == tenant)
    if product_id:
        selection_query = selection_query.filter(Item.produto_id == product_id)
    selection_rows = selection_query.group_by(Item.produto_id, ItemModificador.opcao_modificador_id).all()

    # 3) Grupos candidatos a mostrar opções sem saída (vínculos atuais do cardápio).
    product_links = db.query(ProdutoGrupoModificador.grupo_id).filter(ProdutoGrupoModificador.restaurante_id == tenant)
    category_links = db.query(CategoriaGrupoModificador.grupo_id).filter(CategoriaGrupoModificador.restaurante_id == tenant)
    if product_id:
        category_id = db.query(Produto.categoria_id).filter(
            Produto.restaurante_id == tenant, Produto.id == product_id,
        ).scalar()
        product_links = product_links.filter(ProdutoGrupoModificador.produto_id == product_id)
        category_links = category_links.filter(CategoriaGrupoModificador.categoria_id == (category_id or "__none__"))
    linked_group_ids = {str(gid) for (gid,) in product_links.union(category_links).all() if gid}

    selected_option_ids = {str(oid) for _pid, oid, _qty in selection_rows}
    option_filters = []
    if selected_option_ids:
        option_filters.append(OpcaoModificador.id.in_(selected_option_ids))
    if linked_group_ids:
        option_filters.append(and_(
            OpcaoModificador.grupo_id.in_(linked_group_ids),
            OpcaoModificador.ativo.is_(True), OpcaoModificador.arquivada.is_(False),
        ))
    options = {
        str(option.id): option
        for option in (db.query(OpcaoModificador).filter(
            OpcaoModificador.restaurante_id == tenant, or_(*option_filters),
        ).all() if option_filters else [])
    }
    group_ids = linked_group_ids | {str(o.grupo_id) for o in options.values() if o.grupo_id}
    groups = {
        str(group.id): group
        for group in (db.query(GrupoModificador).filter(
            GrupoModificador.restaurante_id == tenant, GrupoModificador.id.in_(group_ids),
        ).all() if group_ids else [])
    }
    archived_type = _archived_group_type()
    product_names = dict(db.query(Produto.id, Produto.nome).filter(
        Produto.restaurante_id == tenant,
        Produto.id.in_(set(units_by_product) | ({product_id} if product_id else set())),
    ).all()) if units_by_product or product_id else {}

    # 4) Montagem: produto → grupo → opção → quantidade.
    # Pré-agregação do total de seleções por par (produto_id, grupo_id) para cálculo
    # seguro de média de seleções por unidade do produto (futuro CMV).
    product_group_totals: dict[tuple[str, str], int] = defaultdict(int)
    for pid, oid, qty in selection_rows:
        option = options.get(str(oid))
        group_id = str(option.grupo_id) if (option and option.grupo_id) else UNCATALOGED_GROUP_ID
        product_group_totals[(str(pid), group_id)] += int(qty or 0)

    mix = []
    by_group: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    uncataloged = 0
    for pid, oid, qty in selection_rows:
        pid_str, oid_str, qty_int = str(pid), str(oid), int(qty or 0)
        option = options.get(oid_str)
        if option is None:
            group_id = UNCATALOGED_GROUP_ID
            uncataloged += qty_int
        else:
            group_id = str(option.grupo_id) if option.grupo_id else UNCATALOGED_GROUP_ID
        by_group[group_id][oid_str] += qty_int

        p_units = units_by_product.get(pid_str, 0)
        g_total = product_group_totals.get((pid_str, group_id), 0)
        avg_sel = round(g_total / p_units, 2) if p_units > 0 else None

        mix.append({
            "produto_id": pid_str,
            "grupo_id": group_id,
            "opcao_id": oid_str,
            "quantidade": qty_int,
            "product_units": p_units,
            "group_total_selections": g_total,
            "avg_selections_per_product_unit": avg_sel,
        })

    for group_id in linked_group_ids:
        group = groups.get(group_id)
        if group is None or group.tipo == archived_type:
            continue
        for oid, option in options.items():
            if str(option.grupo_id) == group_id and option.ativo and not option.arquivada:
                by_group[group_id].setdefault(oid, 0)

    selected_product_units = units_by_product.get(product_id, 0) if product_id else None

    result_groups = []
    for group_id, option_counts in by_group.items():
        group = groups.get(group_id)
        total = sum(option_counts.values())
        rows = []
        for oid, qty in option_counts.items():
            option = options.get(oid)
            rows.append({
                "opcao_id": oid,
                "opcao_nome": option.nome if option else f"Opção não cadastrada ({oid})",
                "quantidade": qty,
                "participacao_pct": _share(qty, total),
                "ativa": bool(option.ativo) if option else None,
                "arquivada": bool(option.arquivada) if option else None,
                "opcao_origem_id": str(option.opcao_origem_id) if option and option.opcao_origem_id else None,
                "cadastrada": option is not None,
            })
        rows.sort(key=lambda row: (-row["quantidade"], row["opcao_nome"].casefold()))

        # Quando filtrado por produto específico, calcula a média de seleções deste grupo por unidade vendida do produto
        avg_per_unit = (
            round(total / selected_product_units, 2)
            if (selected_product_units is not None and selected_product_units > 0)
            else None
        )

        result_groups.append({
            "grupo_id": group_id,
            "grupo_nome": group.nome if group else ("Opções sem cadastro" if group_id == UNCATALOGED_GROUP_ID else "Grupo removido do cardápio"),
            "grupo_origem_id": str(group.grupo_origem_id) if group and group.grupo_origem_id else None,
            "arquivado": bool(group is None or group.tipo == archived_type),
            "total_selecoes": total,
            "media_selecoes_por_unidade": avg_per_unit,
            "opcoes_com_saida": sum(1 for row in rows if row["quantidade"] > 0),
            "opcoes_sem_saida": sum(1 for row in rows if row["quantidade"] == 0),
            "opcoes": rows,
        })
    result_groups.sort(key=lambda g: (-g["total_selecoes"], g["grupo_nome"].casefold()))

    products = [
        {
            "produto_id": pid,
            "produto_nome": product_names.get(pid, pid),
            "unidades": qty,
            "product_units": qty,
        }
        for pid, qty in units_by_product.items()
    ]
    products.sort(key=lambda p: (-p["unidades"], p["produto_nome"].casefold()))
    mix.sort(key=lambda row: (row["produto_id"], row["grupo_id"], -row["quantidade"]))

    # Resumo agregado produto × grupo com denominador product_units
    mix_resumo = [
        {
            "produto_id": pid,
            "grupo_id": gid,
            "product_units": units_by_product.get(pid, 0),
            "group_total_selections": total,
            "avg_selections_per_product_unit": (
                round(total / units_by_product[pid], 2)
                if units_by_product.get(pid, 0) > 0
                else None
            ),
        }
        for (pid, gid), total in product_group_totals.items()
    ]
    mix_resumo.sort(key=lambda r: (r["produto_id"], r["grupo_id"]))

    return {
        "inicio": period.start_day.isoformat(),
        "fim": period.end_day.isoformat(),
        "fonte": SOURCE,
        "produto_id": product_id,
        "produto_nome": product_names.get(product_id) if product_id else None,
        "unidades_produto": units_by_product.get(product_id, 0) if product_id else sum(units_by_product.values()),
        "total_selecoes": sum(g["total_selecoes"] for g in result_groups),
        "selecoes_sem_cadastro": uncataloged,
        "grupos": result_groups,
        "produtos": products,
        "mix_por_produto": mix,
        "mix_resumo": mix_resumo,
    }
