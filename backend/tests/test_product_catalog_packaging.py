import json
from pathlib import Path

import pytest

from app.product_catalog import load_product_catalog


def test_backend_only_deployment_loads_generated_canonical_catalog(tmp_path):
    backend = tmp_path / "app"
    backend.mkdir()
    source = Path(__file__).resolve().parents[2] / "product-contract.json"
    (backend / "product-contract.json").write_bytes(source.read_bytes())
    catalog = load_product_catalog(repo_root=tmp_path, backend_root=backend)
    assert catalog["plans"]["pocket"]["price"] == 79.9
    assert catalog["online_order_commission_enabled"] is False


def test_repository_rejects_stale_backend_catalog_instead_of_using_wrong_prices(tmp_path):
    backend = tmp_path / "backend"
    backend.mkdir()
    (tmp_path / "product-contract.json").write_text(json.dumps({"plans": {}}))
    (backend / "product-contract.json").write_text(json.dumps({"plans": {"stale": {}}}))
    with pytest.raises(RuntimeError, match="stale"):
        load_product_catalog(repo_root=tmp_path, backend_root=backend)
