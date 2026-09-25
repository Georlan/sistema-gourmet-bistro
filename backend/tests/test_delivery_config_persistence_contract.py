from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def source(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def test_caixa_config_update_persists_canonical_delivery_fields():
    route = source("backend/app/routes/caixa.py")

    assert '@router.put("/configuracoes"' in route
    assert 'require_permission("configuracoes:administrar")' in route

    for field in (
        "delivery_ativo",
        "pedido_minimo",
        "frete_gratis_valor",
        "tipo_taxa_entrega",
    ):
        assert f"if config_in.{field} is not None:" in route
        assert f"config.{field} = config_in.{field}" in route

    assert "if config_in.tabela_taxas_bairros is not None:" in route
    assert "normalize_neighborhood_fee_table(" in route
    assert "config.tabela_taxas_bairros = list(" in route

    assert "if config_in.tabela_taxas_km is not None:" in route
    assert "normalize_distance_fee_config(" in route
    assert "config.tabela_taxas_km = (" in route
    assert '@router.put("/configuracoes/delivery-origin")' in route
    assert "DeliveryOriginUpdate" in route
    assert '@router.get("/configuracoes/delivery-suggestion")' in route
    assert "suggest_delivery_fee" in route


def test_online_delivery_screen_uses_caixa_config_as_the_only_writer():
    screen = source("src/components/caixa/online-menu/OnlineMenuDeliverySettings.tsx")

    assert "${apiBaseUrl}/caixa/configuracoes" in screen
    assert "/api/cardapio-digital/config" not in screen
    assert "pedido_minimo" in screen
    assert "frete_gratis_valor" in screen

    # PR #728 simplificou deliberadamente a UI pública para taxa por bairro,
    # mantendo o suporte backend por distância apenas como compatibilidade.
    # Os testes dedicados de distância continuam cobrindo esse backend.
    assert "tabela_taxas_km: []" in screen
    assert "tipo_taxa_entrega: 'bairro'" in screen
    assert "Taxas de Entrega por Bairro" in screen
    assert "Taxa padrão / mínima (R$)" in screen
    assert "Bairros com taxa diferenciada" in screen
    assert "Valor por km (R$)" not in screen
    assert "${apiBaseUrl}/caixa/configuracoes/delivery-origin" not in screen
    assert "${apiBaseUrl}/caixa/configuracoes/delivery-suggestion" not in screen
