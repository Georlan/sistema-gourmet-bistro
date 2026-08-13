import os
from pathlib import Path
import subprocess
import sys

import pytest

from app.config import normalize_supabase_url


@pytest.mark.parametrize("environment", ["test", "development", "production"])
def test_supabase_url_can_be_absent_without_assuming_a_project(environment):
    assert normalize_supabase_url("", environment) == ""


def test_supabase_url_is_normalized_without_trailing_slash():
    assert normalize_supabase_url(
        "https://projeto.supabase.co/",
        "production",
    ) == "https://projeto.supabase.co"


@pytest.mark.parametrize(
    "url",
    [
        "http://projeto.supabase.co",
        "https://usuario:senha@projeto.supabase.co",
        "https://projeto.supabase.co/rest/v1",
        "https://projeto.supabase.co?token=valor",
        "https://projeto.supabase.co#fragmento",
    ],
)
def test_supabase_url_rejects_unsafe_production_values(url):
    with pytest.raises(RuntimeError, match="SUPABASE_URL inválida"):
        normalize_supabase_url(url, "production")


def test_backend_config_has_no_hardcoded_supabase_project_url():
    config_source = (
        Path(__file__).resolve().parents[1] / "app" / "config.py"
    ).read_text(encoding="utf-8")

    assert "iiowhekvahxiepwcdidm.supabase.co" not in config_source


def _run_production_config_import(supabase_url: str | None):
    env = os.environ.copy()
    env.update(
        {
            "ENVIRONMENT": "production",
            "SECRET_KEY": "production-test-secret-key-with-safe-length",
            "ENCRYPTION_KEY": "production-test-encryption-key-with-safe-length",
        }
    )
    if supabase_url is None:
        env.pop("SUPABASE_URL", None)
    else:
        env["SUPABASE_URL"] = supabase_url

    return subprocess.run(
        [sys.executable, "-c", "from app.config import settings"],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def test_production_startup_does_not_depend_on_image_storage():
    result = _run_production_config_import(None)

    assert result.returncode == 0, result.stderr


def test_production_startup_accepts_configured_supabase_url():
    result = _run_production_config_import("https://projeto.supabase.co")

    assert result.returncode == 0, result.stderr
