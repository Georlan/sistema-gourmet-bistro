from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _source(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def test_stage3d_core_money_inputs_use_canonical_money_input_without_legacy_parsers():
    panel = _source("src/components/CaixaPanel.tsx")
    checkout = _source("src/components/caixa/checkout/CheckoutDialog.tsx")
    owners = checkout + _source("src/components/caixa/checkout/useCheckoutController.ts") + _source("src/components/caixa/shift/useCashShift.ts")

    assert "import MoneyInput from './MoneyInput';" in panel
    assert "import MoneyInput from '../../MoneyInput';" in checkout
    assert "<CheckoutDialog" in panel

    # Fluxos monetários operacionais não podem voltar a interpretar strings
    # manualmente. MoneyInput entrega o valor decimal já normalizado para a UI;
    # o backend continua sendo a autoridade de validação financeira.
    for forbidden in (
        "parseFloat(saldoInicial)",
        "parseFloat(paymentValor)",
        "parseFloat(prodFormPreco)",
        "parseFloat(deliveryTaxa)",
        "setPdvDeliveryTaxa('0.00')",
    ):
        assert forbidden not in panel
        assert forbidden not in owners

    assert "onValueChange={setSaldoInicial}" in panel
    assert "onValueChange={setPaymentValor}" in checkout
    assert "onValueChange={setProdFormPreco}" in panel
    assert panel.count(
        "onValueChange={(value) => setInsumoFormCusto(Number(value || 0))}"
    ) == 2


def test_stage3d_hybrid_fields_distinguish_money_from_points_without_local_coupons():
    panel = _source("src/components/CaixaPanel.tsx")

    # Novo cliente: pontos são quantidade inteira; cashback é dinheiro.
    assert "const [newCrmSaldo, setNewCrmSaldo] = useState<number | ''>(0);" in panel
    assert "fidelidadeConfig.tipo_recompensa === 'PONTOS' ? (" in panel
    assert "onValueChange={setNewCrmSaldo}" in panel
    assert "step={fidelidadeConfig.tipo_recompensa === 'PONTOS' ? '1' : '0.01'}" not in panel
    assert "setNewCrmSaldo('0')" not in panel

    # Ajuste de cashback é monetário.
    assert "onValueChange={(value) => setCrmFormCashback(Number(value || 0))}" in panel
    assert "onChange={(e) => setCrmFormCashback(Number(e.target.value))}" not in panel

    # O antigo cupom de desconto era apenas estado local e não pode voltar como
    # uma autoridade financeira paralela ao backend.
    assert "newCouponTipo" not in panel
    assert "setNewCouponVal" not in panel


def test_stage3d_cash_closing_uses_money_input_instead_of_custom_money_parser():
    source = _source("src/components/FechamentoCegoModal.tsx")

    assert "import MoneyInput from './MoneyInput';" in source
    assert source.count("<MoneyInput") == 4
    assert "parseFloat" not in source
    assert "useState<number | ''>" in source


def test_stage3d_legacy_generic_card_method_has_human_readable_label():
    source = _source("src/components/caixa/CaixaTurnoAtualTab.tsx")

    assert "cartao: 'Cartão'" in source
    assert "cartao_credito: 'Crédito'" in source
    assert "cartao_debito: 'Débito'" in source


def test_stage3d_dead_quick_actions_checkout_cannot_return_as_parallel_financial_authority():
    panel = _source("src/components/CaixaPanel.tsx")
    legacy_modal = ROOT / "src/components/ComandaActionsModal.tsx"

    assert not legacy_modal.exists()
    assert "ComandaActionsModal" not in panel
    assert "quickActionsOrder" not in panel
    assert "setQuickActionsOrder" not in panel
    assert "MODAL DE AÇÕES RÁPIDAS (RATEIO / DESCONTO / CHECKOUT)" not in panel
