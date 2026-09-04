from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def source(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_public_menu_does_not_inherit_operator_theme_prepaint_or_bootstrap():
    prepaint = source("public/theme-init.js")
    main = source("src/main.tsx")

    assert "isPublicMenuRoute" in prepaint
    assert "pathname.indexOf('/cardapio') === 0" in prepaint
    assert "params.get('view') === 'cardapio'" in prepaint
    public_branch = prepaint.index("if (isPublicMenuRoute)")
    storage_read = prepaint.index("window.localStorage.getItem('@koma:theme')")
    assert public_branch < storage_read
    assert "document.documentElement.setAttribute('data-koma-theme', 'dark')" in prepaint

    assert "function isPublicMenuRoute(): boolean" in main
    assert 'pathname.startsWith("/cardapio")' in main
    assert 'params.get("view") === "cardapio"' in main
    public_runtime_branch = main.index("if (isPublicMenuRoute())")
    operational_theme_init = main.index("initializeKomaTheme();")
    react_root = main.index("ReactDOM.createRoot")
    assert public_runtime_branch < operational_theme_init < react_root
    assert 'document.documentElement.setAttribute("data-koma-theme", "dark")' in main


def test_public_menu_config_sync_is_tenant_scoped_and_refetches_source_of_truth():
    page = source("src/cardapio/CardapioPage.tsx")
    settings_panel = source("src/components/cardapio/CardapioDigitalSettingsPanel.tsx")
    route = source("backend/app/routes/cardapio_digital.py")
    manager = source("backend/app/websocket_manager.py")

    assert "/api/cardapio-digital/public?" in page
    assert '{ cache: "no-store" }' in page
    assert '${WS_BASE_URL}/ws/cliente?restaurante_id=${activeBrand.id}' in page
    assert '["catalog_updated", "config_updated", "store_status_changed"]' in page
    assert "setTimeout(() => void loadRestaurantData(), 100)" in page

    assert "`${apiBaseUrl}/api/cardapio-digital/config`" in settings_panel
    assert "headers: authHeaders" in settings_panel
    assert "method: 'PUT'" in settings_panel

    assert "with tenant_session_scope(db, rest_id):" in route
    assert 'require_permission("configuracoes:administrar")' in route
    assert "notify_cardapio_config_update(background_tasks, rest_id)" in route
    assert '{"event": "config_updated"}' in route

    assert '"config_updated"' in manager
    assert '"catalog_updated"' in manager
    assert '"client": [WebSocket...]' in manager
    assert "self.active_connections[restaurante_id]" in manager
