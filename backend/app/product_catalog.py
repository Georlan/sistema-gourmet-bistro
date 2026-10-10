"""Load the canonical catalog, including the generated backend-only deployment copy."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_product_catalog(*, repo_root: Path | None = None, backend_root: Path | None = None) -> dict[str, Any]:
    backend_root = backend_root or Path(__file__).resolve().parents[1]
    repo_root = repo_root or backend_root.parent
    canonical = repo_root / "product-contract.json"
    bundled = backend_root / "product-contract.json"
    if canonical.exists():
        content = canonical.read_bytes()
        if not bundled.exists() or bundled.read_bytes() != content:
            raise RuntimeError("Backend product contract is stale; run npm run sync:product-contract.")
    else:
        content = bundled.read_bytes()
    return json.loads(content)
