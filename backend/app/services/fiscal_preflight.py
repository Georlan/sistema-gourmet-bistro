from __future__ import annotations

import datetime
from dataclasses import dataclass
from typing import Iterable

from sqlalchemy.orm import Session

from ..fiscal.compliance import baseline_by_key
from ..fiscal.jurisdiction import FiscalJurisdictionError, fiscal_policy_for
from ..fiscal_models import RestaurantFiscalProfile
from ..fiscal_reference_models import FiscalOfficialReferenceState
from .fiscal_onboarding import (
    FiscalReadinessIssue,
    evaluate_restaurant_fiscal_readiness,
)


PREFLIGHT_MODES = {"foundation", "issuance"}
DEFAULT_MAX_REFERENCE_AGE = datetime.timedelta(days=2)


@dataclass(frozen=True)
class RuntimeReferencePolicy:
    source_key: str
    blocking_modes: tuple[str, ...]
    title: str
    max_age: datetime.timedelta = DEFAULT_MAX_REFERENCE_AGE

    def blocks(self, mode: str) -> bool:
        return mode in self.blocking_modes


# Apenas fontes realmente observadas em runtime entram aqui. Referências estáticas
# (MOC, NTs, IN/CE etc.) continuam no Compliance Registry e aparecem no payload,
# mas não são falsamente tratadas como "stale" sem um probe próprio.
RUNTIME_REFERENCE_POLICIES: tuple[RuntimeReferencePolicy, ...] = (
    RuntimeReferencePolicy(
        source_key="rfb-ncm-json",
        blocking_modes=("foundation", "issuance"),
        title="Tabela NCM oficial vigente",
    ),
    RuntimeReferencePolicy(
        source_key="nfe-informes-tecnicos",
        blocking_modes=(),
        title="Informes Técnicos do Portal Nacional da NF-e",
    ),
    RuntimeReferencePolicy(
        source_key="nfe-portal-notices",
        blocking_modes=(),
        title="Avisos recentes do Portal Nacional da NF-e",
    ),
    RuntimeReferencePolicy(
        source_key="rfb-rtc-calculator-local",
        blocking_modes=("issuance",),
        title="Calculadora oficial RTC instalada no KÔMA",
    ),
)


@dataclass(frozen=True)
class FiscalPreflightIssue:
    code: str
    message: str
    severity: str
    source_key: str | None = None


@dataclass(frozen=True)
class FiscalReferenceCheck:
    source_key: str
    title: str
    blocking: bool
    status: str
    stale: bool
    checked_at: datetime.datetime | None
    observed_snapshot_id: str | None
    active_snapshot_id: str | None
    observed_version: str | None
    active_version: str | None
    last_error: str | None


@dataclass(frozen=True)
class FiscalPreflightResult:
    ready: bool
    mode: str
    jurisdiction_key: str | None
    profile_ready: bool
    references_ready: bool
    issues: tuple[FiscalPreflightIssue, ...]
    warnings: tuple[FiscalPreflightIssue, ...]
    references: tuple[FiscalReferenceCheck, ...]
    compliance_baseline: tuple[dict[str, str], ...]


def _as_utc(value: datetime.datetime | None) -> datetime.datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=datetime.timezone.utc)
    return value.astimezone(datetime.timezone.utc)


def _is_stale(
    checked_at: datetime.datetime | None,
    *,
    now: datetime.datetime,
    max_age: datetime.timedelta,
) -> bool:
    checked = _as_utc(checked_at)
    if checked is None:
        return True
    return now - checked > max_age


def _profile_issue(issue: FiscalReadinessIssue) -> FiscalPreflightIssue:
    return FiscalPreflightIssue(
        code=issue.code,
        message=issue.message,
        severity=issue.severity,
    )


def _append_reference_issue(
    target: list[FiscalPreflightIssue],
    *,
    code: str,
    message: str,
    source_key: str,
    blocking: bool,
) -> None:
    target.append(
        FiscalPreflightIssue(
            code=code,
            message=message,
            severity="blocking" if blocking else "warning",
            source_key=source_key,
        )
    )


def _baseline_payload(jurisdiction_key: str | None) -> tuple[dict[str, str], ...]:
    if not jurisdiction_key:
        return ()
    try:
        policy = fiscal_policy_for(jurisdiction_key)
    except FiscalJurisdictionError:
        return ()

    rows: list[dict[str, str]] = []
    for key in policy.compliance_keys:
        try:
            source = baseline_by_key(key)
        except KeyError:
            continue
        rows.append(
            {
                "key": source.key,
                "title": source.title,
                "version": source.version,
                "adoptionStatus": source.adoption_status,
                "verifiedOn": source.verified_on.isoformat(),
                "sourceUrl": source.source_url,
            }
        )
    return tuple(rows)


def evaluate_fiscal_preflight(
    db: Session,
    profile: RestaurantFiscalProfile,
    *,
    mode: str = "foundation",
    now: datetime.datetime | None = None,
    reference_policies: Iterable[RuntimeReferencePolicy] = RUNTIME_REFERENCE_POLICIES,
) -> FiscalPreflightResult:
    normalized_mode = str(mode or "").strip().lower()
    if normalized_mode not in PREFLIGHT_MODES:
        raise ValueError("Modo de preflight fiscal inválido.")

    current = _as_utc(now) or datetime.datetime.now(datetime.timezone.utc)
    profile_result = evaluate_restaurant_fiscal_readiness(profile, now=current)
    blocking_issues = [_profile_issue(issue) for issue in profile_result.issues]
    warnings: list[FiscalPreflightIssue] = []
    checks: list[FiscalReferenceCheck] = []

    policies = tuple(reference_policies)
    source_keys = [policy.source_key for policy in policies]
    states = {
        state.source_key: state
        for state in (
            db.query(FiscalOfficialReferenceState)
            .filter(FiscalOfficialReferenceState.source_key.in_(source_keys))
            .all()
        )
    }

    for policy in policies:
        state = states.get(policy.source_key)
        blocking = policy.blocks(normalized_mode)
        target = blocking_issues if blocking else warnings

        if state is None:
            _append_reference_issue(
                target,
                code="official_reference_missing",
                message=f"{policy.title} ainda não foi observada pelo watcher oficial.",
                source_key=policy.source_key,
                blocking=blocking,
            )
            checks.append(
                FiscalReferenceCheck(
                    source_key=policy.source_key,
                    title=policy.title,
                    blocking=blocking,
                    status="missing",
                    stale=True,
                    checked_at=None,
                    observed_snapshot_id=None,
                    active_snapshot_id=None,
                    observed_version=None,
                    active_version=None,
                    last_error=None,
                )
            )
            continue

        stale = _is_stale(state.checked_at, now=current, max_age=policy.max_age)
        if stale:
            _append_reference_issue(
                target,
                code="official_reference_stale",
                message=f"{policy.title} está sem verificação recente.",
                source_key=policy.source_key,
                blocking=blocking,
            )

        if state.status == "error":
            _append_reference_issue(
                target,
                code="official_reference_error",
                message=f"Falha na última verificação de {policy.title}.",
                source_key=policy.source_key,
                blocking=blocking,
            )
        elif state.status == "changed":
            _append_reference_issue(
                target,
                code="official_reference_changed",
                message=(
                    f"{policy.title} publicou uma versão diferente da baseline ativa; "
                    "a nova publicação precisa ser revisada antes de promoção."
                ),
                source_key=policy.source_key,
                blocking=blocking,
            )
        elif state.status != "current":
            _append_reference_issue(
                target,
                code="official_reference_invalid_status",
                message=f"{policy.title} está em estado de compliance desconhecido.",
                source_key=policy.source_key,
                blocking=blocking,
            )

        if not state.active_snapshot_id:
            _append_reference_issue(
                target,
                code="official_reference_without_active_snapshot",
                message=f"{policy.title} não possui snapshot ativo versionado.",
                source_key=policy.source_key,
                blocking=blocking,
            )

        checks.append(
            FiscalReferenceCheck(
                source_key=policy.source_key,
                title=policy.title,
                blocking=blocking,
                status=state.status,
                stale=stale,
                checked_at=_as_utc(state.checked_at),
                observed_snapshot_id=state.observed_snapshot_id,
                active_snapshot_id=state.active_snapshot_id,
                observed_version=state.observed_version,
                active_version=state.active_version,
                last_error=state.last_error,
            )
        )

    references_ready = not any(issue.source_key for issue in blocking_issues)
    ready = profile_result.ready and references_ready

    if normalized_mode == "issuance" and not bool(profile.enabled):
        blocking_issues.append(
            FiscalPreflightIssue(
                code="fiscal_issuance_disabled",
                message="Emissão fiscal do restaurante ainda não foi habilitada.",
                severity="blocking",
            )
        )
        ready = False

    return FiscalPreflightResult(
        ready=ready,
        mode=normalized_mode,
        jurisdiction_key=profile_result.jurisdiction_key,
        profile_ready=profile_result.ready,
        references_ready=references_ready,
        issues=tuple(blocking_issues),
        warnings=tuple(warnings),
        references=tuple(checks),
        compliance_baseline=_baseline_payload(profile_result.jurisdiction_key),
    )


def preflight_payload(result: FiscalPreflightResult) -> dict[str, object]:
    return {
        "ready": result.ready,
        "mode": result.mode,
        "jurisdictionKey": result.jurisdiction_key,
        "profileReady": result.profile_ready,
        "referencesReady": result.references_ready,
        "issues": [
            {
                "code": issue.code,
                "message": issue.message,
                "severity": issue.severity,
                "sourceKey": issue.source_key,
            }
            for issue in result.issues
        ],
        "warnings": [
            {
                "code": issue.code,
                "message": issue.message,
                "severity": issue.severity,
                "sourceKey": issue.source_key,
            }
            for issue in result.warnings
        ],
        "references": [
            {
                "sourceKey": check.source_key,
                "title": check.title,
                "blocking": check.blocking,
                "status": check.status,
                "stale": check.stale,
                "checkedAt": check.checked_at.isoformat() if check.checked_at else None,
                "observedSnapshotId": check.observed_snapshot_id,
                "activeSnapshotId": check.active_snapshot_id,
                "observedVersion": check.observed_version,
                "activeVersion": check.active_version,
                "lastError": check.last_error,
            }
            for check in result.references
        ],
        "complianceBaseline": list(result.compliance_baseline),
    }
