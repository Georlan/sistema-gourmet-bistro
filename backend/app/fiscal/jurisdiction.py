from __future__ import annotations

from dataclasses import dataclass

from .identifiers import (
    FiscalIdentifierError,
    normalize_ibge_municipality_code,
    normalize_uf,
    uf_from_ibge_municipality_code,
)


class FiscalJurisdictionError(ValueError):
    pass


@dataclass(frozen=True)
class FiscalJurisdictionPolicy:
    key: str
    country_code: str
    uf: str
    document_model: str
    compliance_keys: tuple[str, ...]
    payment_linkage_required: bool
    active: bool


@dataclass(frozen=True)
class FiscalJurisdictionResolution:
    country_code: str
    uf: str
    municipality_code: str
    jurisdiction_key: str
    document_model: str
    supported: bool
    source: str


# Ceará é a primeira jurisdição operacional. Novas UFs entram no registry sem
# alterar o domínio fiscal compartilhado.
FISCAL_JURISDICTIONS: dict[str, FiscalJurisdictionPolicy] = {
    "BR-CE": FiscalJurisdictionPolicy(
        key="BR-CE",
        country_code="BR",
        uf="CE",
        document_model="65",
        compliance_keys=("moc-nfe-nfce", "ce-in-87-2025", "ce-credenciamento-nfce"),
        payment_linkage_required=True,
        active=True,
    ),
}


def resolve_fiscal_jurisdiction(
    municipality_code: object,
    *,
    declared_uf: object | None = None,
) -> FiscalJurisdictionResolution:
    try:
        code = normalize_ibge_municipality_code(municipality_code)
        derived_uf = uf_from_ibge_municipality_code(code)
        if declared_uf not in (None, ""):
            normalized_uf = normalize_uf(declared_uf)
            if normalized_uf != derived_uf:
                raise FiscalJurisdictionError(
                    "UF informada diverge do código IBGE do município."
                )
    except FiscalIdentifierError as exc:
        raise FiscalJurisdictionError(str(exc)) from exc

    key = f"BR-{derived_uf}"
    policy = FISCAL_JURISDICTIONS.get(key)
    return FiscalJurisdictionResolution(
        country_code="BR",
        uf=derived_uf,
        municipality_code=code,
        jurisdiction_key=key,
        document_model=policy.document_model if policy else "65",
        supported=bool(policy and policy.active),
        source="ibge-municipality-code",
    )


def fiscal_policy_for(jurisdiction_key: str) -> FiscalJurisdictionPolicy:
    policy = FISCAL_JURISDICTIONS.get(str(jurisdiction_key or "").strip().upper())
    if policy is None or not policy.active:
        raise FiscalJurisdictionError(
            f"Jurisdição fiscal ainda não suportada: {jurisdiction_key}"
        )
    return policy
