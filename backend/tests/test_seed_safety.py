import pytest

from seed import seed_database


def test_destructive_seed_requires_explicit_confirmation(monkeypatch):
    monkeypatch.delenv("KOMA_ALLOW_DESTRUCTIVE_SEED", raising=False)
    monkeypatch.delenv("KOMA_SEED_ADMIN_PASSWORD", raising=False)

    with pytest.raises(RuntimeError, match="Seed destrutivo bloqueado"):
        seed_database()


def test_destructive_seed_rejects_weak_admin_password(monkeypatch):
    monkeypatch.setenv("KOMA_ALLOW_DESTRUCTIVE_SEED", "YES_I_UNDERSTAND")
    monkeypatch.setenv("KOMA_SEED_ADMIN_PASSWORD", "123")

    with pytest.raises(RuntimeError, match="entre 12 e 72 bytes"):
        seed_database()
