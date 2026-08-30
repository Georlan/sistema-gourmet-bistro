"""Serviço de Transactional Outbox e Integrações do KÔMA."""

from .publisher import enqueue_outbox_event_in_session
from .signer import (
    build_webhook_headers,
    sign_webhook_payload,
    verify_webhook_envelope,
    verify_webhook_signature,
)
from .dispatcher import (
    claim_outbox_batch,
    dispatch_pending_outbox_events,
    dispatch_single_outbox_event,
    recover_stale_outbox_claims,
)
from .worker import OutboxWorker, default_outbox_worker, discover_active_restaurant_ids

__all__ = [
    "enqueue_outbox_event_in_session",
    "sign_webhook_payload",
    "build_webhook_headers",
    "verify_webhook_signature",
    "verify_webhook_envelope",
    "claim_outbox_batch",
    "recover_stale_outbox_claims",
    "dispatch_pending_outbox_events",
    "dispatch_single_outbox_event",
    "OutboxWorker",
    "default_outbox_worker",
    "discover_active_restaurant_ids",
]
