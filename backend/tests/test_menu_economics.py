from decimal import Decimal
import pytest
from app.domain.menu_economics import enrich_menu_analysis, simulate_menu_economics


def simulate(**overrides):
    inputs = dict(preco_atual='10', custo_atual='1', quantidade_atual=59,
                  preco_proposto='11', custo_proposto='1', despesa_variavel_unitaria='0',
                  gasto_acao='0', quantidades=[54, 59, 65])
    return simulate_menu_economics(**(inputs | overrides))


def test_integer_equilibrium_price_change_and_cost_reduction():
    result = simulate()
    assert result['contribuicao_referencia'] == 531
    assert result['unidades_para_preservar'] == result['unidades_para_superar'] == 54
    assert result['vendas_que_pode_perder'] == 5
    assert result['cenarios'][0] == {'quantidade': 54, 'contribuicao': 540, 'diferenca': 9}
    assert simulate(preco_proposto='10', custo_proposto='0')['margem_proposta'] == 10


def test_exact_equality_requires_one_more_to_exceed_and_action_spend_is_included():
    result = simulate(quantidade_atual=60)
    assert result['unidades_para_preservar'] == 54 and result['unidades_para_superar'] == 55
    spent = simulate(quantidade_atual=60, gasto_acao='100')
    assert spent['unidades_para_preservar'] == 64
    assert spent['vendas_adicionais_necessarias'] == 4 and spent['vendas_que_pode_perder'] == 0


@pytest.mark.parametrize('cost', ['11', '12'])
def test_nonpositive_margin_never_has_positive_contribution_equilibrium(cost):
    result = simulate(custo_proposto=cost)
    assert result['unidades_para_preservar'] is None
    assert result['vendas_que_pode_perder'] is None
    assert result['cenarios'][-1]['contribuicao'] <= 0


def test_nonpositive_baseline_and_decimal_costs():
    assert simulate(quantidade_atual=0)['vendas_que_pode_perder'] is None
    assert simulate(custo_atual='11')['unidades_para_preservar'] is None
    result = simulate(preco_atual='0.30', custo_atual='0.10', preco_proposto='0.40', custo_proposto='0.10', quantidade_atual=3, quantidades=[2,3,4])
    assert result['contribuicao_referencia'] == .60
    assert result['unidades_para_preservar'] == 2
    assert result['unidades_para_superar'] == 3


def row(pid, qty, price, cost, active=True, category='drinks'):
    return dict(produto_id=pid, nome=pid, categoria_id=category, categoria=category, ativo=active,
                unidades=qty, unidades_anteriores=0, unidades_sem_modificadores=qty,
                unidades_anteriores_sem_modificadores=0, valor_sem_modificadores=Decimal(str(price))*qty,
                valor_anterior_sem_modificadores=0, valor_consumo=Decimal(str(price))*qty,
                valor_consumo_anterior=0, unidades_com_modificadores=0, custo_unitario=cost, sugestoes=[])


def test_category_weighted_threshold_all_quadrants_and_search_cannot_change_cohort():
    rows = [row('star', 50, 21, 1), row('puzzle', 5, 31, 1), row('horse', 40, 11, 1), row('low', 5, 6, 1)]
    rows += [row('separate-combo', 40, 100, 5, category='combos')]
    result = enrich_menu_analysis(rows, {'drinks': 50, 'combos': 40}, 30)
    drinks = next(c for c in result['categorias'] if c['categoria_id'] == 'drinks')
    assert drinks['limite_margem_unitaria'] == 15.75
    assert drinks['limite_popularidade_pct'] == 17.5
    assert [r['classificacao'] for r in rows[:4]] == ['estrela', 'enigma', 'cavalo_batalha', 'baixo_desempenho']
    assert rows[-1]['classificacao'] is None  # category with one item never classified
    assert rows[0]['contribuicao_estimada'] == 1000
    assert rows[2]['contribuicao_estimada'] == 400


def test_unknown_cost_keeps_popularity_denominator_and_small_sample_abstains():
    rows = [row('known', 10, 10, 1), row('unknown', 100, 50, None), row('no-output', 0, 10, 1)]
    result = enrich_menu_analysis(rows, {'drinks': 50}, 30)
    assert result['categorias'][0]['produtos_comparaveis'] == 3
    assert rows[0]['participacao_categoria_pct'] == pytest.approx(9.1)
    assert rows[0]['classificacao'] == 'enigma'
    assert rows[1]['classificacao'] is None
    assert result['resumo']['contribuicao_estimada'] == 90
    small = [row('a', 20, 10, 1), row('b', 20, 10, 1), row('c', 20, 10, 1)]
    enrich_menu_analysis(small, {'drinks': 2}, 30)
    assert all(r['classificacao'] is None for r in small)


def test_partial_recipe_coverage_does_not_recommend_financial_actions():
    rows = [row('star', 70, 20, 1), row('unknown', 20, 10, None), row('small', 1, 10, 1)]
    result = enrich_menu_analysis(rows, {'drinks': 50}, 30)
    assert rows[0]['classificacao'] == 'estrela'
    assert rows[0]['classificacao_provisoria'] is True
    assert not any(o['tipo'] in ('acompanhamento', 'simular', 'destaque') for o in result['oportunidades'])
