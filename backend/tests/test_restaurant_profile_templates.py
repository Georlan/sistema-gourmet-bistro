from app.restaurant_profile_templates import build_template_preview, list_template_keys


def test_template_catalog_is_explicit_and_initially_scoped():
    assert list_template_keys() == ("pizzaria", "acai", "churrasco")


def test_template_preview_is_non_persistent_and_requires_confirmation():
    preview = build_template_preview("pizzaria")

    assert preview is not None
    assert preview["profile_key"] == "pizzaria"
    assert preview["mode"] == "preview"
    assert preview["requires_confirmation"] is True
    assert "price" not in repr(preview).lower()
    assert "preco" not in repr(preview).lower()
    assert "valor" not in repr(preview).lower()


def test_template_preview_does_not_share_mutable_state():
    first = build_template_preview("acai")
    second = build_template_preview("acai")

    assert first is not None and second is not None
    first["categories"].append("Mutação local")
    assert "Mutação local" not in second["categories"]


def test_unknown_template_has_no_fallback_side_effect():
    assert build_template_preview("generic") is None
    assert build_template_preview("desconhecido") is None
