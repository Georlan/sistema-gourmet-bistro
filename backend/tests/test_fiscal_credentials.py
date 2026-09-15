import base64
import datetime
from pathlib import Path

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

from app.fiscal_credential_models import FiscalCredentialSecret
from app.routes import fiscal_onboarding
from app.services.fiscal_credentials import FiscalCredentialError, _parse_pfx


PASSWORD = "test-only-password"


def _test_pfx(*, expired: bool = False) -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name(
        [x509.NameAttribute(NameOID.COMMON_NAME, "KOMA Fiscal Test Certificate")]
    )
    now = datetime.datetime.now(datetime.timezone.utc)
    not_after = now - datetime.timedelta(days=1) if expired else now + datetime.timedelta(days=30)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(not_after)
        .sign(key, hashes.SHA256())
    )
    pfx = pkcs12.serialize_key_and_certificates(
        name=b"koma-fiscal-test",
        key=key,
        cert=certificate,
        cas=None,
        encryption_algorithm=serialization.BestAvailableEncryption(PASSWORD.encode()),
    )
    return base64.b64encode(pfx).decode("ascii")


def test_valid_a1_pfx_is_parsed_before_storage():
    parsed = _parse_pfx(_test_pfx(), PASSWORD)

    assert len(parsed.fingerprint_sha256) == 64
    assert parsed.expires_at > datetime.datetime.now(datetime.timezone.utc)
    assert parsed.password == PASSWORD


def test_wrong_a1_password_fails_closed():
    with pytest.raises(FiscalCredentialError, match="senha informada"):
        _parse_pfx(_test_pfx(), "wrong-password")


def test_expired_a1_certificate_is_rejected():
    with pytest.raises(FiscalCredentialError, match="expirado"):
        _parse_pfx(_test_pfx(expired=True), PASSWORD)


def test_credential_vault_schema_has_no_plaintext_secret_columns():
    columns = set(FiscalCredentialSecret.__table__.columns.keys())
    assert columns == {
        "id",
        "restaurante_id",
        "kind",
        "ciphertext",
        "created_at",
        "updated_at",
    }
    assert "pfx" not in columns
    assert "password" not in columns
    assert "csc" not in columns


def test_credential_vault_migration_enforces_postgres_rls():
    migration = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "c2d9f7a1b604_add_fiscal_credential_vault.py"
    ).read_text(encoding="utf-8")

    assert "ENABLE ROW LEVEL SECURITY" in migration
    assert "FORCE ROW LEVEL SECURITY" in migration
    assert "CREATE POLICY tenant_isolation" in migration
    assert "current_setting('app.current_restaurante_id', true)" in migration


def test_fiscal_credential_and_activation_routes_are_registered():
    paths = {route.path for route in fiscal_onboarding.router.routes}
    assert "/api/onboarding/fiscal/credentials" in paths
    assert "/api/onboarding/fiscal/preflight" in paths
    assert "/api/onboarding/fiscal/enable" in paths
    assert "/api/onboarding/fiscal/disable" in paths
