"""
Global Pytest Configuration & Safety Circuit Breaker.
Enforces strict test database isolation and prevents tests from running against Production.
"""
import os

import pytest

PROD_DB_INDICATORS = [
    "iiowhekvahxiepwcdidm",
    "aws-1-us-west-2.pooler.supabase.com",
    "sistema-gourmet-bistro-production.up.railway.app",
]

STAGE3C_ISOLATED_SQLITE_TESTS = {
    "test_financial_cash_stage3c.py",
    "test_financial_refund_history_stage3c.py",
    "test_financial_cash_extreme_stage3c.py",
    "test_financial_refund_retry_stage3c.py",
}


def pytest_configure(config):
    """
    Pytest hook executed at startup before any test collection/execution.
    Checks environment variables and blocks execution if PRODUCTION credentials are used.
    """
    raw_db_url = os.environ.get("DATABASE_URL", "")
    raw_sup_url = os.environ.get("SUPABASE_URL", "")

    # Check for production DB match
    for indicator in PROD_DB_INDICATORS:
        if indicator in raw_db_url or indicator in raw_sup_url:
            # Override for test suite isolation
            os.environ["DATABASE_URL"] = "sqlite:///./test_suite_isolated.db"
            os.environ["SUPABASE_URL"] = "https://mock-test-supabase.local"
            os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "mock_test_service_role_key_12345"
            os.environ["VITE_SUPABASE_URL"] = "https://mock-test-supabase.local"

            # Update app settings if already loaded
            try:
                from app.config import settings
                settings.DATABASE_URL = "sqlite:///./test_suite_isolated.db"
                settings.SUPABASE_URL = "https://mock-test-supabase.local"
                settings.SUPABASE_SERVICE_ROLE_KEY = "mock_test_service_role_key_12345"
            except Exception:
                pass
            break


@pytest.fixture(scope="session", autouse=True)
def enforce_test_database_isolation():
    """
    Autouse session fixture that enforces database isolation for all tests.
    """
    db_url = os.environ.get("DATABASE_URL", "")
    for indicator in PROD_DB_INDICATORS:
        if indicator in db_url:
            pytest.exit(
                f"\n🚨 SAFETY CIRCUIT BREAKER BLOCKED TEST EXECUTION! 🚨\n"
                f"Attempted to run tests against PRODUCTION environment.\n"
                f"Indicator matched: '{indicator}' in DATABASE_URL.\n",
                returncode=1,
            )
    yield


@pytest.fixture(autouse=True)
def isolate_stage3c_sqlite_metadata_seed(request):
    """Impede a seed global do runtime de contaminar bancos SQLite locais do 3C.

    `Base.metadata.after_create` cria `Restaurante(id=1)` para o banco configurado
    da aplicação. As suítes 3C constroem engines SQLite efêmeras próprios e
    semeiam explicitamente seus tenants; deixar o listener global atuar nesses
    engines cria uma segunda origem de fixture e dispara PK duplicada antes de
    qualquer regra financeira ser testada.

    O listener é removido apenas enquanto um teste 3C isolado executa e é
    restaurado no teardown. Runtime e demais suítes mantêm o comportamento
    histórico intacto.
    """
    filename = os.path.basename(str(request.node.fspath))
    if filename not in STAGE3C_ISOLATED_SQLITE_TESTS:
        yield
        return

    from sqlalchemy import event
    from app.database import Base, insert_default_restaurant

    registered = event.contains(
        Base.metadata,
        "after_create",
        insert_default_restaurant,
    )
    if registered:
        event.remove(
            Base.metadata,
            "after_create",
            insert_default_restaurant,
        )

    try:
        yield
    finally:
        if registered and not event.contains(
            Base.metadata,
            "after_create",
            insert_default_restaurant,
        ):
            event.listen(
                Base.metadata,
                "after_create",
                insert_default_restaurant,
            )
