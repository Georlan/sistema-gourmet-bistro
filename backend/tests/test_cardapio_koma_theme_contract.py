from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _source(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def test_appearance_only_exposes_logo_and_banner_editing():
    source = _source("src/components/cardapio/CardapioDigitalSettingsPanel.tsx")

    assert "description: 'Logo e capa do restaurante'" in source
    assert "Cores do cardápio" not in source
    assert 'type="color"' not in source
    assert "Cor de destaque" not in source
    assert "Cor de fundo" not in source
    assert 'type="logo"' in source
    assert 'type="banner"' in source


def test_settings_keep_the_menu_on_the_koma_palette():
    source = _source("src/components/cardapio/CardapioDigitalSettingsPanel.tsx")

    assert "const KOMA_MENU_PRIMARY = '#00b894';" in source
    assert "const KOMA_MENU_BACKGROUND = '#090a0f';" in source
    assert "cor_primaria: KOMA_MENU_PRIMARY" in source
    assert "cor_fundo: KOMA_MENU_BACKGROUND" in source


def test_migration_normalizes_existing_custom_menu_colors():
    source = _source(
        "backend/alembic/versions/6c7d8e9f0a1b_standardize_cardapio_koma_theme.py"
    )

    assert "UPDATE restaurantes" in source
    assert "cor_primaria = '#00b894'" in source
    assert "cor_fundo = '#090a0f'" in source
    assert 'down_revision: Union[str, Sequence[str], None] = "5b6c7d8e9f0a"' in source
