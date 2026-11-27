"""Motor de DRE Gerencial (Competência) e Fluxo de Caixa (Realizado/Projetado) — B8 Frente 2."""

from __future__ import annotations

import datetime
from decimal import Decimal

from sqlalchemy import and_, func
from sqlalchemy.orm import Session, joinedload

from ..b8_finance_models import (
    ContaPagar,
    ContaPagarBaixa,
    ContaPagarParcela,
    ContaReceber,
    ContaReceberBaixa,
    FinanceCategoria,
    FinanceConta,
    FinanceMovimentacao,
)
from ..b8_supply_models import ItemCustoSnapshot
from ..models import Comanda, Item, Lancamento
from .b8_finance import ensure_default_finance_setup
from .financeiro import money
from .financial_read import current_operational_day, load_financial_snapshot, resolve_financial_period


def build_dre_gerencial(
    db: Session,
    *,
    restaurante_id: int,
    data_inicio: str | None = None,
    data_fim: str | None = None,
) -> dict:
    """Calcula DRE Gerencial por regime de competência, explicitando lacunas reais."""
    ensure_default_finance_setup(db, restaurante_id)
    snapshot = load_financial_snapshot(db, restaurante_id, data_inicio, data_fim)
    period = snapshot.period
    start_day = period.start_day
    end_day = period.end_day

    # 1. Receita Bruta Operacional + Deduções (estornos/descontos)
    receita_bruta_vendas = money(snapshot.totals.vendas_brutas)
    deducoes_estornos = money(snapshot.totals.estornos)

    # Descontos concedidos nos pedidos do período (sem onboarding_test)
    descontos_vendas = Decimal("0.00")
    desconto_row = (
        db.query(
            func.coalesce(
                func.sum(
                    func.coalesce(Comanda.valor_desconto_cupom, 0)
                    + func.coalesce(Comanda.valor_desconto_cashback, 0)
                ),
                0,
            )
        )
        .filter(
            Comanda.restaurante_id == restaurante_id,
            Comanda.onboarding_test.is_(False),
            Comanda.criado_em >= period.start_utc,
            Comanda.criado_em < period.end_utc,
            Comanda.delivery_status != "recusado",
        )
        .scalar()
    )
    descontos_vendas = money(desconto_row or 0)

    # Receitas extras lançadas em ContaReceber por competência (excluindo canceladas/estornadas)
    receitas_extras = money(
        db.query(func.coalesce(func.sum(ContaReceber.valor_previsto), 0))
        .filter(
            ContaReceber.restaurante_id == restaurante_id,
            ContaReceber.data_competencia >= start_day,
            ContaReceber.data_competencia <= end_day,
            ContaReceber.status.notin_(("cancelado", "estornado")),
        )
        .scalar()
        or 0
    )

    receita_bruta = money(receita_bruta_vendas + descontos_vendas + receitas_extras)
    deducoes_total = money(deducoes_estornos + descontos_vendas)
    receita_liquida = money(receita_bruta - deducoes_total)

    # 2. CMV baseado EXCLUSIVAMENTE em custos históricos capturados (ItemCustoSnapshot), nunca em compras!
    itens_ativos = (
        db.query(Item.id)
        .join(Lancamento, and_(Lancamento.id == Item.lancamento_id, Lancamento.restaurante_id == Item.restaurante_id))
        .join(Comanda, and_(Comanda.id == Lancamento.comanda_id, Comanda.restaurante_id == Lancamento.restaurante_id))
        .filter(
            Item.restaurante_id == restaurante_id,
            Comanda.onboarding_test.is_(False),
            Item.status != "cancelado",
            Lancamento.status.notin_(("cancelado", "recusado")),
            Lancamento.timestamp >= period.start_utc,
            Lancamento.timestamp < period.end_utc,
        )
        .all()
    )
    active_item_ids = [str(row[0]) for row in itens_ativos]
    snapshots = (
        db.query(ItemCustoSnapshot)
        .filter(
            ItemCustoSnapshot.restaurante_id == restaurante_id,
            ItemCustoSnapshot.item_id.in_(active_item_ids),
            ItemCustoSnapshot.estornado.is_(False),
        )
        .all()
        if active_item_ids
        else []
    )
    snap_by_item = {s.item_id: s for s in snapshots}

    cmv_total = Decimal("0.00")
    itens_com_custo = 0
    itens_sem_custo = 0
    for item_id in active_item_ids:
        snap = snap_by_item.get(item_id)
        if snap is not None and snap.custo_completo and snap.custo_total is not None:
            cmv_total += money(snap.custo_total)
            itens_com_custo += 1
        else:
            itens_sem_custo += 1

    cmv_total = money(cmv_total)
    lucro_bruto = money(receita_liquida - cmv_total)

    # 3. Despesas Operacionais (Competência) — exclui compras de estoque (custo_mercadoria / compra / xml_nfe)
    contas_despesa = (
        db.query(ContaPagar)
        .options(joinedload(ContaPagar.categoria))
        .filter(
            ContaPagar.restaurante_id == restaurante_id,
            ContaPagar.data_competencia >= start_day,
            ContaPagar.data_competencia <= end_day,
            ContaPagar.status != "cancelado",
        )
        .all()
    )
    despesas_por_categoria: dict[str, dict] = {}
    despesas_operacionais = Decimal("0.00")
    tributos_total = Decimal("0.00")

    for cp in contas_despesa:
        cat_tipo = cp.categoria.tipo if cp.categoria else "outra"
        cat_nome = cp.categoria.nome if cp.categoria else "Outras Despesas"
        # Compra de estoque é ativo até ser consumida na venda/produção; nunca somar como despesa nem CMV!
        if cat_tipo == "custo_mercadoria" or cp.origem_tipo in {"compra", "xml_nfe"}:
            continue
        val = money(cp.valor_original)
        if cat_tipo == "tributo":
            tributos_total += val
        else:
            despesas_operacionais += val
        entry = despesas_por_categoria.setdefault(
            cat_nome,
            {"categoria": cat_nome, "tipo": cat_tipo, "valor": Decimal("0.00")},
        )
        entry["valor"] = money(entry["valor"] + val)

    despesas_operacionais = money(despesas_operacionais)
    tributos_total = money(tributos_total)
    resultado_operacional = money(lucro_bruto - despesas_operacionais - tributos_total)

    # 4. Resultado Financeiro (juros pagos vs descontos obtidos em baixas no período)
    baixas_pagar = (
        db.query(
            func.coalesce(func.sum(ContaPagarBaixa.juros), 0),
            func.coalesce(func.sum(ContaPagarBaixa.desconto), 0),
        )
        .filter(
            ContaPagarBaixa.restaurante_id == restaurante_id,
            ContaPagarBaixa.estornada.is_(False),
            ContaPagarBaixa.data_pagamento >= start_day,
            ContaPagarBaixa.data_pagamento <= end_day,
        )
        .one()
    )
    juros_pagos = money(baixas_pagar[0] or 0)
    descontos_obtidos = money(baixas_pagar[1] or 0)

    taxas_receber = money(
        db.query(func.coalesce(func.sum(ContaReceberBaixa.taxa_descontada), 0))
        .filter(
            ContaReceberBaixa.restaurante_id == restaurante_id,
            ContaReceberBaixa.estornada.is_(False),
            ContaReceberBaixa.data_recebimento >= start_day,
            ContaReceberBaixa.data_recebimento <= end_day,
        )
        .scalar()
        or 0
    )

    resultado_financeiro = money(descontos_obtidos - juros_pagos - taxas_receber)
    resultado_liquido = money(resultado_operacional + resultado_financeiro)

    # 5. Transparência e detecção de lacunas (proibido fingir lucro completo!)
    lacunas: list[str] = []
    if itens_sem_custo > 0:
        lacunas.append(
            f"{itens_sem_custo} de {len(active_item_ids)} itens vendidos no período não possuem custo histórico completo."
        )
    if not contas_despesa:
        lacunas.append("Nenhuma despesa operacional lançada por competência no período.")
    if tributos_total == Decimal("0.00") and receita_liquida > Decimal("0.00"):
        lacunas.append("Tributos do período não informados nas despesas.")

    margem_bruta_pct = round(float((lucro_bruto / receita_liquida) * Decimal("100")), 2) if receita_liquida > Decimal("0.00") else None
    margem_liquida_pct = round(float((resultado_liquido / receita_liquida) * Decimal("100")), 2) if receita_liquida > Decimal("0.00") else None

    return {
        "regime": "competencia",
        "periodo": {"data_inicio": start_day.isoformat(), "data_fim": end_day.isoformat()},
        "status_completude": "parcial" if lacunas else "completo",
        "lacunas": lacunas,
        "linhas": {
            "receita_bruta": float(receita_bruta),
            "receita_vendas_operacionais": float(receita_bruta_vendas),
            "receitas_extras": float(receitas_extras),
            "deducoes_descontos": float(descontos_vendas),
            "deducoes_estornos": float(deducoes_estornos),
            "deducoes_total": float(deducoes_total),
            "receita_liquida": float(receita_liquida),
            "cmv": float(cmv_total),
            "lucro_bruto": float(lucro_bruto),
            "margem_bruta_pct": margem_bruta_pct,
            "despesas_operacionais": float(despesas_operacionais),
            "tributos": float(tributos_total),
            "resultado_operacional": float(resultado_operacional),
            "resultado_financeiro": float(resultado_financeiro),
            "resultado_liquido_gerencial": float(resultado_liquido),
            "margem_liquida_pct": margem_liquida_pct,
        },
        "cobertura_cmv": {
            "itens_totais": len(active_item_ids),
            "itens_com_custo": itens_com_custo,
            "itens_sem_custo": itens_sem_custo,
            "cobertura_pct": round((itens_com_custo / len(active_item_ids)) * 100, 1) if active_item_ids else 100.0,
        },
        "despesas_por_categoria": [
            {"categoria": item["categoria"], "tipo": item["tipo"], "valor": float(item["valor"])}
            for item in sorted(despesas_por_categoria.values(), key=lambda x: x["valor"], reverse=True)
        ],
    }


def build_fluxo_caixa(
    db: Session,
    *,
    restaurante_id: int,
    data_inicio: str | None = None,
    data_fim: str | None = None,
    conta_financeira_id: str | None = None,
) -> dict:
    """Calcula Fluxo de Caixa Realizado + Previsto por regime de caixa."""
    _, accounts = ensure_default_finance_setup(db, restaurante_id)
    period = resolve_financial_period(db, restaurante_id, data_inicio, data_fim)
    start_day = period.start_day
    end_day = period.end_day
    hoje = current_operational_day(db, restaurante_id)

    selected_accounts = [
        a for a in accounts
        if a.ativo and (conta_financeira_id is None or a.id == conta_financeira_id)
    ]
    account_ids = {a.id for a in selected_accounts}

    saldo_inicial_base = sum((money(a.saldo_inicial) for a in selected_accounts), Decimal("0.00"))

    # Movimentações anteriores ao período ajustam o saldo inicial
    movs_anteriores = (
        db.query(FinanceMovimentacao)
        .filter(
            FinanceMovimentacao.restaurante_id == restaurante_id,
            FinanceMovimentacao.data_movimento < start_day,
            FinanceMovimentacao.conta_financeira_id.in_(account_ids) if account_ids else False,
        )
        .all()
        if account_ids
        else []
    )
    for m in movs_anteriores:
        if m.tipo in {"entrada", "transferencia_entrada", "aporte"}:
            saldo_inicial_base += money(m.valor)
        elif m.tipo in {"saida", "transferencia_saida", "retirada", "estorno"}:
            saldo_inicial_base -= money(m.valor)

    # Entradas operacionais realizadas no Caixa (PDV/Cardápio/Salão) quando não filtrando por conta bancária específica
    include_operational_pdv = conta_financeira_id is None or any(
        a.tipo == "caixa_operacional" for a in selected_accounts
    )
    entradas_operacionais = Decimal("0.00")
    por_meio_operacional = {"dinheiro": 0.0, "pix": 0.0, "cartao": 0.0}
    if include_operational_pdv:
        snapshot = load_financial_snapshot(db, restaurante_id, data_inicio, data_fim)
        # Dinheiro e Pix são liquidez imediata; cartão fica sinalizado separadamente para transparência.
        entradas_operacionais = money(snapshot.totals.vendas_liquidas)
        por_meio_operacional = {
            "dinheiro": float(money(snapshot.totals.liquido_por_metodo.get("dinheiro", 0))),
            "pix": float(money(snapshot.totals.liquido_por_metodo.get("pix", 0))),
            "cartao": float(money(snapshot.totals.liquido_por_metodo.get("cartao", 0))),
        }

    # Movimentações realizadas dentro do período (baixas CP/CR + aportes/retiradas/manuais)
    movs_periodo = (
        db.query(FinanceMovimentacao)
        .filter(
            FinanceMovimentacao.restaurante_id == restaurante_id,
            FinanceMovimentacao.data_movimento >= start_day,
            FinanceMovimentacao.data_movimento <= end_day,
            FinanceMovimentacao.conta_financeira_id.in_(account_ids) if account_ids else False,
        )
        .order_by(FinanceMovimentacao.data_movimento.asc(), FinanceMovimentacao.created_at.asc())
        .all()
        if account_ids
        else []
    )

    entradas_financeiras = Decimal("0.00")
    saidas_realizadas = Decimal("0.00")
    movimentos_out = []
    for m in movs_periodo:
        val = money(m.valor)
        if m.tipo in {"entrada", "transferencia_entrada", "aporte"}:
            entradas_financeiras += val
        elif m.tipo in {"saida", "transferencia_saida", "retirada", "estorno"}:
            saidas_realizadas += val
        movimentos_out.append({
            "id": m.id,
            "data": m.data_movimento.isoformat(),
            "tipo": m.tipo,
            "valor": float(val),
            "descricao": m.descricao,
            "origem_tipo": m.origem_tipo,
            "conta_financeira_id": m.conta_financeira_id,
        })

    entradas_realizadas_total = money(entradas_operacionais + entradas_financeiras)
    saldo_final_realizado = money(saldo_inicial_base + entradas_realizadas_total - saidas_realizadas)

    # Previsto (Contas a Receber e Contas a Pagar em aberto com vencimento >= start_day e <= end_day)
    cr_previstas = (
        db.query(ContaReceber)
        .filter(
            ContaReceber.restaurante_id == restaurante_id,
            ContaReceber.status.in_(("aberto", "parcial")),
            ContaReceber.data_vencimento >= start_day,
            ContaReceber.data_vencimento <= end_day,
        )
        .all()
    )
    entradas_previstas = money(
        sum((max(Decimal("0.00"), money(cr.valor_previsto) - money(cr.valor_recebido)) for cr in cr_previstas), Decimal("0.00"))
    )

    cp_parcelas_previstas = (
        db.query(ContaPagarParcela)
        .options(joinedload(ContaPagarParcela.conta_pagar))
        .filter(
            ContaPagarParcela.restaurante_id == restaurante_id,
            ContaPagarParcela.status.in_(("aberto", "parcial")),
            ContaPagarParcela.data_vencimento >= start_day,
            ContaPagarParcela.data_vencimento <= end_day,
        )
        .all()
    )
    saidas_previstas = Decimal("0.00")
    vencimentos_futuros = []
    for p in cp_parcelas_previstas:
        devido = money(p.valor_parcela) + money(p.juros) - money(p.desconto) + money(p.ajuste)
        saldo = max(Decimal("0.00"), money(devido - money(p.valor_pago)))
        saidas_previstas += saldo
        vencimentos_futuros.append({
            "tipo": "pagar",
            "id": p.id,
            "conta_pagar_id": p.conta_pagar_id,
            "descricao": p.conta_pagar.descricao if p.conta_pagar else "Parcela",
            "favorecido": p.conta_pagar.favorecido_nome if p.conta_pagar else "",
            "data_vencimento": p.data_vencimento.isoformat(),
            "valor_aberto": float(saldo),
            "atrasado": p.data_vencimento < hoje,
        })

    for cr in cr_previstas:
        saldo = max(Decimal("0.00"), money(money(cr.valor_previsto) - money(cr.valor_recebido)))
        vencimentos_futuros.append({
            "tipo": "receber",
            "id": cr.id,
            "descricao": cr.descricao,
            "contraparte": cr.contraparte_nome,
            "data_vencimento": cr.data_vencimento.isoformat(),
            "valor_aberto": float(saldo),
            "tipo_confirmacao": cr.tipo_confirmacao,
            "atrasado": cr.data_vencimento < hoje,
        })

    saidas_previstas = money(saidas_previstas)
    saldo_projetado = money(saldo_final_realizado + entradas_previstas - saidas_previstas)

    return {
        "regime": "caixa",
        "periodo": {"data_inicio": start_day.isoformat(), "data_fim": end_day.isoformat()},
        "saldo_inicial": float(money(saldo_inicial_base)),
        "entradas_realizadas": float(entradas_realizadas_total),
        "entradas_operacionais_pdv": float(entradas_operacionais),
        "entradas_operacionais_por_meio": por_meio_operacional,
        "aviso_cartao": (
            "Vendas em cartão registradas no PDV/Cardápio aparecem em entradas operacionais; "
            "para controle de liquidação D+N, lance recebíveis/taxas em Contas a Receber."
            if por_meio_operacional["cartao"] > 0
            else None
        ),
        "entradas_financeiras": float(money(entradas_financeiras)),
        "saidas_realizadas": float(money(saidas_realizadas)),
        "saldo_final_realizado": float(saldo_final_realizado),
        "entradas_previstas": float(entradas_previstas),
        "saidas_previstas": float(saidas_previstas),
        "saldo_projetado": float(saldo_projetado),
        "contas": [
            {
                "id": a.id,
                "nome": a.nome,
                "tipo": a.tipo,
                "saldo_inicial": float(money(a.saldo_inicial)),
                "padrao": a.padrao,
            }
            for a in selected_accounts
        ],
        "movimentacoes": movimentos_out,
        "vencimentos_futuros": sorted(vencimentos_futuros, key=lambda x: x["data_vencimento"]),
    }
