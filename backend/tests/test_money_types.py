"""Guards the database contract for exact monetary storage."""

from sqlalchemy import Float, Numeric

from app.financial_models import PagamentoAlocacao, PagamentoEstorno
from app.models import (
    CaixaMovimentacao,
    CaixaTurno,
    Cliente,
    Comanda,
    ConfigFidelizacao,
    ConfiguracaoRestaurante,
    EntradaEstoque,
    HistoricoFidelidade,
    Insumo,
    Item,
    ItemEntradaEstoque,
    ItemModificador,
    ItemNotaEntrada,
    MovimentacaoEstoque,
    NotaEntrada,
    OpcaoModificador,
    Pagamento,
    Produto,
)


MONEY_COLUMNS = (
    (Produto, "preco", 2),
    (Comanda, "valor_pago", 2),
    (Comanda, "delivery_taxa", 2),
    (Item, "preco_unit", 2),
    (CaixaTurno, "saldo_inicial", 2),
    (CaixaTurno, "declarado_dinheiro", 2),
    (CaixaTurno, "declarado_pix", 2),
    (CaixaTurno, "declarado_cartao", 2),
    (CaixaMovimentacao, "valor", 2),
    (CaixaMovimentacao, "saldo_anterior", 2),
    (CaixaMovimentacao, "saldo_posterior", 2),
    (Pagamento, "valor", 2),
    (PagamentoAlocacao, "valor", 2),
    (PagamentoEstorno, "valor", 2),
    (ConfiguracaoRestaurante, "meta_mensal", 2),
    (OpcaoModificador, "preco_adicional", 2),
    (ItemModificador, "preco_aplicado", 2),
    (Insumo, "preco_medio_custo", 4),
    (ConfigFidelizacao, "valor_ponto_em_dinheiro", 4),
    (HistoricoFidelidade, "valor_delta", 4),
    (Cliente, "saldo_cashback", 2),
    (NotaEntrada, "valor_total", 2),
    (ItemNotaEntrada, "preco_unitario", 4),
    (EntradaEstoque, "valor_total", 2),
    (ItemEntradaEstoque, "custo_unitario", 4),
    (ItemEntradaEstoque, "subtotal", 2),
    (MovimentacaoEstoque, "custo_unitario", 4),
)


def test_all_monetary_columns_use_fixed_precision_numeric():
    for model, column_name, scale in MONEY_COLUMNS:
        column_type = model.__table__.c[column_name].type
        assert isinstance(column_type, Numeric), f"{model.__name__}.{column_name}"
        assert column_type.precision == 14
        assert column_type.scale == scale
        assert column_type.asdecimal is False


def test_non_monetary_fractional_values_remain_float():
    for model, column_name in (
        (ConfiguracaoRestaurante, "taxa_servico_padrao"),
        (Insum, "estoque_atual"),
        (ItemEntradaEstoque, "quantidade"),
        (MovimentacaoEstoque, "saldo_posterior"),
    ):
        assert isinstance(model.__table__.c[column_name].type, Float)
