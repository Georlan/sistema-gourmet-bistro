from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def source(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def test_delivery_geolocation_is_allowed_only_for_same_origin():
    headers = source("public/_headers")
    main = source("backend/app/main.py")

    expected = "camera=(), microphone=(), geolocation=(self)"
    assert f"Permissions-Policy: {expected}" in headers
    assert f'response.headers["Permissions-Policy"] = "{expected}"' in main
    assert "geolocation=()" not in headers
