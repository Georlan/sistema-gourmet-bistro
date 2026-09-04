"""Serviço de Transactional Outbox e Integrações do KÔMA.

O worker é carregado sob demanda. Isso evita um ciclo de importação entre
`scheduled_orders` -> `outbox` -> `worker` -> `scheduled_orders` durante o boot
da aplicação, sem alterar a API pública do pacote.
"""

from typing import TYPE_CHECKING, Any

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

if TYPE_CHECKING:
    from .worker import OutboxWorker


_WORKER_EXPORTS = {
    "OutboxWorker",
    "default_outbox_worker",
    "discover_active_restaurant_ids",
}


def __getattr__(name: str) -> Any:
    if name in _WORKER_EXPORTS:
        from . import worker

        return getattr(worker, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


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
