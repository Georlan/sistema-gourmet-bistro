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

    # A troca acontece no mesmo limite dos dois lados: até 68rem o operador usa
    # as etapas compactas; a partir daí as três colunas passam a caber de fato.
    assert "@container (max-width: 68rem)" in css
    assert "@container (min-width: 68rem)" in css
    assert "@container (max-width: 63rem)" not in css
    assert "@container (min-width: 63rem)" not in css

    desktop_block = css.split("@container (min-width: 68rem)", 1)[1].split("@container (max-width: 68rem)", 1)[0]
    assert "grid-template-columns: var(--orders-columns, repeat(3, minmax(0, 1fr)));" in desktop_block
    assert ".orders-column" in desktop_block
    assert "min-width: 0;" in desktop_block

    # A terceira etapa continua estruturalmente presente no Kanban.
    assert "orders-column--closing" in caixa
    assert "03 / FECHAMENTO" in caixa
    assert "Prontos para concluir" in caixa


def test_cashier_mobile_uses_one_natural_scroll_owner():
    css = source("src/index.css")
    app = source("src/App.tsx")
    caixa = source("src/components/CaixaPanel.tsx")

    management_shell = css.split(".management-shell {", 1)[1].split("}", 1)[0]
    assert "min-height: 100svh;" in management_shell
    assert "overflow:" not in management_shell

    assert "management-shell w-full bg-koma-page" in app
    assert (
        "w-full h-screen bg-koma-page text-koma-foreground flex flex-col "
        "font-sans overflow-hidden"
    ) not in app

    shell_block = css.split(".cashier-shell {", 1)[1].split("}", 1)[0]
    assert "height: 100dvh;" in shell_block
    assert "min-height: 100svh;" in shell_block

    assert "cashier-shell flex w-full h-screen" not in caixa
    assert "'cashier-content', 'flex-1', 'overflow-y-auto'" not in caixa
    assert "'orders-board', 'flex-1', 'gap-3', 'overflow-x-auto'" not in caixa
    assert "snap-mandatory" not in caixa
    assert "snap-center" not in caixa

    mobile_block = css.split("@media (max-width: 768px)", 1)[1].split(
        "@media (min-width: 480px) and (max-width: 768px)", 1
    )[0]
    assert ".cashier-shell" in mobile_block
    assert "height: auto;" in mobile_block
    assert ".cashier-content" in mobile_block
    assert "overflow: visible;" in mobile_block
    assert ".orders-column__body" in mobile_block
    assert "overflow-y: visible !important;" in mobile_block

    assert "@media (hover: none) and (pointer: coarse)" in css


def test_cashier_narrow_cards_return_space_to_order_identity():
    css = source("src/index.css")

    narrow_block = css.split("@container (max-width: 30rem)", 1)[1].split(
        ".cashier-shell .text-\\[8px\\]", 1
    )[0]
    assert "grid-template-columns: clamp(2.55rem, 13vw, 2.9rem) minmax(0, 1fr) auto;" in narrow_block
    assert ".orders-card__identity-side" in narrow_block
    assert "min-width: 3.35rem;" in narrow_block
    assert ".orders-card__price" in narrow_block
    assert "white-space: nowrap;" in narrow_block


def test_cashier_reference_viewports_choose_expected_kanban_mode():
    # Aproxima a largura real do container: a sidebar fixa só existe a partir
    # de 1024px e o conteúdo desktop desconta 2.5rem de padding horizontal.
    cases = {
        (360, 800): "compact",
        (390, 844): "compact",
        (412, 915): "compact",
        (768, 1024): "compact",
        (1024, 768): "compact",
        (1366, 768): "compact",
        (1440, 900): "wide",
        (1920, 1080): "wide",
    }
    breakpoint_px = 68 * 16

    for (viewport_width, _viewport_height), expected in cases.items():
        if viewport_width >= 1024:
            container_width = viewport_width - (17 * 16) - (2.5 * 16)
        else:
            container_width = viewport_width - (1.4 * 16)
        actual = "wide" if container_width >= breakpoint_px else "compact"
        assert actual == expected, (viewport_width, container_width, expected)


def test_cashier_low_desktop_height_compacts_non_operational_chrome():
    css = source("src/index.css")

    assert "@media (min-width: 1024px) and (max-height: 820px)" in css
    low_height_block = css.split(
        "@media (min-width: 1024px) and (max-height: 820px)", 1
    )[1].split("@media (prefers-reduced-motion: reduce)", 1)[0]
    for selector in (
        ".cashier-topbar",
        ".cashier-subnav",
        ".cashier-content",
        ".orders-hero",
        ".orders-toolbar",
        ".orders-column__header",
    ):
        assert selector in low_height_block



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
    assert "position: static !important;" in css

def test_temporary_stage4_patch_workflows_are_not_part_of_runtime_branch():
    assert not (ROOT / ".github/workflows/stage4b-one-shot.yml").exists()
    assert not (ROOT / ".github/workflows/stage4c-one-shot.yml").exists()
    assert not (ROOT / ".github/workflows/hotfix-theme-toggle-one-shot.yml").exists()
