from __future__ import annotations

import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db, require_tenant_id
from ..fiscal.ibge import (
    OfficialLocationMismatch,
    OfficialLocationSourceUnavailable,
    get_ibge_municipality,
    list_ibge_municipalities_for_uf,
)
from ..fiscal.identifiers import (
    FiscalIdentifierError,
    normalize_cep,
    normalize_cnpj,
    normalize_digits,
)
from ..fiscal.jurisdiction import FiscalJurisdictionError, resolve_fiscal_jurisdiction
from ..fiscal_models import RestaurantFiscalProfile
from ..models import Usuario
from ..security import get_current_user
from ..services.fiscal_onboarding import (
    evaluate_restaurant_fiscal_readiness,
    readiness_payload,
    sync_restaurant_fiscal_profile_status,
)
from ..services.fiscal_preflight import evaluate_fiscal_preflight, preflight_payload


router = APIRouter(prefix="/api/onboarding/fiscal", tags=["Fiscal Onboarding"])


class FiscalProfileUpdate(BaseModel):
    cnpj: str
    inscricao_estadual: str
    razao_social: str
    nome_fantasia: str | None = None
    crt: str
    cnae_principal: str
    cep: str
    logradouro: str
    numero: str
    complemento: str | None = None
    bairro: str
    municipio_codigo_ibge: str
    uf: str | None = None
    series: int = Field(default=1, ge=1)
    environment: str = "homologacao"


def _require_fiscal_admin(current_user: Usuario) -> None:
    role = str(current_user.cargo or current_user.role or "").strip().lower()
    if role not in {"admin", "gerente"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Somente administradores e gerentes podem configurar dados fiscais.",
        )


def _safe_profile_payload(profile: RestaurantFiscalProfile) -> dict[str, object]:
    readiness = evaluate_restaurant_fiscal_readiness(profile)
    return {
        "id": profile.id,
        "countryCode": profile.country_code,
        "uf": profile.uf,
        "documentModel": profile.document_model,
        "environment": profile.environment,
        "series": profile.series,
        "provider": profile.provider,
        "status": profile.status,
        "enabled": bool(profile.enabled),
        "complianceBaseline": profile.compliance_baseline,
        "cnpj": profile.cnpj,
        "inscricaoEstadual": profile.inscricao_estadual,
        "razaoSocial": profile.razao_social,
        "nomeFantasia": profile.nome_fantasia,
        "crt": profile.crt,
        "cnaePrincipal": profile.cnae_principal,
        "municipioCodigoIbge": profile.municipio_codigo_ibge,
        "enderecoFiscal": profile.endereco_fiscal,
        "certificateConfigured": bool(profile.certificate_secret_ref),
        "certificateFingerprint": profile.certificate_fingerprint,
        "certificateExpiresAt": (
            profile.certificate_expires_at.isoformat()
            if profile.certificate_expires_at is not None
            else None
        ),
        "cscConfigured": bool(profile.csc_id and profile.csc_secret_ref),
        "readiness": readiness_payload(readiness),
    }


@router.get("/municipalities")
def fiscal_municipalities(
    uf: str = Query(default="CE", min_length=2, max_length=2),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    del db
    _require_fiscal_admin(current_user)
    normalized_uf = str(uf or "").strip().upper()
    if normalized_uf != "CE":
        raise HTTPException(
            status_code=422,
            detail="Nesta fase o KÔMA Fiscal está habilitado somente para o Ceará.",
        )
    try:
        municipalities = list_ibge_municipalities_for_uf("23")
    except (OfficialLocationSourceUnavailable, OfficialLocationMismatch) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "uf": "CE",
        "source": "ibge-localidades",
        "items": [
            {"code": municipality.code, "name": municipality.name, "uf": municipality.uf}
            for municipality in municipalities
        ],
    }


@router.get("/profile")
def get_fiscal_profile(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    _require_fiscal_admin(current_user)
    tenant_id = require_tenant_id()
    profile = (
        db.query(RestaurantFiscalProfile)
        .filter(RestaurantFiscalProfile.restaurante_id == tenant_id)
        .one_or_none()
    )
    if profile is None:
        return {
            "status": "not_configured",
            "enabled": False,
            "readiness": {
                "ready": False,
                "status": "draft",
                "jurisdictionKey": None,
                "issues": [
                    {
                        "code": "missing_profile",
                        "message": "Perfil fiscal ainda não configurado.",
                        "severity": "blocking",
                    }
                ],
            },
        }
    return _safe_profile_payload(profile)


@router.put("/profile")
def update_fiscal_profile(
    payload: FiscalProfileUpdate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    _require_fiscal_admin(current_user)
    tenant_id = require_tenant_id()

    try:
        cnpj = normalize_cnpj(payload.cnpj)
        cnae = normalize_digits(payload.cnae_principal, field="CNAE principal", length=7)
        cep = normalize_cep(payload.cep)
        resolution = resolve_fiscal_jurisdiction(
            payload.municipio_codigo_ibge,
            declared_uf=payload.uf,
        )
    except (FiscalIdentifierError, FiscalJurisdictionError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if not resolution.supported or resolution.jurisdiction_key != "BR-CE":
        raise HTTPException(
            status_code=422,
            detail="Nesta fase o KÔMA Fiscal está habilitado somente para estabelecimentos do Ceará.",
        )
    if payload.environment not in {"homologacao", "producao"}:
        raise HTTPException(status_code=422, detail="Ambiente fiscal inválido.")
    if str(payload.crt).strip() not in {"1", "2", "3", "4"}:
        raise HTTPException(status_code=422, detail="CRT inválido para NF-e/NFC-e.")

    try:
        official_municipality = get_ibge_municipality(resolution.municipality_code)
    except OfficialLocationSourceUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except OfficialLocationMismatch as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if official_municipality.code != resolution.municipality_code:
        raise HTTPException(status_code=422, detail="Código de município não confirmado pelo IBGE.")
    if official_municipality.uf != resolution.uf:
        raise HTTPException(
            status_code=422,
            detail="UF do município diverge da fonte oficial do IBGE.",
        )

    now = datetime.datetime.now(datetime.timezone.utc)
    profile = (
        db.query(RestaurantFiscalProfile)
        .filter(RestaurantFiscalProfile.restaurante_id == tenant_id)
        .with_for_update()
        .one_or_none()
    )
    if profile is None:
        profile = RestaurantFiscalProfile(restaurante_id=tenant_id)
        db.add(profile)

    profile.country_code = "BR"
    profile.uf = resolution.uf
    profile.document_model = "65"
    profile.environment = payload.environment
    profile.series = payload.series
    profile.provider = "direct_sefaz"
    profile.compliance_baseline = "ce-nfce-2026-09-15"
    profile.cnpj = cnpj
    profile.inscricao_estadual = str(payload.inscricao_estadual or "").strip()
    profile.razao_social = str(payload.razao_social or "").strip()
    profile.nome_fantasia = str(payload.nome_fantasia or "").strip() or None
    profile.crt = str(payload.crt).strip()
    profile.cnae_principal = cnae
    profile.municipio_codigo_ibge = official_municipality.code
    profile.endereco_fiscal = {
        "cep": cep,
        "logradouro": str(payload.logradouro or "").strip(),
        "numero": str(payload.numero or "").strip(),
        "complemento": str(payload.complemento or "").strip() or None,
        "bairro": str(payload.bairro or "").strip(),
        "municipio_nome": official_municipality.name,
        "municipio_codigo_ibge": official_municipality.code,
        "uf": official_municipality.uf,
        "municipio_source": official_municipality.source,
        "municipio_verified_at": now.isoformat(),
    }

    readiness = sync_restaurant_fiscal_profile_status(profile, now=now)
    db.commit()
    db.refresh(profile)
    response = _safe_profile_payload(profile)
    response["readiness"] = readiness_payload(readiness)
    return response


@router.get("/readiness")
def get_fiscal_readiness(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    _require_fiscal_admin(current_user)
    tenant_id = require_tenant_id()
    profile = (
        db.query(RestaurantFiscalProfile)
        .filter(RestaurantFiscalProfile.restaurante_id == tenant_id)
        .one_or_none()
    )
    if profile is None:
        return {
            "ready": False,
            "status": "draft",
            "jurisdictionKey": None,
            "issues": [
                {
                    "code": "missing_profile",
                    "message": "Perfil fiscal ainda não configurado.",
                    "severity": "blocking",
                }
            ],
        }
    return readiness_payload(evaluate_restaurant_fiscal_readiness(profile))


@router.get("/preflight")
def get_fiscal_preflight(
    mode: str = Query(default="foundation"),
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Diagnóstico executável do gate fiscal antes de qualquer emissão/numeração."""

    _require_fiscal_admin(current_user)
    normalized_mode = str(mode or "").strip().lower()
    if normalized_mode not in {"foundation", "issuance"}:
        raise HTTPException(
            status_code=422,
            detail="mode deve ser 'foundation' ou 'issuance'.",
        )

    tenant_id = require_tenant_id()
    profile = (
        db.query(RestaurantFiscalProfile)
        .filter(RestaurantFiscalProfile.restaurante_id == tenant_id)
        .one_or_none()
    )
    if profile is None:
        return {
            "ready": False,
            "mode": normalized_mode,
            "jurisdictionKey": None,
            "profileReady": False,
            "referencesReady": False,
            "issues": [
                {
                    "code": "missing_profile",
                    "message": "Perfil fiscal ainda não configurado.",
                    "severity": "blocking",
                    "sourceKey": None,
                }
            ],
            "warnings": [],
            "references": [],
            "complianceBaseline": [],
        }

    return preflight_payload(
        evaluate_fiscal_preflight(db, profile, mode=normalized_mode)
    )
