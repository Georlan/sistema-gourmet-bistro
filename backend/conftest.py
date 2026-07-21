import os
os.environ.setdefault("SECRET_KEY", "test_secret_key_for_testing_purposes_only_123456789")
os.environ.setdefault("ENCRYPTION_KEY", "jW-j311rF_qj0Fh_77R-2n1B-Q0v4sK9M1S2T3U4V5o=")

import pytest
from app.main import app
from app.database import current_restaurante_id

@pytest.fixture(autouse=True, scope="session")
def set_default_test_tenant_session():
    token_var = current_restaurante_id.set(1)
    yield
    current_restaurante_id.reset(token_var)

@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


