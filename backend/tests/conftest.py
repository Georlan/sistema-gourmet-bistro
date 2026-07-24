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
                returncode=1
            )
