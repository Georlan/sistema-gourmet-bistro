from __future__ import annotations

import base64
import datetime
import json
from dataclasses import dataclass, field

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.serialization import pkcs12
from sqlalchemy.orm import Session

from ..crypt import decrypt_field, encrypt_field
from ..fiscal_credential_models import FiscalCredentialSecret
from ..fiscal_models import RestaurantFiscalProfile
from .fiscal_onboarding import sync_restaurant_fiscal_profile_status


MAX_PFX_BYTES = 512 * 1024
CERTIFICATE_REF_PREFIX = "dbenc://fiscal-credential/"


class FiscalCredentialError(ValueError):
    pass


@dataclass(frozen=True)
class ParsedA1Certificate:
    pfx_base64: str = field(repr=False)
    password: str = field(repr=False)
    fingerprint_sha256: str
    expires_at: datetime.datetime


@dataclass(frozen=True)
class FiscalCredentialMaterial:
    pfx_bytes: bytes = field(repr=False)
    password: str = field(repr=False)
    csc: str = field(repr=False)
    csc_id: str
    certificate_fingerprint: str
    certificate_expires_at: datetime.datetime


def _utc(value: datetime.datetime) -> datetime.datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=datetime.timezone.utc)
    return value.astimezone(datetime.timezone.utc)


def _credential_scope(profile: RestaurantFiscalProfile) -> dict[str, object]:
    """Bind encrypted material to its legal issuer and transmission context."""
    if type(profile.restaurante_id) is not int or profile.restaurante_id <= 0:
        raise FiscalCredentialError("Contexto do restaurante inválido para credencial fiscal.")
    scope = {
        "restauranteId": profile.restaurante_id,
        "cnpj": str(profile.cnpj or "").strip().upper(),
        "countryCode": str(profile.country_code or "").strip().upper(),
        "uf": str(profile.uf or "").strip().upper(),
        "documentModel": str(profile.document_model or "").strip(),
        "environment": str(profile.environment or "").strip(),
    }
    if any(not value for value in scope.values()) or scope["environment"] not in {"homologacao", "producao"}:
        raise FiscalCredentialError("Contexto fiscal incompleto para armazenar ou usar credenciais.")
    return scope


def invalidate_fiscal_credentials(profile: RestaurantFiscalProfile) -> None:
    """A changed issuer/jurisdiction/environment requires a fresh secure upload."""
    profile.certificate_secret_ref = None
    profile.certificate_fingerprint = None
    profile.certificate_expires_at = None
    profile.csc_id = None
    profile.csc_secret_ref = None
    profile.enabled = False


def _scoped_payload(plaintext: str, expected_scope: dict[str, object]) -> dict[str, object]:
    try:
        payload = json.loads(plaintext)
    except (TypeError, ValueError) as exc:
        raise FiscalCredentialError("Credencial fiscal sem contexto válido. Reenvie A1 e CSC.") from exc
    if not isinstance(payload, dict) or payload.get("scope") != expected_scope:
        raise FiscalCredentialError("Credencial fiscal de outro contexto ou antiga. Reenvie A1 e CSC.")
    return payload


def _parse_pfx(pfx_base64: str, password: str) -> ParsedA1Certificate:
    encoded = str(pfx_base64 or "").strip()
    if not encoded:
        raise FiscalCredentialError("Certificado A1 em base64 é obrigatório.")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise FiscalCredentialError("Certificado A1 não está em base64 válido.") from exc
    if not raw or len(raw) > MAX_PFX_BYTES:
        raise FiscalCredentialError("Certificado A1 ausente ou acima do limite permitido.")

    password_bytes = password.encode("utf-8") if password else None
    try:
        private_key, certificate, _chain = pkcs12.load_key_and_certificates(
            raw,
            password_bytes,
        )
    except Exception as exc:
        raise FiscalCredentialError(
            "Não foi possível abrir o certificado A1 com a senha informada."
        ) from exc

    if private_key is None or certificate is None:
        raise FiscalCredentialError(
            "O arquivo A1 precisa conter certificado e chave privada."
        )

    # Força a serialização da chave privada em memória para detectar objetos
    # incompatíveis antes de persistir o vault. O resultado é descartado.
    private_key.private_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )

    expires_at = getattr(certificate, "not_valid_after_utc", None)
    if expires_at is None:
        expires_at = certificate.not_valid_after
    expires_at = _utc(expires_at)
    now = datetime.datetime.now(datetime.timezone.utc)
    if expires_at <= now:
        raise FiscalCredentialError("Certificado A1 está expirado.")

    return ParsedA1Certificate(
        pfx_base64=encoded,
        password=password,
        fingerprint_sha256=certificate.fingerprint(hashes.SHA256()).hex(),
        expires_at=expires_at,
    )


def _upsert_secret(
    db: Session,
    *,
    restaurante_id: int,
    kind: str,
    plaintext: str,
) -> FiscalCredentialSecret:
    try:
        ciphertext = encrypt_field(plaintext)
    except Exception:
        raise FiscalCredentialError("Não foi possível cifrar a credencial fiscal.") from None
    if (
        not isinstance(ciphertext, str)
        or ciphertext == plaintext
        or not ciphertext.startswith("gAAAAA")
    ):
        raise FiscalCredentialError("A cifragem da credencial fiscal não foi confirmada.")
    secret = (
        db.query(FiscalCredentialSecret)
        .filter(
            FiscalCredentialSecret.restaurante_id == restaurante_id,
            FiscalCredentialSecret.kind == kind,
        )
        .with_for_update()
        .one_or_none()
    )
    if secret is None:
        secret = FiscalCredentialSecret(
            restaurante_id=restaurante_id,
            kind=kind,
            ciphertext=ciphertext,
        )
        db.add(secret)
        db.flush()
        return secret

    secret.ciphertext = ciphertext
    secret.updated_at = datetime.datetime.now(datetime.timezone.utc)
    db.flush()
    return secret


def store_fiscal_credentials(
    db: Session,
    *,
    profile: RestaurantFiscalProfile,
    certificate_pfx_base64: str,
    certificate_password: str,
    csc_id: str,
    csc: str,
) -> None:
    scope = _credential_scope(profile)
    tenant_id = profile.restaurante_id
    normalized_csc_id = str(csc_id or "").strip()
    normalized_csc = str(csc or "").strip()
    if not normalized_csc_id or len(normalized_csc_id) > 16:
        raise FiscalCredentialError("ID do CSC é obrigatório e deve ter até 16 caracteres.")
    if not normalized_csc or len(normalized_csc) > 512:
        raise FiscalCredentialError("CSC é obrigatório e excedeu o limite permitido.")

    parsed = _parse_pfx(certificate_pfx_base64, certificate_password)
    a1_payload = json.dumps(
        {
            "scope": scope,
            "pfxBase64": parsed.pfx_base64,
            "password": parsed.password,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    a1_secret = _upsert_secret(
        db,
        restaurante_id=tenant_id,
        kind="certificate_a1",
        plaintext=a1_payload,
    )
    csc_secret = _upsert_secret(
        db,
        restaurante_id=tenant_id,
        kind="csc",
        plaintext=json.dumps(
            {"scope": {**scope, "cscId": normalized_csc_id}, "csc": normalized_csc},
            ensure_ascii=False, separators=(",", ":"),
        ),
    )

    profile.certificate_secret_ref = f"{CERTIFICATE_REF_PREFIX}{a1_secret.id}"
    profile.certificate_fingerprint = parsed.fingerprint_sha256
    profile.certificate_expires_at = parsed.expires_at
    profile.csc_id = normalized_csc_id
    profile.csc_secret_ref = f"{CERTIFICATE_REF_PREFIX}{csc_secret.id}"

    # Rotação de material fiscal exige nova ativação explícita depois do preflight.
    profile.enabled = False
    sync_restaurant_fiscal_profile_status(profile)
    db.flush()


def _secret_id_from_ref(reference: str | None) -> str:
    value = str(reference or "").strip()
    if not value.startswith(CERTIFICATE_REF_PREFIX):
        raise FiscalCredentialError("Referência de credencial fiscal inválida.")
    secret_id = value[len(CERTIFICATE_REF_PREFIX) :].strip()
    if not secret_id:
        raise FiscalCredentialError("Referência de credencial fiscal vazia.")
    return secret_id


def _load_secret(
    db: Session,
    *,
    restaurante_id: int,
    reference: str | None,
    kind: str,
) -> str:
    secret_id = _secret_id_from_ref(reference)
    secret = (
        db.query(FiscalCredentialSecret)
        .filter(
            FiscalCredentialSecret.id == secret_id,
            FiscalCredentialSecret.restaurante_id == restaurante_id,
            FiscalCredentialSecret.kind == kind,
        )
        .one_or_none()
    )
    if secret is None:
        raise FiscalCredentialError("Credencial fiscal não encontrada neste restaurante.")
    plaintext = decrypt_field(secret.ciphertext)
    if not isinstance(plaintext, str) or plaintext == secret.ciphertext:
        raise FiscalCredentialError("Falha ao decifrar credencial fiscal.")
    return plaintext


def load_fiscal_credentials(
    db: Session,
    *,
    profile: RestaurantFiscalProfile,
) -> FiscalCredentialMaterial:
    scope = _credential_scope(profile)
    tenant_id = profile.restaurante_id
    a1_plaintext = _load_secret(
        db,
        restaurante_id=tenant_id,
        reference=profile.certificate_secret_ref,
        kind="certificate_a1",
    )
    csc_plaintext = _load_secret(
        db,
        restaurante_id=tenant_id,
        reference=profile.csc_secret_ref,
        kind="csc",
    )
    try:
        a1_payload = _scoped_payload(a1_plaintext, scope)
        pfx_base64 = str(a1_payload["pfxBase64"])
        password = str(a1_payload.get("password") or "")
        pfx_bytes = base64.b64decode(pfx_base64, validate=True)
    except FiscalCredentialError:
        raise
    except Exception as exc:
        raise FiscalCredentialError("Payload cifrado do certificado A1 está inválido.") from exc

    if not profile.certificate_fingerprint or profile.certificate_expires_at is None:
        raise FiscalCredentialError("Metadados do certificado A1 estão incompletos.")
    if not profile.csc_id:
        raise FiscalCredentialError("ID do CSC não está configurado.")
    csc_payload = _scoped_payload(csc_plaintext, {**scope, "cscId": str(profile.csc_id)})
    csc = csc_payload.get("csc")
    if not isinstance(csc, str) or not csc.strip():
        raise FiscalCredentialError("Payload cifrado do CSC está inválido. Reenvie A1 e CSC.")

    return FiscalCredentialMaterial(
        pfx_bytes=pfx_bytes,
        password=password,
        csc=csc,
        csc_id=str(profile.csc_id),
        certificate_fingerprint=str(profile.certificate_fingerprint),
        certificate_expires_at=_utc(profile.certificate_expires_at),
    )
