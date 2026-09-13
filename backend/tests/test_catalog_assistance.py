from __future__ import annotations

import pytest

from app.catalog_assistance import (
    MAX_CATALOG_SOURCE_SIZE,
    detect_catalog_source_type,
    safe_catalog_filename,
)
from app.main import app


def test_assisted_catalog_routes_are_registered():
    paths = app.openapi().get("paths", {})
    assert "post" in paths["/api/onboarding/catalog-assistance"]
    assert "get" in paths["/api/super-admin/catalog-assistance"]
    assert "get" in paths["/api/super-admin/catalog-assistance/{tenant_id}/{request_id}/file"]
    assert "post" in paths["/api/super-admin/catalog-assistance/{tenant_id}/{request_id}/publish"]


def test_catalog_source_detection_uses_file_signature_not_only_mime():
    assert detect_catalog_source_type("application/pdf", b"%PDF-1.7\nmenu") == "application/pdf"
    assert detect_catalog_source_type("image/jpg", b"\xff\xd8\xffmenu") == "image/jpeg"
    assert detect_catalog_source_type("application/octet-stream", b"\x89PNG\r\n\x1a\nmenu") == "image/png"

    with pytest.raises(ValueError, match="não corresponde"):
        detect_catalog_source_type("image/png", b"%PDF-1.7\nmenu")
    with pytest.raises(ValueError, match="Formato inválido"):
        detect_catalog_source_type("application/pdf", b"not-a-real-file")


def test_catalog_filename_is_sanitized_and_extension_matches_content():
    assert safe_catalog_filename("../Cardápio Cliente.PDF", "application/pdf") == "Cardápio Cliente.PDF"
    assert safe_catalog_filename("menu.png", "image/jpeg") == "menu.jpg"
    assert safe_catalog_filename("menu\nfinal", "image/png") == "menufinal.png"


def test_catalog_source_limit_is_bounded_for_database_storage():
    assert MAX_CATALOG_SOURCE_SIZE == 10 * 1024 * 1024
