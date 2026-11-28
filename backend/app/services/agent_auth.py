"""Autenticação escopada e auditável para agentes externos (least privilege + rotação + revogação)."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
from dataclasses import dataclass
from typing import Any

from fastapi import Header, HTTPException, status

from ..routes.super_admin import get_current_admin

AGENT_SCOPE_READ = "agent:read"
AGENT_SCOPE_PROVISION = "agent:provision"
AGENT_SCOPE_DEPROVISION_OFFBOARD = "agent:deprovision_offboard"
AGENT_SCOPE_DEPROVISION_QA_PURGE = "agent:deprovision_qa_purge"

ALL_AGENT_SCOPES = frozenset(
    {
        AGENT_SCOPE_READ,
        AGENT_SCOPE_PROVISION,
        AGENT_SCOPE_DEPROVISION_OFFBOARD,
        AGENT_SCOPE_DEPROVISION_QA_PURGE,
    }
)

_ENV_TOKEN_MAP: tuple[tuple[str, str, frozenset[str]], ...] = (
    ("KOMA_AGENT_READ_TOKEN", "env_read", frozenset({AGENT_SCOPE_READ})),
    (
        "KOMA_PROVISIONING_API_TOKEN",
        "env_provision",
        frozenset({AGENT_SCOPE_READ, AGENT_SCOPE_PROVISION}),
    ),
    (
        "KOMA_OFFBOARDING_API_TOKEN",
        "env_offboard",
        frozenset({AGENT_SCOPE_READ, AGENT_SCOPE_DEPROVISION_OFFBOARD}),
    ),
    (
        "KOMA_DEPROVISIONING_API_TOKEN",
        "env_deprovision",
        frozenset(
            {
                AGENT_SCOPE_READ,
                AGENT_SCOPE_DEPROVISION_OFFBOARD,
                AGENT_SCOPE_DEPROVISION_QA_PURGE,
            }
        ),
    ),
)

_SAFE_LABEL_RE = re.compile(r"[^A-Za-z0-9_.@:-]+")


@dataclass(frozen=True)
class AgentTokenSlot:
    agent_id: str
    token: str
    scopes: frozenset[str]


def _sanitize_declared_actor(raw_actor: str | None) -> str | None:
    if not raw_actor:
        return None
    cleaned = _SAFE_LABEL_RE.sub("-", str(raw_actor).strip()).strip("-")
    if not cleaned:
        return None
    return cleaned[:64]


def _token_fingerprint(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()[:8]


def _parse_json_slots(raw_json: str) -> list[AgentTokenSlot]:
    if not raw_json.strip():
        return []
    try:
        parsed = json.loads(raw_json)
    except (TypeError, ValueError):
        return []
    if not isinstance(parsed, list):
        return []

    slots: list[AgentTokenSlot] = []
    for index, entry in enumerate(parsed):
        if not isinstance(entry, dict):
            continue
        if entry.get("revoked") is True or entry.get("active") is False:
            continue
        token = str(entry.get("token") or "").strip()
        if not token:
            continue
        raw_id = str(entry.get("id") or f"agent_{index}").strip()
        agent_id = _sanitize_declared_actor(raw_id) or f"agent_{index}"
        raw_scopes = entry.get("scopes") or []
        if not isinstance(raw_scopes, list):
            continue
        scopes = frozenset(
            str(scope).strip()
            for scope in raw_scopes
            if str(scope).strip() in ALL_AGENT_SCOPES
        )
        if not scopes:
            continue
        slots.append(AgentTokenSlot(agent_id=agent_id, token=token, scopes=scopes))
    return slots


def load_agent_token_slots() -> list[AgentTokenSlot]:
    """Carrega tokens escopados de variáveis de ambiente com suporte a rotação e revogação."""
    slots: list[AgentTokenSlot] = []

    raw_json = os.getenv("KOMA_AGENT_TOKENS_JSON", "")
    slots.extend(_parse_json_slots(raw_json))

    for env_name, prefix, scopes in _ENV_TOKEN_MAP:
        raw_val = os.getenv(env_name, "")
        if not raw_val.strip():
            continue
        # Suporta múltiplos tokens separados por vírgula para rotação sem downtime
        parts = [part.strip() for part in raw_val.split(",") if part.strip()]
        for idx, token in enumerate(parts):
            slot_id = prefix if len(parts) == 1 else f"{prefix}_{idx + 1}"
            slots.append(AgentTokenSlot(agent_id=slot_id, token=token, scopes=scopes))

    return slots


def authenticate_agent_principal(
    authorization: str | None = Header(default=None),
    x_provisioning_actor: str | None = Header(default=None, alias="X-Provisioning-Actor"),
) -> dict[str, Any]:
    """Autentica via token escopado ou fallback explícito de Super Admin JWT.

    Nunca confia em X-Provisioning-Actor como prova de identidade: a identidade
    autoritativa vem do slot verificado + fingerprint SHA-256 do token.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de autenticação obrigatório.",
        )
    raw_token = authorization.split(" ", 1)[1].strip()
    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de autenticação inválido.",
        )

    declared_actor = _sanitize_declared_actor(x_provisioning_actor)

    matched_slot: AgentTokenSlot | None = None
    for slot in load_agent_token_slots():
        if hmac.compare_digest(raw_token, slot.token):
            matched_slot = slot
            break

    if matched_slot is not None:
        fp = _token_fingerprint(raw_token)
        return {
            "actor": f"agent:{matched_slot.agent_id}:fp:{fp}",
            "agent_id": matched_slot.agent_id,
            "token_fingerprint": fp,
            "declared_actor": declared_actor,
            "scopes": matched_slot.scopes,
            "role": "scoped_agent",
            "auth_type": "scoped_token",
        }

    # Fallback explícito: sessão Super Admin autenticada por JWT válido
    admin = get_current_admin(authorization=authorization)
    return {
        "actor": f"superadmin:{str(admin.get('user') or 'superadmin')}",
        "agent_id": str(admin.get("user") or "superadmin"),
        "token_fingerprint": None,
        "declared_actor": declared_actor,
        "scopes": ALL_AGENT_SCOPES,
        "role": "superadmin",
        "auth_type": "superadmin_jwt",
    }


def require_agent_scope(principal: dict[str, Any], required_scope: str) -> None:
    """Garante menor privilégio (fail-closed) para a operação solicitada."""
    scopes = principal.get("scopes") or frozenset()
    if required_scope not in scopes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Credencial válida, mas sem escopo suficiente para esta operação "
                f"(requer '{required_scope}')."
            ),
        )
