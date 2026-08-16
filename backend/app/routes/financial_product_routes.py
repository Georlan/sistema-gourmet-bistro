from __future__ import annotations

from decimal import Decimal
from typing import Optional

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..models import Categoria, Item as ComandaItem, Produto, Usuario
from ..security import require_permission
from ..services.financeiro import money
from ..services.financial_read import load_financial_snapshot
from . import relatorios as legacy_reports


def _remove_product_route() -> None:
    legacy_reports.router.routes[:] = [
        route
        for route in legacy_reports.router.routes
        if not (
            getattr(route, "path", None) == "/relatorios/produtos"
            and "GET" in (getattr(route, "methods", set()) or set())
        )
    ]


def get_relatorio_produtos_operacional(
    data_inicio: Optional[str] = Query(None),
    data_fim: Optional[str] = Query(None),
    ordenacao: str = Query("mais_vendidos"),
    busca: Optional[str] = Query(None),
    categoria_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("relatorios:consultar")),
):
    """Métrica operacional de produtos, deliberadamente separada de receita."""
    rest_id = require_tenant_id()
    try:
        snapshot = load_financial_snapshot(db, rest_id, data_inicio, data_fim)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    product_query = db.query(Produto).filter(Produto.restaurante_id == rest_id)
    if busca and busca.strip():
        product_query = product_query.filter(Produto.nome.ilike(f"%{busca.strip()}%"))
    if categoria_id:
        product_query = product_query.filter(Produto.categoria_id == str(categoria_id))
    products = product_query.all()

    categories = db.query(Categoria).filter(Categoria.restaurante_id == rest_id).all()
    category_map = {str(category.id): category.nome for category in categories}
    command_ids = {
        command_id
        for sale in snapshot.sales.values()
        for command_id in sale.command_ids
    }
    items = (
        db.query(ComandaItem)
        .filter(
            ComandaItem.restaurante_id == rest_id,
            ComandaItem.comanda_id.in_(command_ids),
            ComandaItem.status != "cancelado",
        )
        .all()
        if command_ids
        else []
    )

    consumption: dict[str, dict[str, Decimal | int]] = {}
    for item in items:
        if not item.produto_id:
            continue
        product_id = str(item.produto_id)
        quantity = int(getattr(item, "quantidade", 1) or 1)
        unit_value = money(getattr(item, "preco_unit", 0) or 0)
        row = consumption.setdefault(
            product_id,
            {"quantity": 0, "value": Decimal("0.00")},
        )
        row["quantity"] = int(row["quantity"]) + quantity
        row["value"] = money(Decimal(str(row["value"])) + unit_value * quantity)

    result = []
    for product in products:
        row = consumption.get(
            str(product.id),
            {"quantity": 0, "value": Decimal("0.00")},
        )
        quantity = int(row["quantity"])
        consumed_value = money(row["value"])
        average_unit_value = (
            money(consumed_value / quantity)
            if quantity
            else Decimal("0.00")
        )
        result.append({
            "produto_id": str(product.id),
            "produto_nome": product.nome,
            "categoria_nome": category_map.get(str(product.categoria_id), "Sem Categoria"),
            "quantidade_consumida": quantity,
            "valor_consumido": float(consumed_value),
            "preco_medio_item": float(average_unit_value),
            "natureza_valor": "consumo_operacional_nao_receita",
            "quantidade_vendida": quantity,
            "faturamento_total": None,
            "ticket_medio_item": float(average_unit_value),
        })

    if ordenacao == "menos_vendidos":
        result.sort(key=lambda row: (row["quantidade_consumida"], row["valor_consumido"]))
    elif ordenacao in {"mais_vendidos", "todos"}:
        result.sort(
            key=lambda row: (row["quantidade_consumida"], row["valor_consumido"]),
            reverse=True,
        )
    else:
        raise HTTPException(status_code=400, detail="Ordenação inválida.")

    for index, row in enumerate(result, start=1):
        row["ranking"] = index
    return result


_remove_product_route()
legacy_reports.router.add_api_route(
    "/produtos",
    get_relatorio_produtos_operacional,
    methods=["GET"],
    name="get_relatorio_produtos_operacional",
)
