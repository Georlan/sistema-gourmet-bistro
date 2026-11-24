from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _source(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def test_appearance_exposes_logo_banner_and_normalized_brand_color_without_background_override():
    source = _source("src/components/cardapio/CardapioDigitalSettingsPanel.tsx")

    assert ("Imagens do restaurante" in source or 'title="Logo e capa"' in source)
    assert ("Logo e capa" in source or "Você personaliza somente as imagens que identificam o restaurante." in source)
    assert 'type="logo"' in source
    assert 'type="banner"' in source
    assert "BRAND_COLOR_PRESETS" in source
    assert 'type="color"' in source
    assert "normalizeConfigBrandColor" in source
    assert "Cor de fundo" not in source
    assert "cor_fundo" not in source


def test_settings_keep_koma_default_primary_and_oklch_theme_tokens():
    source = _source("src/components/cardapio/CardapioDigitalSettingsPanel.tsx")

    assert "const KOMA_MENU_PRIMARY = '#00b894';" in source
    assert "cor_primaria: KOMA_MENU_PRIMARY" in source
    assert "buildMenuThemeTokens" in source


def test_migration_normalizes_existing_custom_menu_colors():
    source = _source(
        "backend/alembic/versions/6c7d8e9f0a1b_standardize_cardapio_koma_theme.py"
    )

    assert "UPDATE restaurantes" in source
    assert "cor_primaria = '#00b894'" in source
    assert "cor_fundo = '#090a0f'" in source
    assert 'down_revision: Union[str, Sequence[str], None] = "5b6c7d8e9f0a"' in source
