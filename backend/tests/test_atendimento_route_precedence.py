from app.main import app


def _matching(path: str, method: str):
    return [
        route
        for route in app.routes
        if getattr(route, "path", None) == path
        and method.upper() in getattr(route, "methods", set())
    ]


def test_operational_routes_shadow_legacy_handlers_in_fastapi_order():
    protected = [
        ("/mesas/{mesa_id}/imprimir-recibo", "POST"),
        ("/comandas/venda-direta", "POST"),
        ("/comandas/{comanda_id}/lancamentos", "POST"),
        ("/comandas/{comanda_id}/transferir/{nova_mesa_id}", "POST"),
        ("/comandas/mesclar", "POST"),
        ("/comandas/desmesclar", "POST"),
        ("/comandas/itens/{item_id}/transferir/{nova_mesa_id}", "POST"),
        ("/comandas/{comanda_id}/reabrir", "PUT"),
    ]

    for path, method in protected:
        matches = _matching(path, method)
        assert matches, f"rota ausente: {method} {path}"
        assert matches[0].endpoint.__module__ == "app.routes.atendimentos", (
            f"{method} {path} está sendo interceptada por "
            f"{matches[0].endpoint.__module__}.{matches[0].endpoint.__name__}"
        )


def test_batch_transfer_has_single_non_legacy_route():
    matches = _matching("/comandas/itens/transferir-lote/{nova_mesa_id}", "POST")
    assert len(matches) == 1
    assert matches[0].endpoint.__module__ == "app.routes.atendimentos"
