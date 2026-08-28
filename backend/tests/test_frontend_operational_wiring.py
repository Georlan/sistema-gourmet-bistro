from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _source(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def test_production_kitchen_uses_real_finish_handler_and_marketing_stays_read_only():
    app = _source("src/App.tsx")
    marketing_demo = _source("src/landing/product/ProductScreen.tsx")

    assert "onFinishPreparation={handleFinishPreparation}" in app
    assert "onFinishPreparation={() => {}}" not in app
    assert "onFinishPreparation={() => {}}" in marketing_demo


def test_cashier_operational_forms_are_wired_to_real_handlers():
    panel = _source("src/components/CaixaPanel.tsx")

    for removed_stub in (
        "handleSaveFidelityConfig",
        "handleDespacharPedido",
        "handleCadastrarMotoboy",
    ):
        assert removed_stub not in panel

    assert "onSubmit={handleSaveFidelidadeConfig}" in panel
    assert "`${apiBaseUrl}/fidelidade/config`" in panel
    assert "/fidelidade/configuracao" not in panel
    assert "onClick={() => handleDespacharKanban(order.id, motoboyId)}" in panel
    assert "parseInt(motoboyId)" not in panel
    assert "onSubmit={(e) => handleAddMotoboy(e, novoMotoboyNome, novoMotoboyTelefone)}" in panel
    assert "setNewMotoboyNome('');" in panel
    assert "setNewMotoboyTelefone('');" in panel


def test_operator_logout_only_clears_authentication_keys():
    panel = _source("src/components/CaixaPanel.tsx")
    logout = panel.split("const handleLogoutOperator = () => {", 1)[1].split("\n  };", 1)[0]

    assert "clearOperatorSession();" in logout
    assert "localStorage.clear()" not in logout
    for preserved_key in (
        "@koma:theme",
        "koma_font_size",
        "koma_active_order",
        "koma_smartpos_session",
    ):
        assert f'localStorage.removeItem("{preserved_key}")' not in logout


def test_print_actions_never_report_success_without_a_real_handler():
    modal = _source("src/components/MesaDetailsModalBase.tsx")

    assert "finalize-physical-print-mock-btn" not in modal
    assert "Simulated Print Button" not in modal
    assert "disabled={!onPrintReceipt}" in modal
    assert "disabled={!onPrintKitchenLaunch || !selectedOrderToPrint}" in modal


def test_fabricated_ai_and_whatsapp_prototypes_are_not_shipped_in_the_ui():
    panel = _source("src/components/CaixaPanel.tsx")
    menu = _source("src/cardapio/CardapioPage.tsx")
    plans = _source("src/config/subscriptionPlans.ts")
    billing = _source("src/components/assinatura/AssinaturaPixTab.tsx")

    for prototype_marker in (
        "Assistente Kôma",
        "CHAT CO-PILOTO (demonstração)",
        "Bruno Santos",
        "Piloto Automático",
        "Parâmetros de governança da IA salvos no banco de dados",
    ):
        assert prototype_marker not in panel

    assert "CardapioAiChefAssistant" not in menu
    assert not (ROOT / "src/cardapio/components/CardapioAiChefAssistant.tsx").exists()
    assert not (ROOT / "src/components/assistente/AssistenteConfigTab.tsx").exists()
    assert not (ROOT / "src/components/assistente/AssistenteSimuladorTab.tsx").exists()

    for unsupported_offer in (
        "Chef Virtual Kôma",
        "Copiloto IA",
        "iaChefRespostas",
        "Disparos Automáticos",
        "Taxas Gateway (Asaas)",
        "Pix Automático In-App",
        "Cartão de Crédito Online",
        "pixInApp",
        "creditCard",
    ):
        assert unsupported_offer not in plans
        assert unsupported_offer not in billing

    for fabricated_local_flow in (
        "RECUPERADOR DE VENDAS",
        "CUPONS DE DESCONTO",
        "KOMA10",
        "false && activeTab",
        "Simulador de Custos (CMV)",
    ):
        assert fabricated_local_flow not in panel


def test_operational_whatsapp_delivery_is_automatic_and_tokens_stay_server_side():
    caixa_source = _source("backend/app/routes/caixa.py")
    auth_source = _source("backend/app/routes/auth.py")
    frontend_source = _source("src/components/CaixaPanel.tsx")
    team_ui_source = _source("src/components/equipe/EquipePessoasTab.tsx")

    motoboy_source = _source("src/components/MotoboyPwaPage.tsx")

    assert "agendar_convite_equipe_task" in caixa_source
    assert "agendar_convite_equipe_task" in auth_source
    assert "[WHATSAPP SIMULADO]" not in caixa_source
    assert "openWaInvite" not in frontend_source
    assert "handleDespacharWhatsApp" not in frontend_source
    assert "/delivery/despachar" in frontend_source
    assert "window.open(waUrl" not in frontend_source
    assert "wa.me" not in motoboy_source
    assert "O convite será enviado automaticamente pelo WhatsApp." in team_ui_source
    assert "Cadastrar e enviar" in team_ui_source
