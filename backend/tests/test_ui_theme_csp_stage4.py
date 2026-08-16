from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def source(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_theme_is_bootstrapped_before_first_paint_and_react_for_every_route():
    html = source("index.html")
    prepaint = source("public/theme-init.js")
    main = source("src/main.tsx")
    app = source("src/App.tsx")
    theme = source("src/config/theme.ts")
    css = source("src/index.css")

    assert "export const KOMA_THEME_STORAGE_KEY = '@koma:theme'" in theme
    assert "value === 'dark' || value === 'light'" in theme
    assert "DEFAULT_KOMA_THEME: KomaTheme = 'dark'" in theme

    assert '<script src="/theme-init.js"></script>' in html
    assert html.index('/theme-init.js') < html.index('/src/main.tsx')
    assert "localStorage.getItem('@koma:theme')" in prepaint
    assert "data-koma-theme" in prepaint
    assert "<script>" not in html

    assert "initializeKomaTheme();" in main
    assert main.index("initializeKomaTheme();") < main.index("ReactDOM.createRoot")

    assert "readKomaTheme" in app
    assert "persistKomaTheme" in app
    assert "KOMA_THEME_CHANGED_EVENT" in app
    assert "localStorage.getItem('@koma:theme')" not in app
    assert "new Event('koma_theme_changed')" not in app

    assert '[data-koma-theme="dark"]' in css
    assert '[data-koma-theme="light"]' in css
    for token in (
        "--koma-surface-page",
        "--koma-surface-card",
        "--koma-text-primary",
        "--koma-text-muted",
        "--koma-border-default",
        "--koma-accent",
    ):
        assert token in css


def test_cashier_theme_toggle_uses_shared_realtime_theme_contract():
    caixa = source("src/components/CaixaPanel.tsx")
    theme = source("src/config/theme.ts")

    assert "KOMA_THEME_CHANGED_EVENT" in caixa
    assert "nextKomaTheme" in caixa
    assert "persistKomaTheme" in caixa
    assert "readKomaTheme" in caixa
    assert "type KomaTheme" in caixa
    assert "useState<KomaTheme>(() => readKomaTheme())" in caixa

    # Desktop e mobile usam a mesma operação, que persiste e aplica o tema no DOM
    # antes de emitir o evento de sincronização para os outros shells.
    assert caixa.count("setTheme(persistKomaTheme(nextKomaTheme(theme)))") == 2
    assert "localStorage.setItem('@koma:theme'" not in caixa
    assert "new Event('koma_theme_changed')" not in caixa

    storage_index = theme.index("storage.setItem(KOMA_THEME_STORAGE_KEY, theme);")
    apply_index = theme.index("applyKomaTheme(theme);", storage_index)
    event_index = theme.index("window.dispatchEvent(new Event(KOMA_THEME_CHANGED_EVENT));", apply_index)
    assert storage_index < apply_index < event_index


def test_koma_logo_uses_explicit_background_variants_and_semantic_text_color():
    logo = source("src/components/KomaLogo.tsx")
    html = source("index.html")

    assert "logo-koma-on-dark.png" in logo
    assert "logo-koma-on-light.png" in logo
    assert "../assets/logo.png" not in logo
    assert "../assets/logo-light.png" not in logo
    assert "text-koma-accent" in logo
    assert 'href="/logo-koma.png"' in html


def test_sentry_is_optional_and_csp_allows_only_ingestion_not_remote_scripts():
    main = source("src/main.tsx")
    headers = source("public/_headers")
    index = source("index.html")
    env_example = source(".env.example")
    lowered = (headers + "\n" + index).lower()

    assert "const sentryDsn = import.meta.env.VITE_SENTRY_DSN" in main
    assert "if (sentryDsn)" in main
    assert 'VITE_SENTRY_DSN=""' in env_example

    assert "script-src 'self';" in headers
    script_src = headers.split("script-src", 1)[1].split(";", 1)[0]
    assert "'unsafe-inline'" not in script_src
    assert "'unsafe-eval'" not in script_src
    assert "cloudflareinsights" not in lowered
    assert "beacon.min.js" not in lowered

    assert "https://*.ingest.sentry.io" in headers
    assert "https://*.ingest.us.sentry.io" in headers
    assert "https://*.ingest.de.sentry.io" in headers


def test_csp_preserves_required_integrations_and_cardapio_cep_lookup():
    headers = source("public/_headers")
    cardapio = source("src/cardapio/CardapioPage.tsx")

    assert "https://fonts.googleapis.com" in headers
    assert "https://fonts.gstatic.com" in headers
    assert "https://iiowhekvahxiepwcdidm.supabase.co" in headers
    assert "https://sistema-gourmet-bistro-production.up.railway.app" in headers
    assert "wss://sistema-gourmet-bistro-production.up.railway.app" in headers

    assert "https://viacep.com.br" in cardapio
    assert "https://viacep.com.br" in headers

    for port in range(17654, 17665):
        assert f"http://127.0.0.1:{port}" in headers


def test_operational_copy_does_not_restore_legacy_lote_or_ambiguous_financial_labels():
    caixa = source("src/components/CaixaPanel.tsx")

    assert "Lote: #" not in caixa
    assert "Itens do Lote" not in caixa
    assert "import logoImg from '../assets/logo.png'" not in caixa
    assert "Faturamento Total;R$" not in caixa
    assert "Faturamento de Hoje;R$" not in caixa
    assert "Vendas Líquidas;R$" in caixa
    assert "Receita Líquida" in caixa


def test_mobile_contracts_cover_salao_cardapio_relatorios_and_fechamento():
    mesas = source("src/components/mesas/MesasView.tsx")
    products = source("src/components/cardapio/CardapioProdutosTab.tsx")
    finance = source("src/components/relatorios/RelatorioFinanceiroTab.tsx")
    overview = source("src/components/relatorios/RelatoriosVisaoGeralTab.tsx")
    closing = source("src/components/caixa/CaixaFechamentoTab.tsx")

    assert "grid-cols-2 min-[380px]:grid-cols-3 sm:grid-cols-4" in mesas
    assert "pl-[4.25rem]" not in products
    assert "flex flex-wrap items-center justify-between gap-2 pl-0" in products
    assert "min-w-0 flex-1 items-center sm:min-w-[112px] sm:flex-none" in products

    assert "KOMA_CHART_COLORS" in finance
    assert "grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:grid-cols-4" in finance
    assert "flex w-full items-center gap-2 sm:w-auto" in finance

    assert "Faturamento Total" not in overview
    assert "Vendas Líquidas" in overview
    assert "flex w-full flex-wrap items-center gap-2.5 sm:w-auto" in overview

    assert "overflow-x-auto overscroll-x-contain rounded-2xl border border-koma-border" in closing
    assert "focus-within:border-[#2a9f7d]" not in closing
    assert "divide-[#252b28]" not in closing


def test_orders_kanban_has_no_desktop_breakpoint_gap_that_hides_closing_column():
    css = source("src/index.css")
    caixa = source("src/components/CaixaPanel.tsx")

    # O modo compacto termina em 63rem. Logo acima disso, o desktop precisa
    # imediatamente usar colunas flexíveis; um segundo breakpoint em 68rem
    # criava uma faixa em que a terceira coluna ficava fora da viewport.
    assert "@container (max-width: 63rem)" in css
    assert "@container (min-width: 63rem)" in css
    assert "@container (min-width: 68rem)" not in css

    desktop_block = css.split("@container (min-width: 63rem)", 1)[1].split("@container (max-width: 63rem)", 1)[0]
    assert "grid-template-columns: var(--orders-columns, repeat(3, minmax(0, 1fr)));" in desktop_block
    assert ".orders-column" in desktop_block
    assert "min-width: 0;" in desktop_block

    # A terceira etapa continua estruturalmente presente no Kanban.
    assert "orders-column--closing" in caixa
    assert "03 / FECHAMENTO" in caixa
    assert "Prontos para concluir" in caixa



def test_mobile_orders_toolbar_preserves_operational_information_instead_of_hiding_it():
    css = source("src/index.css")
    caixa = source("src/components/CaixaPanel.tsx")

    assert "Aceitar pedidos online automaticamente" in caixa
    assert 'className="orders-auto-accept__label"' in caixa
    assert 'aria-label="Aceitar pedidos online automaticamente"' in caixa

    # Responsividade deve reorganizar o toolbar, não remover significado.
    assert ".orders-auto-accept > span:last-child" not in css
    assert ".orders-search__result {\n    display: none;" not in css
    assert ".orders-delivery-total {\n    display: none;" not in css

    assert "grid-template-columns: minmax(0, 1fr) auto;" in css
    assert ".orders-auto-accept__label" in css
    assert "white-space: normal;" in css
    assert "grid-column: 1 / -1;" in css

def test_temporary_stage4_patch_workflows_are_not_part_of_runtime_branch():
    assert not (ROOT / ".github/workflows/stage4b-one-shot.yml").exists()
    assert not (ROOT / ".github/workflows/stage4c-one-shot.yml").exists()
    assert not (ROOT / ".github/workflows/hotfix-theme-toggle-one-shot.yml").exists()
