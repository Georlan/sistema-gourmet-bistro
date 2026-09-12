from __future__ import annotations

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from .models import PrintJob


def _restore_previous_value(job: PrintJob, attribute_name: str) -> None:
    history = inspect(job).attrs[attribute_name].history
    if history.deleted:
        setattr(job, attribute_name, history.deleted[0])


def _preserve_terminal_print_jobs(session: Session, _flush_context, _instances) -> None:
    """Impede callbacks atrasados de reabrirem um job já aceito pelo spooler.

    ``printed`` é terminal. O agente pode confirmar a impressão e, por atraso de
    rede, um callback de falha antigo chegar depois. Sem esta barreira o callback
    tardio consegue voltar o job para ``pending``/``failed`` e o cupom pode ser
    enviado ao spooler novamente.
    """
    for job in tuple(session.dirty):
        if not isinstance(job, PrintJob):
            continue

        status_history = inspect(job).attrs.status.history
        if not status_history.has_changes() or "printed" not in status_history.deleted:
            continue

        for attribute_name in (
            "status",
            "attempts",
            "last_error",
            "claimed_at",
            "agent_id",
        ):
            _restore_previous_value(job, attribute_name)


if not event.contains(Session, "before_flush", _preserve_terminal_print_jobs):
    event.listen(Session, "before_flush", _preserve_terminal_print_jobs)
