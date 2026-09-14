from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def source(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_branded_loader_uses_official_assets_theme_delay_and_reduced_motion():
    component = source("src/components/app/KomaLoading.tsx")
    styles = source("src/components/app/komaLoading.css")

    assert "KOMA_WORDMARK_ON_DARK_SRC" in component
    assert "KOMA_WORDMARK_ON_LIGHT_SRC" in component
    assert "delayMs = 180" in component
    assert 'role="status"' in component
    assert 'aria-live="polite"' in component
    assert '[data-koma-theme="light"]' in styles
    assert '@media (prefers-reduced-motion: reduce)' in styles
    assert "koma-loading-k-slide" in styles
    assert "koma-loading-caret-pulse" in styles


def test_branded_loader_is_reserved_for_blocking_or_fullscreen_waits():
    main = source("src/main.tsx")
    route_boundary = source("src/components/app/AppRouteBoundary.tsx")
    unified_entry = source("src/components/auth/UnifiedOperationalEntry.tsx")
    onboarding_entry = source("src/components/onboarding/OnboardingAwareOperationalEntry.tsx")
    cardapio = source("src/cardapio/CardapioPage.tsx")
    motoboy = source("src/components/MotoboyPwaPage.tsx")

    assert '<KomaLoading label="Preparando Kôma…" />' in main
    assert "<KomaLoading label={`Preparando ${label}…`} />" in route_boundary
    assert '<KomaLoading label="Preparando operação…" />' in unified_entry
    assert '<KomaLoading label="Preparando operação…" />' in onboarding_entry
    assert 'label="Carregando cardápio"' in cardapio
    assert 'label="Carregando painel do entregador..."' in motoboy

    # Local/background feedback stays local instead of repeatedly playing the brand animation.
    deferred = source("src/components/caixa/loading/DeferredCashierSection.tsx")
    smartpos_history = source("src/smartpos/SmartPosHistory.tsx")
    mercado_pago = source("src/components/caixa/online-menu/MercadoPagoConnectionCard.tsx")
    estorno = source("src/components/caixa/EstornoModal.tsx")

    assert "KomaLoading" not in deferred
    assert "KomaLoading" not in smartpos_history
    assert "KomaLoading" not in mercado_pago
    assert "KomaLoading" not in estorno
    assert "animate-spin" in smartpos_history
    assert "animate-spin" in mercado_pago
    assert "animate-spin" in estorno


def test_delivery_background_refresh_and_confirmation_do_not_trigger_fullscreen_loading():
    motoboy = source("src/components/MotoboyPwaPage.tsx")

    assert "const isBackground = Boolean(motoboy);" in motoboy
    assert "setIsRefreshing(true);" in motoboy
    assert "setConfirmingId(comandaId);" in motoboy
    assert 'isRefreshing && "animate-spin"' in motoboy
    assert "confirmingId === entrega.id" in motoboy
