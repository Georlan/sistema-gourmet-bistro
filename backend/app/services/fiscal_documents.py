from __future__ import annotations

import copy
import datetime
import uuid
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..fiscal_models import FiscalDocument, FiscalEvent, FiscalSequence
from .fiscal_state import validate_fiscal_transition


class FiscalDocumentPersistenceError(RuntimeError):
    pass


class FiscalDocumentNotFound(FiscalDocumentPersistenceError):
    pass


class FiscalEventConflict(FiscalDocumentPersistenceError):
    pass


@dataclass(frozen=True)
class FiscalDocumentCreationResult:
    document: FiscalDocument
    replayed: bool


@dataclass(frozen=True)
class FiscalDocumentTransitionResult:
    document: FiscalDocument
    event: FiscalEvent
    replayed: bool


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _validate_scope(*, environment: str, model: str, series: int) -> None:
    if environment not in {"homologacao", "producao"}:
        raise FiscalDocumentPersistenceError("Ambiente fiscal inválido.")
    if model != "65":
        raise FiscalDocumentPersistenceError("A fundação fiscal atual suporta somente NFC-e modelo 65.")
    if isinstance(series, bool) or not isinstance(series, int) or series <= 0:
        raise FiscalDocumentPersistenceError("Série fiscal deve ser um inteiro positivo.")


def _money(value: object) -> Decimal:
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise FiscalDocumentPersistenceError("Valor total fiscal inválido.") from exc
    if not amount.is_finite() or amount < 0:
        raise FiscalDocumentPersistenceError("Valor total fiscal não pode ser negativo.")
    return amount.quantize(Decimal("0.01"))


def reserve_fiscal_number(
    db: Session,
    *,
    restaurante_id: int,
    environment: str,
    model: str = "65",
    series: int = 1,
) -> int:
    """Reserva um número monotônico dentro da transação corrente.

    Em PostgreSQL a primeira criação e os incrementos usam um único UPSERT
    atômico. O número só se torna consumido quando a transação chamadora faz
    commit; rollback desfaz também o avanço da sequência.

    O fallback ORM existe para testes SQLite. A garantia concorrente de produção
    é deliberadamente a implementação PostgreSQL.
    """

    _validate_scope(environment=environment, model=model, series=series)
    now = _utcnow()
    bind = db.get_bind()

    if bind.dialect.name == "postgresql":
        table = FiscalSequence.__table__
        statement = (
            pg_insert(table)
            .values(
                restaurante_id=restaurante_id,
                environment=environment,
                model=model,
                series=series,
                next_number=2,
                version=1,
                updated_at=now,
            )
            .on_conflict_do_update(
                constraint="uq_fiscal_sequence_scope",
                set_={
                    "next_number": table.c.next_number + 1,
                    "version": table.c.version + 1,
                    "updated_at": now,
                },
            )
            .returning(table.c.next_number)
        )
        next_number = int(db.execute(statement).scalar_one())
        return next_number - 1

    sequence = (
        db.query(FiscalSequence)
        .filter(
            FiscalSequence.restaurante_id == restaurante_id,
            FiscalSequence.environment == environment,
            FiscalSequence.model == model,
            FiscalSequence.series == series,
        )
        .with_for_update()
        .first()
    )
    if sequence is None:
        sequence = FiscalSequence(
            restaurante_id=restaurante_id,
            environment=environment,
            model=model,
            series=series,
            next_number=2,
            version=1,
            updated_at=now,
        )
        db.add(sequence)
        db.flush()
        return 1

    reserved = int(sequence.next_number)
    sequence.next_number = reserved + 1
    sequence.version = int(sequence.version) + 1
    sequence.updated_at = now
    db.flush()
    return reserved


def create_numbered_fiscal_document(
    db: Session,
    *,
    restaurante_id: int,
    idempotency_key: str,
    sale_snapshot: dict[str, Any],
    total_amount: object,
    comanda_id: str | None = None,
    environment: str = "homologacao",
    model: str = "65",
    series: int = 1,
    provider: str = "direct_sefaz",
) -> FiscalDocumentCreationResult:
    """Cria documento numerado exatamente uma vez por tenant/idempotency key.

    Nenhuma chamada externa deve ocorrer entre a reserva do número e o commit.
    O futuro Fiscal Preflight chamará este serviço somente depois de validar o
    snapshot da venda; a autorização SEFAZ virá em etapa posterior.
    """

    key = str(idempotency_key or "").strip()
    if not key:
        raise FiscalDocumentPersistenceError("idempotency_key fiscal é obrigatório.")
    if not isinstance(sale_snapshot, dict) or not sale_snapshot:
        raise FiscalDocumentPersistenceError("sale_snapshot fiscal é obrigatório.")
    _validate_scope(environment=environment, model=model, series=series)
    amount = _money(total_amount)

    existing = (
        db.query(FiscalDocument)
        .filter(
            FiscalDocument.restaurante_id == restaurante_id,
            FiscalDocument.idempotency_key == key,
        )
        .first()
    )
    if existing is not None:
        return FiscalDocumentCreationResult(existing, True)

    document_id = str(uuid.uuid4())
    number = reserve_fiscal_number(
        db,
        restaurante_id=restaurante_id,
        environment=environment,
        model=model,
        series=series,
    )
    document = FiscalDocument(
        id=document_id,
        restaurante_id=restaurante_id,
        comanda_id=comanda_id,
        idempotency_key=key,
        status="draft",
        model=model,
        environment=environment,
        series=series,
        number=number,
        provider=provider,
        total_amount=amount,
        sale_snapshot=copy.deepcopy(sale_snapshot),
    )
    event = FiscalEvent(
        restaurante_id=restaurante_id,
        document_id=document_id,
        event_key="document.created",
        event_type="document.created",
        from_status=None,
        to_status="draft",
        payload={"number": number, "model": model, "series": series},
    )
    db.add(document)
    db.add(event)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        recovered = (
            db.query(FiscalDocument)
            .filter(
                FiscalDocument.restaurante_id == restaurante_id,
                FiscalDocument.idempotency_key == key,
            )
            .first()
        )
        if recovered is not None:
            return FiscalDocumentCreationResult(recovered, True)
        raise FiscalDocumentPersistenceError(
            "Falha de integridade ao persistir documento fiscal."
        ) from exc

    db.refresh(document)
    return FiscalDocumentCreationResult(document, False)


def _assert_replay_matches(
    event: FiscalEvent,
    *,
    event_type: str,
    to_status: str,
) -> None:
    if event.event_type != event_type or event.to_status != to_status:
        raise FiscalEventConflict(
            "event_key fiscal já foi usado com outro tipo ou estado de destino."
        )


def transition_fiscal_document(
    db: Session,
    *,
    restaurante_id: int,
    document_id: str,
    event_key: str,
    event_type: str,
    to_status: str,
    actor_id: str | None = None,
    external_protocol: str | None = None,
    payload: dict[str, Any] | None = None,
) -> FiscalDocumentTransitionResult:
    """Persiste mudança de estado e evento de forma atômica e idempotente."""

    normalized_event_key = str(event_key or "").strip()
    normalized_event_type = str(event_type or "").strip()
    if not normalized_event_key or not normalized_event_type:
        raise FiscalDocumentPersistenceError("event_key e event_type fiscais são obrigatórios.")

    replay_event = (
        db.query(FiscalEvent)
        .filter(
            FiscalEvent.restaurante_id == restaurante_id,
            FiscalEvent.document_id == document_id,
            FiscalEvent.event_key == normalized_event_key,
        )
        .first()
    )
    if replay_event is not None:
        _assert_replay_matches(
            replay_event,
            event_type=normalized_event_type,
            to_status=to_status,
        )
        replay_document = (
            db.query(FiscalDocument)
            .filter(
                FiscalDocument.restaurante_id == restaurante_id,
                FiscalDocument.id == document_id,
            )
            .first()
        )
        if replay_document is None:
            raise FiscalDocumentNotFound("Documento fiscal do evento não foi encontrado.")
        return FiscalDocumentTransitionResult(replay_document, replay_event, True)

    document = (
        db.query(FiscalDocument)
        .filter(
            FiscalDocument.restaurante_id == restaurante_id,
            FiscalDocument.id == document_id,
        )
        .with_for_update()
        .first()
    )
    if document is None:
        db.rollback()
        raise FiscalDocumentNotFound("Documento fiscal não encontrado neste tenant.")

    try:
        transition = validate_fiscal_transition(document.status, to_status)
    except Exception:
        db.rollback()
        raise

    event = FiscalEvent(
        restaurante_id=restaurante_id,
        document_id=document.id,
        event_key=normalized_event_key,
        event_type=normalized_event_type,
        from_status=transition.from_status,
        to_status=transition.to_status,
        actor_id=actor_id,
        external_protocol=external_protocol,
        payload=copy.deepcopy(payload) if payload is not None else None,
    )
    document.status = transition.to_status
    db.add(event)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        recovered_event = (
            db.query(FiscalEvent)
            .filter(
                FiscalEvent.restaurante_id == restaurante_id,
                FiscalEvent.document_id == document_id,
                FiscalEvent.event_key == normalized_event_key,
            )
            .first()
        )
        recovered_document = (
            db.query(FiscalDocument)
            .filter(
                FiscalDocument.restaurante_id == restaurante_id,
                FiscalDocument.id == document_id,
            )
            .first()
        )
        if recovered_event is not None and recovered_document is not None:
            _assert_replay_matches(
                recovered_event,
                event_type=normalized_event_type,
                to_status=to_status,
            )
            return FiscalDocumentTransitionResult(
                recovered_document,
                recovered_event,
                True,
            )
        raise FiscalDocumentPersistenceError(
            "Falha de integridade ao persistir transição fiscal."
        ) from exc

    db.refresh(document)
    db.refresh(event)
    return FiscalDocumentTransitionResult(document, event, False)
