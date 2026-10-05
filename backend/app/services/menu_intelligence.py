"""Demand by order entry, independent of payment/shift closure. Read-only."""
from __future__ import annotations

import datetime
from decimal import Decimal
from sqlalchemy import case, func, and_
from sqlalchemy.orm import Session, joinedload
from ..models import Comanda, Lancamento, Item, Produto, ProdutoInsumo, Categoria
from ..timezone_utils import to_operational_local_time
from .financial_read import FinancialPeriod, resolve_financial_period
from .financeiro import money


def order_entry_hour_rows(db: Session, tenant: int, period: FinancialPeriod):
    # EXISTS avoids multiplying an order by its items. Cancellations still entered the workload.
    entries = db.query(Lancamento.timestamp).join(Comanda, and_(
        Comanda.id == Lancamento.comanda_id, Comanda.restaurante_id == Lancamento.restaurante_id,
    )).filter(
        Lancamento.restaurante_id == tenant, Comanda.onboarding_test.is_(False),
        Lancamento.timestamp >= period.start_utc, Lancamento.timestamp < period.end_utc,
        db.query(Item.id).filter(Item.restaurante_id == tenant, Item.lancamento_id == Lancamento.id).exists(),
    ).all()
    counts = [0] * 24
    for (timestamp,) in entries:
        counts[to_operational_local_time(timestamp).hour] += 1
    return [{"hora": f"{hour:02d}h", "total_pedidos": count} for hour, count in enumerate(counts)]


def complete_recipe_unit_cost(product: Produto):
    recipe = list(product.ficha_tecnica or [])
    if not recipe or any(
        item.insumo is None or Decimal(str(item.insumo.preco_medio_custo or 0)) <= 0
        or Decimal(str(item.quantidade or 0)) <= 0 for item in recipe
    ):
        return None
    return money(sum(Decimal(str(item.quantidade)) * Decimal(str(item.insumo.preco_medio_custo)) for item in recipe))


def menu_intelligence(db: Session, tenant: int, start: str | None, end: str | None):
    period = resolve_financial_period(db, tenant, start, end)
    days = (period.end_day - period.start_day).days + 1
    previous_end = period.start_day - datetime.timedelta(days=1)
    previous_start = previous_end - datetime.timedelta(days=days - 1)
    previous = resolve_financial_period(db, tenant, previous_start.isoformat(), previous_end.isoformat())
    current = Lancamento.timestamp >= period.start_utc
    aggregates = db.query(
        Item.produto_id,
        func.sum(case((current, 1), else_=0)),
        func.sum(case((current, Item.preco_unit), else_=0)),
        func.sum(case((~current, 1), else_=0)),
    ).join(Lancamento, and_(Lancamento.id == Item.lancamento_id, Lancamento.restaurante_id == Item.restaurante_id)
    ).join(Comanda, and_(Comanda.id == Lancamento.comanda_id, Comanda.restaurante_id == Lancamento.restaurante_id)
    ).filter(
        Item.restaurante_id == tenant, Lancamento.restaurante_id == tenant,
        Comanda.restaurante_id == tenant, Comanda.onboarding_test.is_(False),
        Item.status != "cancelado", Lancamento.status.notin_(["cancelado", "recusado"]),
        Lancamento.timestamp >= previous.start_utc, Lancamento.timestamp < period.end_utc,
    ).group_by(Item.produto_id).all()
    output = {str(pid): (int(qty or 0), money(value or 0), int(old or 0)) for pid, qty, value, old in aggregates}
    products = db.query(Produto).filter(Produto.restaurante_id == tenant).options(
        joinedload(Produto.ficha_tecnica).joinedload(ProdutoInsumo.insumo)
    ).all()
    categories = dict(db.query(Categoria.id, Categoria.nome).filter(Categoria.restaurante_id == tenant).all())
    total = sum(row[0] for row in output.values())
    rows = []
    for product in products:
        qty, value, old = output.get(str(product.id), (0, Decimal("0.00"), 0))
        price = money(product.preco)
        avg = money(value / qty) if qty else None
        cost = complete_recipe_unit_cost(product)
        margin = money(price - cost) if cost is not None else None
        signals = []
        if product.ativo and qty == 0:
            signals.append({"tipo": "sem_saida", "titulo": "Verificar disponibilidade e destaque", "motivo": "Ativo hoje, sem saída no período. Confira se estava disponível antes de decidir retirar."})
        if cost is None:
            signals.append({"tipo": "sem_custo", "titulo": "Completar os custos", "motivo": "Ficha técnica incompleta: ainda não há base para avaliar preço e margem."})
        elif price <= cost or (avg is not None and avg <= cost):
            signals.append({"tipo": "rever_preco", "titulo": "Revisar preço ou custos", "motivo": "O preço do cardápio ou o preço médio praticado não supera o custo atual dos ingredientes."})
        if old > 0 and qty < old:
            signals.append({"tipo": "queda", "titulo": "Investigar queda de saída", "motivo": f"{qty} unidades agora e {old} no período anterior de mesma duração. Confira disponibilidade e dias de funcionamento."})
        rows.append({
            "produto_id": str(product.id), "nome": product.nome, "categoria": categories.get(product.categoria_id, "Sem categoria"),
            "ativo": bool(product.ativo), "unidades": qty, "unidades_anteriores": old,
            "variacao_pct": round((qty - old) / old * 100, 1) if old else None,
            "participacao_pct": round(qty / total * 100, 1) if total else 0,
            "valor_consumo": float(value), "preco_medio": float(avg) if avg is not None else None,
            "preco_cardapio": float(price), "custo_unitario": float(cost) if cost is not None else None,
            "margem_unitaria_cardapio": float(margin) if margin is not None else None,
            "margem_pct_cardapio": round(float(margin / price * 100), 1) if margin is not None and price > 0 else None,
            "sugestoes": signals,
        })
    rows.sort(key=lambda row: (-row["unidades"], row["nome"].casefold()))
    return {"inicio": period.start_day.isoformat(), "fim": period.end_day.isoformat(),
        "inicio_anterior": previous_start.isoformat(), "fim_anterior": previous_end.isoformat(),
        "fonte": "itens_nao_cancelados_por_entrada_pedido", "unidades": total, "produtos": rows}
