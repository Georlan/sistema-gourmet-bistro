import os
from pathlib import Path

TEST_DB_PATH = Path(__file__).resolve().parent / ".pytest_koma.db"

os.environ["ENVIRONMENT"] = "test"
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

import sqlalchemy
_original_create_engine = sqlalchemy.create_engine

def _test_safe_create_engine(url, *args, **kwargs):
    url_str = str(url)
    if "test_authorization.db" in url_str:
        url = f"sqlite:///{TEST_DB_PATH}"
    return _original_create_engine(url, *args, **kwargs)

sqlalchemy.create_engine = _test_safe_create_engine

import pytest
from app.main import app
from app.database import Base, engine

if engine.dialect.name != "sqlite":
    raise RuntimeError(
        "A suíte de testes só pode executar com banco SQLite isolado."
    )

resolved_database = Path(engine.url.database).resolve()

if resolved_database != TEST_DB_PATH.resolve():
    raise RuntimeError(
        f"Banco inseguro para testes: {resolved_database}"
    )

Base.metadata.create_all(bind=engine)


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    Base.metadata.create_all(bind=engine)
    yield
