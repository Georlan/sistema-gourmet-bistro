from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def source(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_inventory_condenses_recipe_coverage_inside_ingredients_workspace():
    inventory = source("src/components/caixa/inventory/CashierInventory.tsx")
    coverage = source("src/components/caixa/inventory/StockRecipeCoveragePanel.tsx")

    assert "<StockRecipeCoveragePanel" in inventory
    assert "products={apiProdutos}" in inventory
    assert "fichas={fichasTecnicas}" in inventory
    assert "onEdit={() => setShowFichaTecnicaModal(true)}" in inventory
    assert "Fichas técnicas sem virar outra planilha" in coverage
    assert "produtos sem baixa automática" in coverage


def test_supplier_workspace_turns_low_stock_into_one_replenishment_decision():
    inventory = source("src/components/caixa/inventory/CashierInventory.tsx")
    workspace = source("src/components/caixa/inventory/StockReplenishmentWorkspace.tsx")
    resources = source("src/components/caixa/inventory/inventoryResources.ts")

    assert "<StockReplenishmentWorkspace" in inventory
    assert "onRegisterEntry={() => setShowEntradaManualModal(true)}" in inventory
    assert "setActiveSubTab('historico')" in inventory
    assert "if (tab === 'fornecedores') return ['insumos', 'distribuidores'];" in resources

    assert "O que comprar agora" in workspace
    assert "suggestedQuantity = Math.max(0, maximum - current)" in workspace
    assert "estimatedCost: suggestedQuantity * Number(insumo.preco_medio_custo || 0)" in workspace
    assert "Registrar recebimento" in workspace
    assert "Importar NF-e" in workspace


def test_replenishment_workspace_does_not_invent_a_second_purchase_ledger():
    workspace = source("src/components/caixa/inventory/StockReplenishmentWorkspace.tsx")

    # Esta etapa orienta a decisão e reutiliza os owners existentes de entrada/NF-e.
    # Persistência de pedido de compra só entra quando houver um domínio próprio.
    assert "fetch(" not in workspace
    assert "localStorage" not in workspace
    assert "sessionStorage" not in workspace
