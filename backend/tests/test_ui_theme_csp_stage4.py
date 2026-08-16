from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def source(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_theme_is_bootstrapped_before_react_for_every_route():
    main = source("src/main.tsx")
    theme = source("src/config/theme.ts")
    css = source("src/index.css")

    assert "export const KOMA_THEME_STORAGE_KEY = '@koma:theme'" in theme
    assert "value === 'dark' || value === 'light'" in theme
    assert "DEFAULT_KOMA_THEME: KomaTheme = 'dark'" in theme
    assert "initializeKomaTheme();" in main
    assert main.index("initializeKomaTheme();") < main.index("ReactDOM.createRoot")

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


def test_koma_logo_uses_explicit_background_variants_and_semantic_text_color():
    logo = source("src/components/KomaLogo.tsx")

    assert "logo-koma-on-dark.png" in logo
    assert "logo-koma-on-light.png" in logo
    assert "../assets/logo.png" not in logo
    assert "../assets/logo-light.png" not in logo
    assert "text-koma-accent" in logo


def test_sentry_is_optional_and_csp_allows_only_ingestion_not_remote_scripts():
    main = source("src/main.tsx")
    headers = source("public/_headers")
    index = source("index.html")
    lowered = (headers + "\n" + index).lower()

    assert "const sentryDsn = import.meta.env.VITE_SENTRY_DSN" in main
    assert "if (sentryDsn)" in main
    assert "script-src 'self';" in headers
    assert "'unsafe-eval'" not in headers
    assert "cloudflareinsights" not in lowered
    assert "beacon.min.js" not in lowered

    assert "https://*.ingest.sentry.io" in headers
    assert "https://*.ingest.us.sentry.io" in headers
    assert "https://*.ingest.de.sentry.io" in headers


def test_csp_preserves_fonts_supabase_backend_websocket_and_local_print_pairing():
    headers = source("public/_headers")

    assert "https://fonts.googleapis.com" in headers
    assert "https://fonts.gstatic.com" in headers
    assert "https://iiowhekvahxiepwcdidm.supabase.co" in headers
    assert "https://sistema-gourmet-bistro-production.up.railway.app" in headers
    assert "wss://sistema-gourmet-bistro-production.up.railway.app" in headers

    for port in range(17654, 17665):
        assert f"http://127.0.0.1:{port}" in headers
