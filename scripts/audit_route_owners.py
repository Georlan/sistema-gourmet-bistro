"""Measure registration work and effective HTTP contracts without querying a database.

Run in a fresh process with ENVIRONMENT=test, an isolated SQLite DATABASE_URL and
PYTHONPATH=backend. --output writes a local comparison artifact, not a source fixture.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
import os
from pathlib import Path
import time


def audit():
    if os.getenv("ENVIRONMENT") != "test" or not os.getenv("DATABASE_URL", "").startswith("sqlite:"):
        raise SystemExit("Use ENVIRONMENT=test and an isolated SQLite DATABASE_URL.")

    from fastapi.routing import APIRoute, iter_route_contexts
    from fastapi.openapi.utils import get_openapi

    constructed = 0
    original_init = APIRoute.__init__

    def counted_init(self, *args, **kwargs):
        nonlocal constructed
        constructed += 1
        original_init(self, *args, **kwargs)

    started = time.perf_counter()
    APIRoute.__init__ = counted_init
    try:
        from app.main import app
    finally:
        APIRoute.__init__ = original_init
    import_ms = round((time.perf_counter() - started) * 1000, 2)

    # Use the same resolved contexts as OpenAPI, including lazy/nested routers.
    routes = [route for route in iter_route_contexts(app.routes) if isinstance(route.original_route, APIRoute)]
    counts = Counter((method, route.path) for route in routes for method in route.methods)
    effective = {}
    first_routes = []
    for route in routes:
        keys = [(method, route.path) for method in sorted(route.methods)]
        if all(key not in effective for key in keys):
            first_routes.append(route)
        for method, path in keys:
            effective.setdefault((method, path), {
                "method": method, "path": path,
                "handler": f"{route.endpoint.__module__}.{route.endpoint.__name__}",
            })

    return {
        "constructed_api_routes": constructed,
        "registered_api_routes": len(routes),
        "effective_operations": len(effective),
        "duplicates": {f"{method} {path}": count for (method, path), count in counts.items() if count > 1},
        "import_ms_observation_only": import_ms,
        "owners": sorted(effective.values(), key=lambda row: (row["path"], row["method"])),
        # Starlette dispatches to the FIRST route; duplicate OpenAPI entries normally
        # reflect the LAST. Compare the actual first-handler contract during cleanup.
        "effective_openapi": get_openapi(title=app.title, version=app.version, routes=first_routes),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = audit()
    if args.output:
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: value for key, value in result.items() if key not in {"owners", "effective_openapi"}}, indent=2))
