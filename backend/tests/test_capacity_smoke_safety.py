import os

import pytest

from tools import capacity_smoke


def test_capacity_smoke_refuses_production(monkeypatch):
    monkeypatch.setenv(
        "KOMA_CAPACITY_ALLOW_HOST",
        "sistema-gourmet-bistro-production.up.railway.app",
    )
    with pytest.raises(ValueError, match="bloqueado contra produção"):
        capacity_smoke.assert_non_production_target(
            "https://sistema-gourmet-bistro-production.up.railway.app"
        )


def test_capacity_smoke_requires_explicit_homologation_host(monkeypatch):
    monkeypatch.delenv("KOMA_CAPACITY_ALLOW_HOST", raising=False)
    with pytest.raises(ValueError, match="KOMA_CAPACITY_ALLOW_HOST"):
        capacity_smoke.assert_non_production_target("https://homolog.example.test")


def test_capacity_smoke_requires_complete_login_pair(monkeypatch):
    monkeypatch.delenv("KOMA_CAPACITY_TOKENS", raising=False)
    monkeypatch.setenv("KOMA_CAPACITY_LOGIN_EMAIL", "qa@example.test")
    monkeypatch.delenv("KOMA_CAPACITY_LOGIN_PASSWORD", raising=False)
    monkeypatch.delenv("KOMA_CAPACITY_LOGIN_RESTAURANT_ID", raising=False)

    with pytest.raises(ValueError, match="LOGIN_EMAIL.*LOGIN_PASSWORD"):
        capacity_smoke.resolve_tokens("https://homolog.example.test", 1.0)


def test_capacity_smoke_percentile_is_nearest_rank():
    assert capacity_smoke.percentile([10, 20, 30, 40], 0.50) == 20
    assert capacity_smoke.percentile([10, 20, 30, 40], 0.95) == 40
