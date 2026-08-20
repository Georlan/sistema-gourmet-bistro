import os
from pathlib import Path

TEST_DB_PATH = Path(__file__).resolve().parent / ".pytest_koma.db"
USE_EXTERNAL_TEST_DATABASE = (
    os.getenv("KOMA_PYTEST_USE_EXTERNAL_DATABASE", "false").lower() == "true"
)

if USE_EXTERNAL_TEST_DATABASE and os.environ.get("ENVIRONMENT") not in {None, "test"}:
    raise RuntimeError("Banco externo de testes exige ENVIRONMENT=test.")
os.environ["ENVIRONMENT"] = "test"
os.environ["RUN_MIGRATIONS_ON_STARTUP"] = "false"
if not USE_EXTERNAL_TEST_DATABASE:
    for suffix in ("", "-wal", "-shm", "-journal"):
        Path(f"{TEST_DB_PATH}{suffix}").unlink(missing_ok=True)
    os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH}"
    os.environ["MIGRATION_DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH}"
os.environ["SENTRY_DSN"] = ""
os.environ.setdefault(
    "SECRET_KEY",
    "test_secret_key_for_testing_purposes_only_123456789",
)
os.environ.setdefault(
    "ENCRYPTION_KEY",
    "jW-j311rF_qj0Fh_77R-2n1B-Q0v4sK9M1S2T3U4V5o=",
)

import pytest
from app.main import app
from app.database import Base, current_restaurante_id, engine

if not USE_EXTERNAL_TEST_DATABASE and engine.dialect.name != "sqlite":
    raise RuntimeError(
        "A suíte de testes só pode executar com banco SQLite isolado."
    )

if not USE_EXTERNAL_TEST_DATABASE:
    resolved_database = Path(engine.url.database).resolve()

    if resolved_database != TEST_DB_PATH.resolve():
        raise RuntimeError(
            f"Banco inseguro para testes: {resolved_database}"
        )
else:
    external_host = engine.url.host or ""
    external_database = engine.url.database or ""
    if external_host not in {"127.0.0.1", "localhost"}:
        raise RuntimeError(
            "Banco externo de testes deve estar no host local/efêmero."
        )
    if not any(marker in external_database.lower() for marker in ("test", "smoke")):
        raise RuntimeError(
            "Nome do banco externo deve indicar explicitamente teste ou smoke."
        )

if not USE_EXTERNAL_TEST_DATABASE:
    Base.metadata.create_all(bind=engine)


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    if not USE_EXTERNAL_TEST_DATABASE:
        Base.metadata.create_all(bind=engine)
    try:
        yield
    finally:
        app.dependency_overrides.clear()
        current_restaurante_id.set(None)


@pytest.fixture(scope="session", autouse=True)
def cleanup_isolated_test_database():
    yield
    if USE_EXTERNAL_TEST_DATABASE:
        return
    engine.dispose()
    for suffix in ("", "-wal", "-shm", "-journal"):
        Path(f"{TEST_DB_PATH}{suffix}").unlink(missing_ok=True)
