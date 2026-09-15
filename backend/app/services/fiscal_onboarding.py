from __future__ import annotations

import datetime
from dataclasses import dataclass
from typing import Iterable

from ..fiscal.identifiers import (
    FiscalIdentifierError,
    normalize_cnpj,
    normalize_digits,
)
from ..fiscal.jurisdiction import FiscalJurisdictionError, resolve_fiscal_jurisdiction
from ..fiscal_models import RestaurantFiscalProfile


@dataclass(frozen=True)
class FiscalReadinessIssue:
    code: str
    message: str
    severity: str = "blocking"


@dataclass(frozen=True)
class FiscalReadinessResult:
    ready: bool
    status: str
    jurisdiction_key: str | None
    issues: tuple[FiscalReadinessIssue, ...]


def _utc(value: datetime.datetime | None) -> datetime.datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=datetime.timezone.utc)
    return value.astimezone(datetime.timezone.utc)


def _text(value: object) -> str:
    return str(value or "").strip()


def _missing(issues: list[FiscalReadinessIssue], code: str, field_name: str) -> None:
    issues.append(
        FiscalReadinessIssue(code=code, message=f"{field_name} não informado.")
    )


def evaluate_restaurant_fiscal_readiness(
    profile: RestaurantFiscalProfile,
    *,
    now: datetime.datetime | None = None,
) -> FiscalReadinessResult:
    issues: list[FiscalReadinessIssue] = []
    jurisdiction_key: str | None = None

    if not _text(profile.cnpj):
        _missing(issues, "missing_cnpj", "CNPJ")
    else:
        try:
            normalize_cnpj(profile.cnpj)
        except FiscalIdentifierError as exc:
            issues.append(FiscalReadinessIssue("invalid_cnpj", str(exc)))

    if not _text(profile.inscricao_estadual):
        _missing(issues, "missing_state_registration", "Inscrição Estadual/CGF")
    if not _text(profile.razao_social):
        _missing(issues, "missing_legal_name", "Razão social")
    if not _text(profile.cnae_principal):
        _missing(issues, "missing_cnae", "CNAE principal")
    else:
        try:
            normalize_digits(profile.cnae_principal, field="CNAE principal", length=7)
        except FiscalIdentifierError as exc:
            issues.append(FiscalReadinessIssue("invalid_cnae", str(exc)))

    crt = _text(profile.crt)
    if not crt:
        _missing(issues, "missing_crt", "CRT/regime tributário")
    elif crt not in {"1", "2", "3", "4"}:
        issues.append(
            FiscalReadinessIssue(
                "invalid_crt",
                "CRT fora dos códigos previstos no leiaute nacional da NF-e/NFC-e.",
            )
        )

    municipality_code = _text(profile.municipio_codigo_ibge)
    if not municipality_code:
        _missing(issues, "missing_municipality_code", "Código IBGE do município")
    else:
        try:
            resolution = resolve_fiscal_jurisdiction(
                municipality_code,
                declared_uf=profile.uf,
            )
            jurisdiction_key = resolution.jurisdiction_key
            if not resolution.supported:
                issues.append(
                    FiscalReadinessIssue(
                        "unsupported_jurisdiction",
                        f"A jurisdição {resolution.jurisdiction_key} ainda não está habilitada no KÔMA Fiscal.",
                    )
                )
            if resolution.document_model != str(profile.document_model or ""):
                issues.append(
                    FiscalReadinessIssue(
                        "invalid_document_model",
                        "Modelo fiscal configurado diverge da política da jurisdição.",
                    )
                )
        except FiscalJurisdictionError as exc:
            issues.append(FiscalReadinessIssue("invalid_jurisdiction", str(exc)))

    address = profile.endereco_fiscal if isinstance(profile.endereco_fiscal, dict) else {}
    for key, label in (
        ("cep", "CEP"),
        ("logradouro", "Logradouro"),
        ("numero", "Número"),
        ("bairro", "Bairro"),
        ("municipio_nome", "Município"),
    ):
        if not _text(address.get(key)):
            _missing(issues, f"missing_address_{key}", label)

    verified_code = _text(address.get("municipio_codigo_ibge"))
    if municipality_code and verified_code != municipality_code:
        issues.append(
            FiscalReadinessIssue(
                "municipality_not_officially_verified",
                "Município ainda não foi confirmado pela fonte oficial do IBGE.",
            )
        )
    if _text(address.get("municipio_source")) != "ibge-localidades":
        issues.append(
            FiscalReadinessIssue(
                "municipality_source_unverified",
                "Município precisa ser validado pela API oficial de Localidades do IBGE.",
            )
        )

    if str(profile.environment or "") not in {"homologacao", "producao"}:
        issues.append(FiscalReadinessIssue("invalid_environment", "Ambiente fiscal inválido."))
    if int(profile.series or 0) <= 0:
        issues.append(FiscalReadinessIssue("invalid_series", "Série fiscal deve ser positiva."))

    if not _text(profile.certificate_secret_ref):
        _missing(issues, "missing_certificate", "Certificado digital A1")
    if not _text(profile.certificate_fingerprint):
        _missing(issues, "missing_certificate_fingerprint", "Fingerprint do certificado")
    expires_at = _utc(profile.certificate_expires_at)
    current = _utc(now) or datetime.datetime.now(datetime.timezone.utc)
    if expires_at is None:
        _missing(issues, "missing_certificate_expiry", "Validade do certificado")
    elif expires_at <= current:
        issues.append(
            FiscalReadinessIssue("expired_certificate", "Certificado digital expirado.")
        )

    if not _text(profile.csc_id):
        _missing(issues, "missing_csc_id", "ID do CSC")
    if not _text(profile.csc_secret_ref):
        _missing(issues, "missing_csc_secret", "CSC")

    ready = not issues
    invalid_codes = {
        "invalid_cnpj",
        "invalid_cnae",
        "invalid_crt",
        "invalid_jurisdiction",
        "unsupported_jurisdiction",
        "invalid_document_model",
        "expired_certificate",
    }
    status = "ready" if ready else (
        "blocked" if any(issue.code in invalid_codes for issue in issues) else "draft"
    )
    return FiscalReadinessResult(
        ready=ready,
        status=status,
        jurisdiction_key=jurisdiction_key,
        issues=tuple(issues),
    )


def sync_restaurant_fiscal_profile_status(
    profile: RestaurantFiscalProfile,
    *,
    now: datetime.datetime | None = None,
) -> FiscalReadinessResult:
    result = evaluate_restaurant_fiscal_readiness(profile, now=now)
    profile.status = result.status
    if not result.ready:
        # Nunca deixar emissão habilitada depois de uma alteração cadastral que
        # invalida o preflight do estabelecimento.
        profile.enabled = False
    return result


def readiness_payload(result: FiscalReadinessResult) -> dict[str, object]:
    return {
        "ready": result.ready,
        "status": result.status,
        "jurisdictionKey": result.jurisdiction_key,
        "issues": [
            {
                "code": issue.code,
                "message": issue.message,
                "severity": issue.severity,
            }
            for issue in result.issues
        ],
    }
