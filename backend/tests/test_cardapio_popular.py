from app.main import app
from app.routes import cardapio_config_bridge, cardapio_popular


def test_popular_products_route_is_registered_under_public_menu_owner():
    bridge_paths = {getattr(route, "path", "") for route in cardapio_config_bridge.router.routes}
    assert "/api/cardapio-digital/populares" in bridge_paths, sorted(bridge_paths)

    paths = {getattr(route, "path", "") for route in app.routes}
    cardapio_paths = sorted(path for path in paths if "cardapio" in path)
    assert "/api/cardapio-digital/populares" in paths, cardapio_paths


def test_popular_ranking_has_bounded_cache_and_window():
    assert cardapio_popular.POPULAR_LIMIT == 6
    assert cardapio_popular.POPULAR_WINDOW_DAYS == 90
    assert cardapio_popular.POPULAR_CACHE_SECONDS == 300


def test_popular_ranking_source_keeps_tenant_and_authoritative_catalog_guards():
    source = open(cardapio_popular.__file__, encoding="utf-8").read()
    assert "Item.restaurante_id == rest_id" in source
    assert "Comanda.restaurante_id == rest_id" in source
    assert "Lancamento.restaurante_id == rest_id" in source
    assert "Produto.restaurante_id == rest_id" in source
    assert "Produto.ativo.is_(True)" in source
    assert 'Item.status != "cancelado"' in source
    assert 'Lancamento.status.in_(("aceito", "producao", "pronto", "finalizado"))' in source
    assert 'Cache-Control' in source
