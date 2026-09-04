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
        "tabela_taxas_bairros",
        "tabela_taxas_km",
    ):
        assert f"if config_in.{field} is not None:" in route
        assert f"config.{field} = config_in.{field}" in route


def test_online_delivery_screen_uses_caixa_config_as_the_only_writer():
    screen = source("src/components/caixa/online-menu/OnlineMenuDeliverySettings.tsx")

    assert "${apiBaseUrl}/caixa/configuracoes" in screen
    assert "/api/cardapio-digital/config" not in screen
    assert "pedido_minimo" in screen
    assert "frete_gratis_valor" in screen
    assert "tabela_taxas_bairros" in screen
