from app.routes.modificadores import router


def test_hamburger_suggestion_endpoint_is_not_registered():
    paths = {getattr(route, "path", "") for route in router.routes}
    assert "/cardapio/modificadores/sugestoes/hamburgueria" not in paths
    assert "/cardapio/modificadores/grupos" in paths
