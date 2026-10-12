"""Local synthetic A1/CSC tests; no real certificates, keys, or tenants."""
from __future__ import annotations

import base64
import datetime
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from cryptography import x509
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID
from sqlalchemy import Column, Integer, MetaData, Table, create_engine, event, insert

from app.database import TenantSession, current_restaurante_id
from app.fiscal.ibge import IbgeMunicipality
from app.fiscal_credential_models import FiscalCredentialSecret
from app.fiscal_models import RestaurantFiscalProfile
from app.routes import fiscal_onboarding
from app.services import fiscal_credentials as credentials


TENANT = 880091
OTHER_TENANT = 880092
PASSWORD = "synthetic-test-password"
CSC = "synthetic-csc-for-local-tests"


@pytest.fixture(scope="module")
def synthetic_pfx():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "LOCAL TEST ONLY")])
    now = datetime.datetime.now(datetime.timezone.utc)
    certificate = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
        .public_key(key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=30)).sign(key, hashes.SHA256()))
    return base64.b64encode(pkcs12.serialize_key_and_certificates(
        b"local-only", key, certificate, None,
        serialization.BestAvailableEncryption(PASSWORD.encode()),
    )).decode()


@pytest.fixture
def credential_db(monkeypatch, synthetic_pfx):
    # A separate ephemeral cipher prevents tests from using deployment key material.
    cipher = Fernet(Fernet.generate_key())
    monkeypatch.setattr(credentials, "encrypt_field", lambda value: cipher.encrypt(value.encode()).decode())
    monkeypatch.setattr(credentials, "decrypt_field", lambda value: cipher.decrypt(value.encode()).decode())
    test_engine = create_engine("sqlite:///:memory:")
    @event.listens_for(test_engine, "connect")
    def foreign_keys(dbapi_connection, _record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")
    metadata = MetaData()
    Table("restaurantes", metadata, Column("id", Integer, primary_key=True))
    RestaurantFiscalProfile.__table__.to_metadata(metadata)
    FiscalCredentialSecret.__table__.to_metadata(metadata)
    metadata.create_all(test_engine)
    with test_engine.begin() as connection:
        connection.execute(insert(metadata.tables["restaurantes"]), [{"id": TENANT}, {"id": OTHER_TENANT}])
    token = current_restaurante_id.set(TENANT)
    with TenantSession(bind=test_engine, restaurante_id=TENANT, autoflush=False) as db:
        profile = RestaurantFiscalProfile(
            restaurante_id=TENANT, cnpj="11222333000181", country_code="BR", uf="CE",
            document_model="65", environment="homologacao", series=1,
        )
        db.add(profile)
        credentials.store_fiscal_credentials(
            db, profile=profile, certificate_pfx_base64=synthetic_pfx,
            certificate_password=PASSWORD, csc_id="000001", csc=CSC,
        )
        db.commit()
        try:
            yield db, profile, cipher, test_engine
        finally:
            db.rollback()
            current_restaurante_id.reset(token)
    test_engine.dispose()


def test_credential_material_roundtrip_and_ciphertext_custody(credential_db, synthetic_pfx):
    db, profile, cipher, _engine = credential_db
    material = credentials.load_fiscal_credentials(db, profile=profile)
    assert material.pfx_bytes == base64.b64decode(synthetic_pfx)
    assert material.password == PASSWORD and material.csc == CSC and material.csc_id == "000001"
    stored = db.query(FiscalCredentialSecret).filter_by(restaurante_id=TENANT).all()
    assert len(stored) == 2
    for secret in stored:
        assert PASSWORD not in secret.ciphertext and CSC not in secret.ciphertext
        payload = json.loads(cipher.decrypt(secret.ciphertext.encode()))
        assert payload["scope"]["restauranteId"] == TENANT
        assert payload["scope"]["environment"] == "homologacao"


@pytest.mark.parametrize("field,value", [
    ("restaurante_id", OTHER_TENANT), ("cnpj", "00000000E08G12"),
    ("country_code", "PT"), ("uf", "SP"), ("document_model", "55"),
    ("environment", "producao"), ("csc_id", "000002"),
])
def test_credentials_cannot_follow_a_different_context(credential_db, field, value):
    db, profile, _cipher, _engine = credential_db
    setattr(profile, field, value)
    with pytest.raises(credentials.FiscalCredentialError):
        credentials.load_fiscal_credentials(db, profile=profile)


@pytest.mark.parametrize("kind", ["certificate_a1", "csc"])
def test_unscoped_legacy_material_requires_secure_reupload(credential_db, synthetic_pfx, kind):
    db, profile, cipher, _engine = credential_db
    secret = db.query(FiscalCredentialSecret).filter_by(restaurante_id=TENANT, kind=kind).one()
    legacy = json.dumps({"pfxBase64": synthetic_pfx, "password": PASSWORD}) if kind == "certificate_a1" else CSC
    secret.ciphertext = cipher.encrypt(legacy.encode()).decode()
    db.commit()
    with pytest.raises(credentials.FiscalCredentialError, match="Reenvie A1 e CSC"):
        credentials.load_fiscal_credentials(db, profile=profile)


def test_another_tenant_secret_reference_is_rejected(credential_db):
    db, profile, cipher, test_engine = credential_db
    with test_engine.begin() as connection:
        connection.execute(insert(FiscalCredentialSecret.__table__), {
            "id": "foreign-a1", "restaurante_id": OTHER_TENANT,
            "kind": "certificate_a1", "ciphertext": cipher.encrypt(b"foreign-test-only").decode(),
        })
    profile.certificate_secret_ref = credentials.CERTIFICATE_REF_PREFIX + "foreign-a1"
    with pytest.raises(credentials.FiscalCredentialError, match="neste restaurante"):
        credentials.load_fiscal_credentials(db, profile=profile)


def test_secret_dataclass_reprs_exclude_sensitive_material(credential_db, synthetic_pfx):
    db, profile, _cipher, _engine = credential_db
    parsed = credentials._parse_pfx(synthetic_pfx, PASSWORD)
    material = credentials.load_fiscal_credentials(db, profile=profile)
    for value in (repr(parsed), repr(material)):
        assert PASSWORD not in value and CSC not in value and synthetic_pfx not in value
        assert repr(material.pfx_bytes) not in value


@pytest.mark.parametrize("bad_ciphertext", [None, CSC, "not-encrypted"])
def test_secret_storage_refuses_unconfirmed_encryption(monkeypatch, bad_ciphertext):
    db = Mock()
    monkeypatch.setattr(credentials, "encrypt_field", lambda _value: bad_ciphertext)
    with pytest.raises(credentials.FiscalCredentialError) as rejected:
        credentials._upsert_secret(db, restaurante_id=TENANT, kind="csc", plaintext=CSC)
    assert CSC not in str(rejected.value)
    assert db.mock_calls == []


def test_secret_storage_sanitizes_encryption_failure(monkeypatch):
    db = Mock()
    def failed_encryption(_value):
        raise RuntimeError(PASSWORD)
    monkeypatch.setattr(credentials, "encrypt_field", failed_encryption)
    with pytest.raises(credentials.FiscalCredentialError) as rejected:
        credentials._upsert_secret(db, restaurante_id=TENANT, kind="csc", plaintext=CSC)
    assert PASSWORD not in str(rejected.value) and CSC not in str(rejected.value)
    assert rejected.value.__suppress_context__ is True
    assert db.mock_calls == []


def _profile_update(**overrides):
    return fiscal_onboarding.FiscalProfileUpdate(**{
        "cnpj": "11222333000181", "inscricao_estadual": "060000015",
        "razao_social": "Local Synthetic Restaurant", "crt": "1", "cnae_principal": "5611201",
        "cep": "60000000", "logradouro": "Rua Sintética", "numero": "1", "bairro": "Centro",
        "municipio_codigo_ibge": "2304400", "uf": "CE", "series": 1,
        "environment": "homologacao", **overrides,
    })


def _save_profile(monkeypatch, db, profile, **overrides):
    monkeypatch.setattr(fiscal_onboarding, "require_tenant_id", lambda: TENANT)
    monkeypatch.setattr(fiscal_onboarding, "_profile_for_tenant", lambda *_args, **_kwargs: profile)
    monkeypatch.setattr(fiscal_onboarding, "get_ibge_municipality", lambda _code: IbgeMunicipality(
        code="2304400", name="Fortaleza", uf="CE",
    ))
    return fiscal_onboarding.update_fiscal_profile(
        _profile_update(**overrides), db=db, current_user=SimpleNamespace(cargo="admin", role="admin"),
    )


@pytest.mark.parametrize("overrides,old_field,old_value", [
    ({"cnpj": "00000000E08G12"}, None, None),
    ({"environment": "producao"}, None, None),
    ({}, "country_code", "PT"), ({}, "uf", "SP"), ({}, "document_model", "55"),
])
def test_profile_identity_change_invalidates_credential_references(credential_db, monkeypatch, overrides, old_field, old_value):
    db, profile, _cipher, _engine = credential_db
    if old_field:
        setattr(profile, old_field, old_value)
    profile.enabled = True
    result = _save_profile(monkeypatch, db, profile, **overrides)
    assert result["certificateConfigured"] is False and result["cscConfigured"] is False
    assert profile.certificate_secret_ref is None and profile.certificate_fingerprint is None
    assert profile.certificate_expires_at is None and profile.csc_id is None and profile.csc_secret_ref is None
    assert profile.enabled is False
    assert db.query(FiscalCredentialSecret).filter_by(restaurante_id=TENANT).count() == 2


def test_normal_company_address_and_series_edits_preserve_material(credential_db, monkeypatch):
    db, profile, _cipher, _engine = credential_db
    refs = (profile.certificate_secret_ref, profile.csc_secret_ref)
    _save_profile(monkeypatch, db, profile, series=2, razao_social="Edited Name", numero="42")
    assert (profile.certificate_secret_ref, profile.csc_secret_ref) == refs
    assert credentials.load_fiscal_credentials(db, profile=profile).csc == CSC
    assert profile.enabled is False
