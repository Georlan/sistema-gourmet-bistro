from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..models import Categoria, Item as ComandaItem, Produto, Usuario
from ..security import require_permission
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
    """Métrica operacional de produtos, deliberadamente separada de receita.

    O período é ancorado nas Contas/comandas que tiveram recebimento no dia
    operacional selecionado. Seus itens não cancelados representam consumo
    associado àquelas Contas. Nenhuma soma deste endpoint participa de
    faturamento, ticket, caixa ou fechamento.

    Isso evita o erro anterior em que um pagamento parcial de R$ 20 em uma
    comanda de R$ 100 fazia os R$ 100 de itens aparecerem como faturamento por
    produto.
    """
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

    consumption: dict[str, dict[str, float | int]] = {}
    for item in items:
        if not item.produto_id:
            continue
        product_id = str(item.produto_id)
        quantity = int(getattr(item, "quantidade", 1) or 1)
        unit_value = float(getattr(item, "preco_unit", 0) or 0)
        row = consumption.setdefault(product_id, {"quantity": 0, "value": 0.0})
        row["quantity"] = int(row["quantity"]) + quantity
        row["value"] = float(row["value"]) + unit_value * quantity

    result = []
    for product in products:
        row = consumption.get(str(product.id), {"quantity": 0, "value": 0.0})
        quantity = int(row["quantity"])
        consumed_value = round(float(row["value"]), 2)
        average_unit_value = round(consumed_value / quantity, 2) if quantity else 0.0
        result.append(
            {
                "produto_id": str(product.id),
                "produto_nome": product.nome,
                "categoria_nome": category_map.get(str(product.categoria_id), "Sem Categoria"),
                "quantidade_consumida": quantity,
                "valor_consumido": consumed_value,
                "preco_medio_item": average_unit_value,
                "natureza_valor": "consumo_operacional_nao_receita",
                # Compatibilidade de leitura durante a migração do frontend.
                # `faturamento_total` deixa de carregar um número para impedir
                # que clientes antigos o somem como receita por engano.
                "quantidade_vendida": quantity,
                "faturamento_total": None,
                "ticket_medio_item": average_unit_value,
            }
        )

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
