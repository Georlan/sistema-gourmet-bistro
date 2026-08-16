from app.main import app


def _route_index(module: str, endpoint_name: str) -> int:
    for index, route in enumerate(app.routes):
        endpoint = getattr(route, "endpoint", None)
        if endpoint is None:
            continue
        if endpoint.__module__ == module and endpoint.__name__ == endpoint_name:
            return index
    available = [
        f"{getattr(getattr(route, 'endpoint', None), '__module__', '?')}."
        f"{getattr(getattr(route, 'endpoint', None), '__name__', '?')} "
        f"{getattr(route, 'path', '?')}"
        for route in app.routes
    ]
    raise AssertionError(
        f"endpoint ausente: {module}.{endpoint_name}. Rotas carregadas: {available}"
    )


def test_operational_handlers_are_registered_before_their_legacy_equivalents():
    """FastAPI resolve a primeira rota compatível; a ordem é parte do contrato.

    Validamos pelos endpoints, não pela representação textual de `route.path`,
    que varia entre versões Starlette/FastAPI para parâmetros dinâmicos.
    """
    pairs = [
        ("imprimir_recibo_mesa_com_identidade", "app.routes.tables", "imprimir_recibo_mesa"),
        ("venda_direta_respeitando_familia_principal", "app.routes.orders", "criar_venda_direta"),
        ("lancar_itens_na_familia_principal", "app.routes.orders", "lancar_itens"),
        ("transferir_atendimento_compativel", "app.routes.orders", "transferir_comanda"),
        ("mesclar_atendimentos_compativel", "app.routes.orders", "mesclar_comandas"),
        ("desmesclar_atendimento_compativel", "app.routes.orders", "desmesclar_comanda"),
        ("transferir_item_compativel", "app.routes.orders", "transferir_item"),
        ("reabrir_comanda_compativel", "app.routes.orders", "reabrir_comanda"),
    ]

    for operational_name, legacy_module, legacy_name in pairs:
        operational = _route_index("app.routes.atendimentos", operational_name)
        legacy = _route_index(legacy_module, legacy_name)
        assert operational < legacy, (
            f"{operational_name} precisa ser registrado antes de "
            f"{legacy_module}.{legacy_name} para sombrear a URL legada"
        )


def test_batch_transfer_is_exposed_by_operational_router():
    index = _route_index("app.routes.atendimentos", "transferir_itens_em_lote")
    route = app.routes[index]
    assert "POST" in getattr(route, "methods", set())
    assert "transferir-lote" in getattr(route, "path", "")
