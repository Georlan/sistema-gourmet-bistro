"""Deterministic, read-only menu analysis. Current recipe cost is an estimate.

No payment allocation, modifier recipe, causal forecast or catalog mutation is
inferred here. Monetary calculations use Decimal, not presentation rounding.
"""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP

CENT = Decimal('0.01')
METHOD_VERSION = 'menu-base-current-cost-v1'


def money(value) -> Decimal:
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def amount(value):
    return float(money(value)) if value is not None else None


def ratio(numerator, denominator):
    return round(float(Decimal(str(numerator)) / Decimal(str(denominator)) * 100), 1) if denominator else None


def enrich_menu_analysis(rows: list[dict], samples: dict, period_days: int) -> dict:
    """Use the entire category cohort for popularity, even for unknown costs.

    Only units without modifier selections have composition covered by the
    product recipe. That is coverage of registered ingredients, not all costs.
    """
    categories = defaultdict(list)
    for row in rows:
        cost = row['custo_unitario']
        qty = row['unidades_sem_modificadores'] if cost is not None else 0
        old_qty = row['unidades_anteriores_sem_modificadores'] if cost is not None else 0
        value = money(row['valor_sem_modificadores']) if qty else Decimal(0)
        old_value = money(row['valor_anterior_sem_modificadores']) if old_qty else Decimal(0)
        total_cost = money(Decimal(str(cost)) * qty) if qty else None
        old_cost = money(Decimal(str(cost)) * old_qty) if old_qty else None
        contribution = money(value - total_cost) if total_cost is not None else None
        old_contribution = money(old_value - old_cost) if old_cost is not None else None
        # Preserve precision for weighted thresholds; round only at the boundary.
        unit_margin = contribution / qty if qty else None
        row.update({
            'unidades_cobertas': qty, 'unidades_anteriores_cobertas': old_qty,
            'valor_coberto': amount(value), 'valor_anterior_coberto': amount(old_value),
            'cobertura_custo_pct': ratio(qty, row['unidades']),
            'custo_total_estimado': amount(total_cost),
            'contribuicao_estimada': amount(contribution),
            'contribuicao_anterior_estimada': amount(old_contribution),
            'margem_unitaria_observada': amount(unit_margin),
            'cmv_pct_estimado': ratio(total_cost, value) if total_cost is not None and value > 0 else None,
            'classificacao': None, 'classificacao_provisoria': True, 'motivo_classificacao': 'Sem saída ou sem custo de composição coberto.',
            '_unit_margin': unit_margin,
        })
        if row['ativo'] or row['unidades']:
            categories[row['categoria_id']].append(row)

    category_rows = []
    for cid, cohort in categories.items():
        units = sum(p['unidades'] for p in cohort)
        covered = sum(p['unidades_cobertas'] for p in cohort)
        contribution = sum((money(p['contribuicao_estimada']) for p in cohort if p['contribuicao_estimada'] is not None), Decimal(0))
        threshold_margin = contribution / covered if covered else None
        threshold_share = Decimal('0.70') / len(cohort)
        sample = samples.get(cid, 0)
        # Engineering floor for descriptive triage, not a confidence probability.
        triage = len(cohort) >= 3 and sample >= 30 and period_days >= 7
        complete = bool(units and covered == units)
        for row in cohort:
            row['participacao_categoria_pct'] = ratio(row['unidades'], units)
            if row['unidades'] <= 0 or row['_unit_margin'] is None:
                continue
            if len(cohort) < 3:
                row['motivo_classificacao'] = 'Categoria com menos de três produtos comparáveis.'
                continue
            if not triage:
                row['motivo_classificacao'] = 'Amostra pequena: use ao menos 7 dias e 30 pedidos na categoria para esta triagem.'
                continue
            high_share = Decimal(row['unidades']) / units >= threshold_share
            high_margin = row['_unit_margin'] >= threshold_margin
            row['classificacao_provisoria'] = not complete
            row['classificacao'] = (
                'estrela' if high_share and high_margin else
                'enigma' if high_margin else
                'cavalo_batalha' if high_share else 'baixo_desempenho'
            )
            row['motivo_classificacao'] = (
                f"Popularidade {'alta' if high_share else 'baixa'} na categoria e "
                f"margem unitária {'alta' if high_margin else 'baixa'} em relação à média ponderada. "
                + ('Custos cobrem apenas parte da demanda; classificação provisória. ' if not complete else '')
                + 'Usa custos atuais dos ingredientes cadastrados; disponibilidade histórica não é conhecida.'
            )
        category_rows.append({
            'categoria_id': cid, 'nome': cohort[0]['categoria'], 'produtos_comparaveis': len(cohort),
            'unidades': units, 'pedidos_distintos': sample,
            'unidades_cobertas': covered, 'cobertura_custo_pct': ratio(covered, units),
            'contribuicao_estimada': amount(contribution) if covered else None,
            'limite_popularidade_pct': float(threshold_share * 100),
            'limite_margem_unitaria': amount(threshold_margin),
            'triagem_disponivel': triage, 'cobertura_completa': complete,
        })
    for row in rows:
        row.pop('_unit_margin')
    covered = sum(p['unidades_cobertas'] for p in rows)
    old_covered = sum(p['unidades_anteriores_cobertas'] for p in rows)
    value = sum((money(p['valor_coberto']) for p in rows), Decimal(0))
    cost = sum((money(p['custo_total_estimado']) for p in rows if p['custo_total_estimado'] is not None), Decimal(0))
    contribution = sum((money(p['contribuicao_estimada']) for p in rows if p['contribuicao_estimada'] is not None), Decimal(0))
    old_contribution = sum((money(p['contribuicao_anterior_estimada']) for p in rows if p['contribuicao_anterior_estimada'] is not None), Decimal(0))
    units = sum(p['unidades'] for p in rows)
    opportunities = []
    for p in rows:
        signals = list(p['sugestoes'])
        if p['unidades'] and p['unidades_com_modificadores']:
            signals.insert(0, {'tipo': 'composicao', 'titulo': 'Conferir custos das escolhas', 'motivo': f"{p['unidades_com_modificadores']} unidades têm modificadores e ficam fora da margem estimada da base."})
        if p['classificacao'] == 'estrela' and not p['classificacao_provisoria'] and p['margem_unitaria_observada'] > 0:
            signals.append({'tipo': 'acompanhamento', 'titulo': 'Investigar venda adicional sem desconto', 'motivo': 'Demanda e margem positiva da base justificam investigar acompanhamentos. A taxa de inclusão e o ganho incremental ainda não foram medidos.'})
        if p['classificacao'] == 'enigma' and not p['classificacao_provisoria']:
            signals.append({'tipo': 'destaque', 'titulo': 'Revisar disponibilidade e apresentação', 'motivo': 'Margem relativa alta e procura baixa na categoria. Verifique destaque e disponibilidade antes de oferecer desconto.'})
        if p['classificacao'] == 'cavalo_batalha' and not p['classificacao_provisoria'] and p['margem_unitaria_observada'] > 0:
            signals.append({'tipo': 'simular', 'titulo': 'Simular preço ou custo', 'motivo': 'Demanda relativamente alta. Compare reajuste e redução de custo sem presumir que o volume permanecerá igual.'})
        for signal in signals:
            opportunities.append({'produto_id': p['produto_id'], 'produto_nome': p['nome'], **signal,
                                  'unidades': p['unidades'], 'unidades_anteriores': p['unidades_anteriores'],
                                  'contribuicao_estimada': p['contribuicao_estimada'],
                                  'cobertura_custo_pct': p['cobertura_custo_pct']})
    priority = {'rever_preco': 0, 'sem_custo': 1, 'composicao': 2, 'queda': 3, 'acompanhamento': 4, 'simular': 5, 'destaque': 6, 'sem_saida': 7}
    opportunities.sort(key=lambda o: (priority.get(o['tipo'], 8), -o['unidades'], o['produto_nome'].casefold()))
    category_rows.sort(key=lambda c: (-c['unidades'], c['nome'].casefold()))
    return {
        'categorias': category_rows, 'oportunidades': opportunities,
        'resumo': {
            'valor_itens': amount(sum((money(p['valor_consumo']) for p in rows), Decimal(0))),
            'valor_itens_anterior': amount(sum((money(p['valor_consumo_anterior']) for p in rows), Decimal(0))),
            'unidades_anteriores': sum(p['unidades_anteriores'] for p in rows),
            'unidades_cobertas': covered, 'unidades_anteriores_cobertas': old_covered,
            'cobertura_custo_pct': ratio(covered, units),
            'custo_total_estimado': amount(cost) if covered else None,
            'contribuicao_estimada': amount(contribution) if covered else None,
            'contribuicao_anterior_estimada': amount(old_contribution) if old_covered else None,
            'cmv_pct_estimado': ratio(cost, value) if covered and value > 0 else None,
        },
    }


def simulate_menu_economics(*, preco_atual, custo_atual, quantidade_atual: int,
                            preco_proposto, custo_proposto, despesa_variavel_unitaria,
                            gasto_acao, quantidades: list[int]) -> dict:
    """Hypotheses supplied by the caller; no demand prediction or persistence."""
    price, cost, new_price, new_cost, variable, spend = map(money, (
        preco_atual, custo_atual, preco_proposto, custo_proposto, despesa_variavel_unitaria, gasto_acao,
    ))
    current_margin = money(price - cost - variable)
    proposed_margin = money(new_price - new_cost - variable)
    baseline = money(current_margin * quantidade_atual)
    preserve = exceed = lost = None
    if baseline > 0 and proposed_margin > 0:
        target = (baseline + spend) / proposed_margin
        preserve = int(target.to_integral_value(rounding=ROUND_CEILING))
        exceed = int(target.to_integral_value(rounding=ROUND_FLOOR)) + 1
        lost = max(0, quantidade_atual - preserve)
    return {
        'margem_atual': amount(current_margin), 'margem_proposta': amount(proposed_margin),
        'contribuicao_referencia': amount(baseline),
        'unidades_para_preservar': preserve, 'unidades_para_superar': exceed,
        'vendas_que_pode_perder': lost,
        'vendas_adicionais_necessarias': max(0, preserve - quantidade_atual) if preserve is not None else None,
        'cenarios': [{'quantidade': q, 'contribuicao': amount(proposed_margin * q - spend),
                      'diferenca': amount(proposed_margin * q - spend - baseline)} for q in quantidades],
        'natureza': 'simulacao_hipotetica_sem_alteracao_do_cardapio',
        'avisos': [
            'Custos e volumes são hipóteses informadas; reação dos clientes não é prevista.',
            'Não representa lucro: despesas fixas e custos variáveis não informados ficam fora.',
        ] + (['Margem proposta não positiva: aumento de volume não recupera contribuição positiva.'] if proposed_margin <= 0 else [])
        + (['Sem contribuição positiva de referência; equilíbrio e perda tolerável não são calculados.'] if baseline <= 0 else []),
    }
