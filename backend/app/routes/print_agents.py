import hashlib
import secrets
import datetime
import logging
import os
import re
from collections.abc import Mapping
from typing import Literal, Optional, List
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Header,
    Query,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from zoneinfo import ZoneInfo

from ..database import (
    SessionLocal,
    bind_session_to_tenant,
    get_db,
    current_restaurante_id,
)
from ..models import PrintJob, PrintAgentToken, Usuario
from ..security import require_permission
from ..websocket_manager import manager

router = APIRouter(prefix="/api/print-agents", tags=["Print Agents"])
log = logging.getLogger("koma.print_agents")

MAX_ATTEMPTS = 3
MAX_CLAIM_BATCH_SIZE = 10
AGENT_ONLINE_THRESHOLD_SECONDS = 90
PRINTER_DIAGNOSTICS_FRESH_SECONDS = 90
PRINT_DELAY_THRESHOLD_SECONDS = 120
PRINT_HISTORY_VISIBLE_LIMIT = 20
PRINT_QUEUE_VISIBLE_LIMIT = 50
AGENT_COMMAND_TIMEOUT_SECONDS = 45
UNRESOLVED_JOB_STATUSES = ("pending", "claimed", "printing")
TERMINAL_JOB_STATUSES = ("printed", "failed", "cancelled")


def _positive_int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


PRINT_JOB_TOMBSTONE_DAYS = _positive_int_env(
    "KOMA_PRINT_DEDUP_RETENTION_DAYS",
    7,
)
PRINT_JOB_TOMBSTONE_LIMIT = _positive_int_env(
    "KOMA_PRINT_DEDUP_MAX_TOMBSTONES",
    1000,
)
PRINT_JOB_MAX_UNRESOLVED_AGE_SECONDS = _positive_int_env(
    "KOMA_PRINT_MAX_UNRESOLVED_AGE_SECONDS",
    6 * 60 * 60,
)
try:
    PRINT_HISTORY_TIMEZONE = ZoneInfo(
        os.getenv("KOMA_PRINT_TIMEZONE", "America/Fortaleza")
    )
except Exception:
    PRINT_HISTORY_TIMEZONE = ZoneInfo("America/Fortaleza")

ORDER_REFERENCE_PATTERNS = (
    re.compile(
        r"\bPEDIDO\s*:\s*#?\s*([A-Z0-9][A-Z0-9._/-]*)",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bPED(?:IDO)?\s*#\s*([A-Z0-9][A-Z0-9._/-]*)",
        re.IGNORECASE,
    ),
)
TABLE_REFERENCE_PATTERN = re.compile(
    r"\bMESA\s*:?\s*(\d+|BALC[AÃ]O)\b",
    re.IGNORECASE,
)


def hash_token(token: str) -> str:
    """Gera hash SHA-256 seguro para o token do agente."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _field(job, name: str):
    if isinstance(job, Mapping):
        return job.get(name)
    return getattr(job, name)


def _queue_latency_ms(
    created_at: Optional[datetime.datetime],
    claimed_at: datetime.datetime,
) -> Optional[int]:
    """Calcula a espera na fila usando apenas o relógio do servidor."""
    if not created_at:
        return None
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=datetime.timezone.utc)
    return max(
        0,
        round(
            (
                claimed_at
                - created_at.astimezone(datetime.timezone.utc)
            ).total_seconds()
            * 1000
        ),
    )


def _as_utc(value: Optional[datetime.datetime]) -> Optional[datetime.datetime]:
    """Normaliza timestamps do PostgreSQL e do SQLite para UTC."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=datetime.timezone.utc)
    return value.astimezone(datetime.timezone.utc)


def _print_history_day_bounds(
    now: datetime.datetime,
) -> tuple[datetime.datetime, datetime.datetime, str]:
    """Retorna o dia operacional local convertido para limites UTC."""
    local_now = _as_utc(now).astimezone(PRINT_HISTORY_TIMEZONE)
    local_start = datetime.datetime.combine(
        local_now.date(),
        datetime.time.min,
        tzinfo=PRINT_HISTORY_TIMEZONE,
    )
    local_end = local_start + datetime.timedelta(days=1)
    return (
        local_start.astimezone(datetime.timezone.utc),
        local_end.astimezone(datetime.timezone.utc),
        local_now.date().isoformat(),
    )


def _run_print_history_maintenance(
    restaurante_id: int,
    now: datetime.datetime,
) -> None:
    """
    Mantém somente os 20 cupons recentes do dia com conteúdo reimprimível.

    Registros mais antigos viram tombstones leves para preservar a chave de
    idempotência. Tombstones terminais expiram depois do período técnico
    configurado; pedidos ainda pendentes nunca são removidos ou compactados.
    """
    tenant_token = current_restaurante_id.set(restaurante_id)
    db = SessionLocal(restaurante_id=restaurante_id)
    try:
        day_start, day_end, _ = _print_history_day_bounds(now)
        keep_ids = [
            row[0]
            for row in (
                db.query(PrintJob.id)
                .filter(
                    PrintJob.restaurante_id == restaurante_id,
                    PrintJob.status.in_(TERMINAL_JOB_STATUSES),
                    PrintJob.created_at >= day_start,
                    PrintJob.created_at < day_end,
                )
                .order_by(PrintJob.created_at.desc())
                .limit(PRINT_HISTORY_VISIBLE_LIMIT)
                .all()
            )
        ]

        compact_query = db.query(PrintJob).filter(
            PrintJob.restaurante_id == restaurante_id,
            PrintJob.status.in_(TERMINAL_JOB_STATUSES),
            PrintJob.payload_text != "",
        )
        if keep_ids:
            compact_query = compact_query.filter(
                ~PrintJob.id.in_(keep_ids)
            )
        compacted = compact_query.update(
            {
                "payload_text": "",
                "last_error": None,
            },
            synchronize_session=False,
        )

        retention_cutoff = now - datetime.timedelta(
            days=PRINT_JOB_TOMBSTONE_DAYS
        )
        deleted = (
            db.query(PrintJob)
            .filter(
                PrintJob.restaurante_id == restaurante_id,
                PrintJob.status.in_(TERMINAL_JOB_STATUSES),
                PrintJob.payload_text == "",
                PrintJob.created_at < retention_cutoff,
            )
            .delete(synchronize_session=False)
        )
        retained_tombstone_ids = [
            row[0]
            for row in (
                db.query(PrintJob.id)
                .filter(
                    PrintJob.restaurante_id == restaurante_id,
                    PrintJob.status.in_(TERMINAL_JOB_STATUSES),
                    PrintJob.payload_text == "",
                )
                .order_by(PrintJob.created_at.desc(), PrintJob.id.desc())
                .limit(PRINT_JOB_TOMBSTONE_LIMIT)
                .all()
            )
        ]
        overflow_deleted = 0
        if retained_tombstone_ids:
            overflow_deleted = (
                db.query(PrintJob)
                .filter(
                    PrintJob.restaurante_id == restaurante_id,
                    PrintJob.status.in_(TERMINAL_JOB_STATUSES),
                    PrintJob.payload_text == "",
                    ~PrintJob.id.in_(retained_tombstone_ids),
                )
                .delete(synchronize_session=False)
            )
        db.commit()
        if compacted or deleted or overflow_deleted:
            log.info(
                "[RETENÇÃO DE IMPRESSÃO] restaurante=%s compactados=%s "
                "tombstones_expirados=%s tombstones_excedentes=%s",
                restaurante_id,
                compacted,
                deleted,
                overflow_deleted,
            )
    except Exception:
        db.rollback()
        log.exception(
            "Falha na manutenção do histórico de impressão do restaurante %s",
            restaurante_id,
        )
    finally:
        db.close()
        current_restaurante_id.reset(tenant_token)


def _schedule_print_history_maintenance(
    background_tasks: BackgroundTasks,
    restaurante_id: int,
    now: datetime.datetime,
) -> None:
    """
    Compacta após cada confirmação, fora do tempo de resposta ao agente.

    Assim cada restaurante conserva no máximo 20 cupons completos do dia,
    mesmo em um turno com alto volume de impressão.
    """
    background_tasks.add_task(
        _run_print_history_maintenance,
        restaurante_id,
        now,
    )


def _schedule_print_monitor_refresh(
    background_tasks: BackgroundTasks,
    restaurante_id: int,
) -> None:
    """Atualiza silenciosamente os monitores abertos via WebSocket."""
    background_tasks.add_task(
        manager.broadcast,
        {"event": "print_monitor_updated"},
        restaurante_id=restaurante_id,
        target_audience="internal",
    )


def _age_seconds(
    value: Optional[datetime.datetime],
    now: datetime.datetime,
) -> Optional[int]:
    normalized = _as_utc(value)
    if normalized is None:
        return None
    return max(0, round((now - normalized).total_seconds()))


def _expire_stale_agent_command(
    agent: PrintAgentToken,
    now: datetime.datetime,
) -> bool:
    """Encerra comandos que o agente não confirmou dentro do prazo."""
    command = (
        dict(agent.pending_command)
        if isinstance(agent.pending_command, Mapping)
        else None
    )
    command_age = _age_seconds(agent.command_requested_at, now)
    if (
        not command
        or command_age is None
        or command_age <= AGENT_COMMAND_TIMEOUT_SECONDS
    ):
        return False

    agent.last_command_result = {
        "id": command.get("id"),
        "success": False,
        "code": "command_expired",
        "message": (
            "A busca USB não respondeu dentro do prazo. "
            "Tente novamente; se continuar, contate o suporte."
        ),
        "printer_name": None,
        "completed_at": now.isoformat(),
    }
    agent.command_completed_at = now
    agent.pending_command = None
    agent.command_requested_at = None
    return True


def _agent_printer_state(
    agent: PrintAgentToken,
    now: datetime.datetime,
) -> dict:
    """
    Separa presença do conector da presença da impressora física.

    Uma fila antiga do CUPS/Spooler não é suficiente. Para ficar ``ready``, o
    agente precisa estar online, o diagnóstico deve ser recente e a impressora
    deve declarar presença física, configuração e disponibilidade.
    """
    last_seen = _as_utc(agent.last_seen_at)
    diagnostics_updated_at = _as_utc(agent.diagnostics_updated_at)
    heartbeat_age = _age_seconds(last_seen, now)
    diagnostics_age = _age_seconds(diagnostics_updated_at, now)
    online = bool(
        heartbeat_age is not None
        and heartbeat_age <= AGENT_ONLINE_THRESHOLD_SECONDS
    )
    diagnostics_fresh = bool(
        online
        and diagnostics_age is not None
        and diagnostics_age <= PRINTER_DIAGNOSTICS_FRESH_SECONDS
    )
    diagnostics = (
        agent.printer_diagnostics
        if isinstance(agent.printer_diagnostics, Mapping)
        else {}
    )
    printers = diagnostics.get("printers")
    if not isinstance(printers, list):
        printers = []
    capabilities = diagnostics.get("capabilities")
    if not isinstance(capabilities, list):
        capabilities = []
    physical_present = any(
        isinstance(printer, Mapping)
        and printer.get("connection") == "usb"
        and printer.get("present") is True
        for printer in printers
    )
    ready_printers = [
        printer
        for printer in printers
        if (
            isinstance(printer, Mapping)
            and printer.get("connection") == "usb"
            and printer.get("available") is True
            and printer.get("present") is True
            and printer.get("configured") is True
        )
    ]
    return {
        "online": online,
        "heartbeat_age_seconds": heartbeat_age,
        "diagnostics_fresh": diagnostics_fresh,
        "diagnostics_age_seconds": diagnostics_age,
        "physical_printer_present": (
            diagnostics_fresh and physical_present
        ),
        "printer_ready": (
            diagnostics_fresh and bool(ready_printers)
        ),
        "ready_printer_count": (
            len(ready_printers) if diagnostics_fresh else 0
        ),
        "supports_usb_commands": (
            diagnostics_fresh and "connect_usb" in capabilities
        ),
    }


def _restaurant_has_ready_printer(
    db: Session,
    restaurante_id: int,
    now: datetime.datetime,
) -> bool:
    agents = db.query(PrintAgentToken).filter(
        PrintAgentToken.restaurante_id == restaurante_id,
        PrintAgentToken.ativo == True,
    ).all()
    return any(
        _agent_printer_state(agent, now)["printer_ready"]
        for agent in agents
    )


def _match_print_reference(
    patterns: tuple[re.Pattern[str], ...],
    payload_text: str,
) -> Optional[str]:
    for pattern in patterns:
        match = pattern.search(payload_text)
        if match:
            return match.group(1).strip(" .,:;")
    return None


def _print_job_reference(job: PrintJob) -> dict:
    """
    Converte identificadores técnicos em uma referência operacional legível.

    O número exibido no cupom é a fonte preferida porque ``source_id`` pode ser
    um UUID interno da comanda. O payload completo continua restrito ao backend.
    """
    payload_text = job.payload_text or ""
    source_type = (job.source_type or "").strip().casefold()
    source_id = (job.source_id or "").strip()

    if source_type.startswith("teste") or "TESTE REAL" in payload_text.upper():
        return {
            "label": "Teste de impressão",
            "order_number": None,
            "table_number": None,
        }

    order_number = _match_print_reference(
        ORDER_REFERENCE_PATTERNS,
        payload_text,
    )
    table_number = _match_print_reference(
        (TABLE_REFERENCE_PATTERN,),
        payload_text,
    )

    if table_number:
        normalized_table = table_number.casefold()
        if normalized_table in {"balcao", "balcão"}:
            table_number = "Balcão"

    if order_number:
        label = f"Pedido #{order_number}"
        if table_number:
            table_label = (
                table_number
                if table_number == "Balcão"
                else f"Mesa {table_number}"
            )
            label = f"{label} · {table_label}"
    elif source_type == "comanda":
        source_table = re.fullmatch(
            r"(?:mesa[-_\s]*)?(\d+)",
            source_id,
            re.IGNORECASE,
        )
        if source_table:
            table_number = table_number or source_table.group(1)
            label = f"Mesa {table_number}"
        else:
            label = "Fechamento"
    elif (job.document_type or "").casefold() == "entrega":
        label = "Pedido de entrega"
    else:
        label = "Pedido"

    return {
        "label": label,
        "order_number": order_number,
        "table_number": table_number,
    }


def _claimed_job_payload(job, claimed_at: datetime.datetime) -> dict:
    created_at = _field(job, "created_at")
    return {
        "id": _field(job, "id"),
        "restaurante_id": _field(job, "restaurante_id"),
        "document_type": _field(job, "document_type"),
        "destination": _field(job, "destination"),
        "source_type": _field(job, "source_type"),
        "source_id": _field(job, "source_id"),
        "payload_text": _field(job, "payload_text"),
        "attempts": _field(job, "attempts"),
        "idempotency_key": _field(job, "idempotency_key"),
        "created_at": created_at.isoformat() if created_at else None,
        "claimed_at": claimed_at.isoformat(),
        "queue_latency_ms": _queue_latency_ms(created_at, claimed_at),
    }


def _release_stuck_jobs(
    db: Session,
    restaurante_id: int,
    now: datetime.datetime,
) -> int:
    stuck_cutoff = now - datetime.timedelta(minutes=5)
    return db.query(PrintJob).filter(
        PrintJob.restaurante_id == restaurante_id,
        PrintJob.status == "claimed",
        PrintJob.claimed_at < stuck_cutoff,
    ).update(
        {
            "status": "pending",
            "claimed_at": None,
            "agent_id": None,
        },
        synchronize_session=False,
    )


def _expire_stale_unresolved_jobs(
    db: Session,
    restaurante_id: int,
    now: datetime.datetime,
) -> int:
    """Cancela trabalhos antigos antes que uma reconexão os imprima horas depois."""
    cutoff = now - datetime.timedelta(
        seconds=PRINT_JOB_MAX_UNRESOLVED_AGE_SECONDS
    )
    max_age_hours = max(
        1,
        round(PRINT_JOB_MAX_UNRESOLVED_AGE_SECONDS / 3600),
    )
    return db.query(PrintJob).filter(
        PrintJob.restaurante_id == restaurante_id,
        PrintJob.status.in_(UNRESOLVED_JOB_STATUSES),
        PrintJob.created_at < cutoff,
    ).update(
        {
            "status": "cancelled",
            "claimed_at": None,
            "agent_id": None,
            "last_error": (
                f"Expirado após {max_age_hours}h sem impressão. "
                "Reimprima manualmente se ainda for necessário."
            ),
        },
        synchronize_session=False,
    )


def _claim_pending_jobs(
    db: Session,
    agent: PrintAgentToken,
    now: datetime.datetime,
    limit: int,
) -> list[dict]:
    """Reserva atomicamente até ``limit`` trabalhos na ordem da fila."""
    safe_limit = max(1, min(limit, MAX_CLAIM_BATCH_SIZE))
    expired_jobs = _expire_stale_unresolved_jobs(
        db,
        agent.restaurante_id,
        now,
    )
    released_jobs = _release_stuck_jobs(db, agent.restaurante_id, now)
    if expired_jobs or released_jobs:
        db.flush()

    if db.get_bind().dialect.name == "postgresql":
        claimed_rows = db.execute(
            text(
                """
                WITH candidates AS (
                    SELECT candidate.id
                    FROM print_jobs AS candidate
                    WHERE candidate.restaurante_id = :restaurante_id
                      AND candidate.status = 'pending'
                    ORDER BY candidate.created_at ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT :claim_limit
                )
                UPDATE print_jobs AS target
                SET
                    status = 'claimed',
                    claimed_at = :claimed_at,
                    agent_id = :agent_id
                FROM candidates
                WHERE target.id = candidates.id
                RETURNING
                    target.id,
                    target.restaurante_id,
                    target.document_type,
                    target.destination,
                    target.source_type,
                    target.source_id,
                    target.payload_text,
                    target.attempts,
                    target.idempotency_key,
                    target.created_at
                """
            ),
            {
                "claimed_at": now,
                "agent_id": agent.agent_id,
                "restaurante_id": agent.restaurante_id,
                "claim_limit": safe_limit,
            },
        ).mappings().all()
        ordered_rows = sorted(
            claimed_rows,
            key=lambda row: _as_utc(row["created_at"]) or now,
        )
        payload = [
            _claimed_job_payload(row, now)
            for row in ordered_rows
        ]
        db.commit()
        return payload

    # SQLite é usado nos testes e no desenvolvimento. Cada UPDATE continua
    # condicional para preservar a exclusividade de dois agentes concorrentes.
    claimed_jobs: list[dict] = []
    while len(claimed_jobs) < safe_limit:
        candidate = (
            db.query(PrintJob.id)
            .filter(
                PrintJob.restaurante_id == agent.restaurante_id,
                PrintJob.status == "pending",
            )
            .order_by(PrintJob.created_at.asc())
            .first()
        )
        if not candidate:
            break

        rows_updated = (
            db.query(PrintJob)
            .filter(
                PrintJob.id == candidate[0],
                PrintJob.restaurante_id == agent.restaurante_id,
                PrintJob.status == "pending",
            )
            .update(
                {
                    "status": "claimed",
                    "claimed_at": now,
                    "agent_id": agent.agent_id,
                },
                synchronize_session=False,
            )
        )
        if not rows_updated:
            db.expire_all()
            continue
        job = (
            db.query(PrintJob)
            .filter(
                PrintJob.id == candidate[0],
                PrintJob.restaurante_id == agent.restaurante_id,
            )
            .first()
        )
        claimed_jobs.append(_claimed_job_payload(job, now))

    db.commit()
    return claimed_jobs


def get_current_agent(
    x_agent_token: Optional[str] = Header(None, alias="X-Agent-Token"),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
) -> PrintAgentToken:
    """
    Dependency de autenticação do Agent Token.
    Extrai o token do cabeçalho 'X-Agent-Token' ou 'Authorization: Bearer <token>'.
    Valida o hash no banco e vincula a sessão ao restaurante do agente.

    O ``last_seen_at`` é atualizado apenas no heartbeat explícito; consultas de
    fila ociosa não precisam gerar uma escrita no banco a cada polling.
    """
    raw_token = x_agent_token
    if not raw_token and authorization:
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            raw_token = parts[1]

    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de agente não fornecido no cabeçalho X-Agent-Token"
        )

    computed_hash = hash_token(raw_token.strip())
    if db.get_bind().dialect.name == "postgresql":
        identity = db.execute(
            text(
                "SELECT id, restaurante_id "
                "FROM koma_internal.auth_print_agent(:token_hash)"
            ),
            {"token_hash": computed_hash},
        ).mappings().first()
    else:
        # O hash do agente é a credencial que descobre o tenant. Uma consulta
        # ORM aqui herdaria o tenant da requisição anterior nos ambientes de
        # teste/local e poderia rejeitar um agente válido de outro restaurante.
        identity = db.execute(
            text(
                "SELECT id, restaurante_id "
                "FROM print_agent_tokens "
                "WHERE token_hash = :token_hash AND ativo = 1 "
                "LIMIT 1"
            ),
            {"token_hash": computed_hash},
        ).mappings().first()

    if not identity:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de agente inválido ou revogado"
        )

    restaurante_id = identity["restaurante_id"]
    bind_session_to_tenant(db, restaurante_id)
    current_restaurante_id.set(restaurante_id)
    try:
        agent_record = db.query(PrintAgentToken).filter(
            PrintAgentToken.id == identity["id"],
            PrintAgentToken.ativo == True,
        ).first()
        if not agent_record:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token de agente inválido ou revogado"
            )

        yield agent_record
    finally:
        # Dependencies sync com ``yield`` podem entrar/sair em contextos AnyIO
        # distintos; Token.reset() não é válido entre esses contextos.
        current_restaurante_id.set(None)

# --- SCHEMAS ---
class RegisterAgentRequest(BaseModel):
    agent_id: str

class ClaimJobResponse(BaseModel):
    id: str
    restaurante_id: int
    document_type: str
    destination: str
    source_type: str
    source_id: str
    payload_text: str
    idempotency_key: str

class CompleteJobRequest(BaseModel):
    printer_name: Optional[str] = "Padrão"


class CompleteJobItem(BaseModel):
    job_id: str = Field(min_length=1, max_length=100)
    printer_name: Optional[str] = Field(
        default="Padrão",
        max_length=200,
    )


class CompleteJobsRequest(BaseModel):
    jobs: List[CompleteJobItem] = Field(
        min_length=1,
        max_length=MAX_CLAIM_BATCH_SIZE,
    )


class ReleaseJobsRequest(BaseModel):
    job_ids: List[str] = Field(
        min_length=1,
        max_length=MAX_CLAIM_BATCH_SIZE,
    )


class DetectedPrinterReport(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    connection: Literal["usb", "network", "unknown"] = "unknown"
    uri: Optional[str] = Field(default=None, max_length=300)
    is_default: bool = False
    available: bool = False
    present: bool = False
    configured: bool = False


class PrinterDiagnosticsReport(BaseModel):
    adapter: str = Field(default="unknown", max_length=80)
    platform: str = Field(default="unknown", max_length=40)
    printers: List[DetectedPrinterReport] = Field(
        default_factory=list,
        max_length=10,
    )
    default_printer: Optional[str] = Field(default=None, max_length=200)
    error: Optional[str] = Field(default=None, max_length=300)
    capabilities: List[Literal["connect_usb"]] = Field(
        default_factory=list,
        max_length=10,
    )


class HeartbeatRequest(BaseModel):
    diagnostics: Optional[PrinterDiagnosticsReport] = None


class ConnectUsbPrinterRequest(BaseModel):
    agent_id: Optional[str] = Field(default=None, max_length=200)
    printer_name: Optional[str] = Field(default=None, max_length=200)
    printer_uri: Optional[str] = Field(default=None, max_length=300)


class CompleteAgentCommandRequest(BaseModel):
    success: bool
    code: str = Field(min_length=1, max_length=80)
    message: str = Field(min_length=1, max_length=300)
    printer_name: Optional[str] = Field(default=None, max_length=200)
    diagnostics: Optional[PrinterDiagnosticsReport] = None


class FailJobRequest(BaseModel):
    error: str


class RetryJobsRequest(BaseModel):
    job_ids: List[str] = Field(min_length=1, max_length=50)

class InjectJobRequest(BaseModel):
    """Injeção manual de PrintJob — disponível apenas para admin/gerente (JWT)."""
    restaurante_id: Optional[int] = None  # compatibilidade; deve coincidir com o tenant autenticado
    document_type: str = "producao"
    destination: str = "COZINHA"
    source_type: str = "pedido"
    source_id: str = "manual"
    payload_text: str
    idempotency_key: Optional[str] = None

# --- ENDPOINTS ---


@router.get("/monitor", summary="Monitorar agentes e fila de impressão")
def get_print_monitor(
    limit: int = Query(
        default=PRINT_HISTORY_VISIBLE_LIMIT,
        ge=1,
        le=PRINT_HISTORY_VISIBLE_LIMIT,
    ),
    current_user: Usuario = Depends(require_permission("impressao:administrar")),
    db: Session = Depends(get_db),
):
    """
    Retorna a saúde da impressão do restaurante autenticado.

    O status ``printed`` confirma que o sistema operacional aceitou o trabalho
    no CUPS/Spooler. Impressoras térmicas genéricas não fornecem confirmação
    confiável de que o papel saiu fisicamente; o painel deixa essa limitação
    explícita em vez de apresentar uma garantia inexistente.
    """
    rest_id = (
        current_restaurante_id.get()
        or getattr(current_user, "restaurante_id", None)
    )
    if not rest_id:
        raise HTTPException(
            status_code=400,
            detail="Restaurante não selecionado",
        )

    now = datetime.datetime.now(datetime.timezone.utc)
    expired_jobs = _expire_stale_unresolved_jobs(db, rest_id, now)
    if expired_jobs:
        db.commit()
    day_start, day_end, history_date = _print_history_day_bounds(now)
    delay_cutoff = now - datetime.timedelta(
        seconds=PRINT_DELAY_THRESHOLD_SECONDS
    )

    agents = (
        db.query(PrintAgentToken)
        .filter(
            PrintAgentToken.restaurante_id == rest_id,
            PrintAgentToken.ativo == True,
        )
        .order_by(PrintAgentToken.last_seen_at.desc())
        .all()
    )

    status_rows = (
        db.query(PrintJob.status, func.count(PrintJob.id))
        .filter(
            PrintJob.restaurante_id == rest_id,
            PrintJob.status.in_(UNRESOLVED_JOB_STATUSES),
        )
        .group_by(PrintJob.status)
        .all()
    )
    status_counts = {job_status: count for job_status, count in status_rows}
    failed_today = (
        db.query(func.count(PrintJob.id))
        .filter(
            PrintJob.restaurante_id == rest_id,
            PrintJob.status == "failed",
            PrintJob.created_at >= day_start,
            PrintJob.created_at < day_end,
        )
        .scalar()
        or 0
    )

    delayed_count = (
        db.query(func.count(PrintJob.id))
        .filter(
            PrintJob.restaurante_id == rest_id,
            PrintJob.status.in_(UNRESOLVED_JOB_STATUSES),
            PrintJob.created_at <= delay_cutoff,
        )
        .scalar()
        or 0
    )
    oldest_unresolved = (
        db.query(func.min(PrintJob.created_at))
        .filter(
            PrintJob.restaurante_id == rest_id,
            PrintJob.status.in_(UNRESOLVED_JOB_STATUSES),
        )
        .scalar()
    )

    history_jobs = (
        db.query(PrintJob)
        .filter(
            PrintJob.restaurante_id == rest_id,
            PrintJob.created_at >= day_start,
            PrintJob.created_at < day_end,
            PrintJob.status.in_(TERMINAL_JOB_STATUSES),
        )
        .order_by(PrintJob.created_at.desc())
        .limit(limit)
        .all()
    )
    compatibility_jobs = (
        db.query(PrintJob)
        .filter(
            PrintJob.restaurante_id == rest_id,
            PrintJob.created_at >= day_start,
            PrintJob.created_at < day_end,
        )
        .order_by(PrintJob.created_at.desc())
        .limit(limit)
        .all()
    )
    queue_jobs = (
        db.query(PrintJob)
        .filter(
            PrintJob.restaurante_id == rest_id,
            PrintJob.status.in_(
                (*UNRESOLVED_JOB_STATUSES, "failed")
            ),
        )
        .order_by(PrintJob.created_at.asc(), PrintJob.id.asc())
        .limit(PRINT_QUEUE_VISIBLE_LIMIT)
        .all()
    )
    latest_spooler_success = (
        db.query(PrintJob)
        .filter(
            PrintJob.restaurante_id == rest_id,
            PrintJob.status == "printed",
            PrintJob.created_at >= day_start,
            PrintJob.created_at < day_end,
        )
        .order_by(
            PrintJob.printed_at.desc().nullslast(),
            PrintJob.created_at.desc(),
        )
        .first()
    )

    agent_payload = []
    expired_command = False
    for agent in agents:
        expired_command = (
            _expire_stale_agent_command(agent, now)
            or expired_command
        )
        last_seen = _as_utc(agent.last_seen_at)
        printer_state = _agent_printer_state(agent, now)
        is_online = printer_state["online"]
        agent_payload.append(
            {
                "agent_id": agent.agent_id,
                "online": is_online,
                "last_seen_at": last_seen.isoformat() if last_seen else None,
                "seconds_since_heartbeat": _age_seconds(last_seen, now),
                "diagnostics_fresh": printer_state["diagnostics_fresh"],
                "diagnostics_age_seconds": printer_state[
                    "diagnostics_age_seconds"
                ],
                "physical_printer_present": printer_state[
                    "physical_printer_present"
                ],
                "printer_ready": printer_state["printer_ready"],
                "ready_printer_count": printer_state[
                    "ready_printer_count"
                ],
                "supports_usb_commands": printer_state[
                    "supports_usb_commands"
                ],
                "printer_diagnostics": agent.printer_diagnostics,
                "diagnostics_updated_at": (
                    _as_utc(agent.diagnostics_updated_at).isoformat()
                    if agent.diagnostics_updated_at
                    else None
                ),
                "pending_command": agent.pending_command,
                "command_requested_at": (
                    _as_utc(agent.command_requested_at).isoformat()
                    if agent.command_requested_at
                    else None
                ),
                "last_command_result": agent.last_command_result,
                "command_completed_at": (
                    _as_utc(agent.command_completed_at).isoformat()
                    if agent.command_completed_at
                    else None
                ),
            }
        )
    if expired_command:
        db.commit()

    def serialize_job(job: PrintJob) -> dict:
        created_at = _as_utc(job.created_at)
        claimed_at = _as_utc(job.claimed_at)
        printed_at = _as_utc(job.printed_at)
        age_seconds = _age_seconds(created_at, now)
        is_delayed = bool(
            job.status in UNRESOLVED_JOB_STATUSES
            and age_seconds is not None
            and age_seconds >= PRINT_DELAY_THRESHOLD_SECONDS
        )
        accepted_by_spooler = job.status == "printed"
        reference = _print_job_reference(job)

        return {
                "id": job.id,
                "document_type": job.document_type,
                "destination": job.destination,
                "source_type": job.source_type,
                "source_id": job.source_id,
                "reference": reference["label"],
                "order_number": reference["order_number"],
                "table_number": reference["table_number"],
                "status": job.status,
                "display_status": (
                    "spooler_accepted"
                    if accepted_by_spooler
                    else "expired"
                    if (
                        job.status == "cancelled"
                        and (job.last_error or "").startswith("Expirado")
                    )
                    else job.status
                ),
                "accepted_by_spooler": accepted_by_spooler,
                "physical_confirmation": (
                    "not_available" if accepted_by_spooler else None
                ),
                "attempts": job.attempts,
                "agent_id": job.agent_id,
                "printer_name": job.printer_name,
                "last_error": job.last_error,
                "created_at": created_at.isoformat() if created_at else None,
                "claimed_at": claimed_at.isoformat() if claimed_at else None,
                "printed_at": printed_at.isoformat() if printed_at else None,
                "age_seconds": age_seconds,
                "delayed": is_delayed,
                "is_reprint": str(job.idempotency_key).startswith("reprint:"),
                "can_reprint": job.status in {
                    "printed",
                    "spooler_accepted",
                    "failed",
                    "cancelled",
                } and bool(job.payload_text),
            }

    job_payload = [serialize_job(job) for job in compatibility_jobs]
    history_payload = [serialize_job(job) for job in history_jobs]
    queue_payload = [serialize_job(job) for job in queue_jobs]

    latest_success_payload = None
    if latest_spooler_success:
        latest_printed_at = _as_utc(latest_spooler_success.printed_at)
        latest_reference = _print_job_reference(latest_spooler_success)
        latest_success_payload = {
            "job_id": latest_spooler_success.id,
            "reference": latest_reference["label"],
            "printer_name": latest_spooler_success.printer_name,
            "printed_at": (
                latest_printed_at.isoformat()
                if latest_printed_at
                else None
            ),
            "age_seconds": _age_seconds(latest_printed_at, now),
        }

    return {
        "generated_at": now.isoformat(),
        "history_date": history_date,
        "history_limit": PRINT_HISTORY_VISIBLE_LIMIT,
        "queue_limit": PRINT_QUEUE_VISIBLE_LIMIT,
        "history_timezone": str(PRINT_HISTORY_TIMEZONE),
        "online_threshold_seconds": AGENT_ONLINE_THRESHOLD_SECONDS,
        "command_timeout_seconds": AGENT_COMMAND_TIMEOUT_SECONDS,
        "delay_threshold_seconds": PRINT_DELAY_THRESHOLD_SECONDS,
        "max_unresolved_age_seconds": PRINT_JOB_MAX_UNRESOLVED_AGE_SECONDS,
        "expired_jobs": expired_jobs,
        "physical_completion_tracking": False,
        "agents": agent_payload,
        "latest_spooler_success": latest_success_payload,
        "summary": {
            "online_agents": sum(
                1 for agent in agent_payload if agent["online"]
            ),
            "active_agents": len(agent_payload),
            "ready_printers": sum(
                agent["ready_printer_count"]
                for agent in agent_payload
            ),
            "printer_ready": any(
                agent["printer_ready"]
                for agent in agent_payload
            ),
            "pending": status_counts.get("pending", 0),
            "claimed": status_counts.get("claimed", 0),
            "printing": status_counts.get("printing", 0),
            "failed": failed_today,
            "delayed": delayed_count,
            "oldest_unresolved_seconds": _age_seconds(
                oldest_unresolved,
                now,
            ),
        },
        "jobs": job_payload,
        "history_jobs": history_payload,
        "queue_jobs": queue_payload,
    }


@router.post(
    "/actions/connect-usb",
    summary="Pedir ao agente local para conectar uma impressora USB",
)
def request_usb_printer_connection(
    req: ConnectUsbPrinterRequest,
    background_tasks: BackgroundTasks,
    current_user: Usuario = Depends(
        require_permission("impressao:administrar")
    ),
    db: Session = Depends(get_db),
):
    """
    Enfileira um comando curto para o serviço local já pareado.

    O navegador não toca no USB nem no Spooler. O Kôma Print recebe o comando
    no heartbeat, procura somente hardware USB físico e executa a configuração
    local com o adaptador da plataforma.
    """
    rest_id = (
        current_restaurante_id.get()
        or getattr(current_user, "restaurante_id", None)
    )
    if not rest_id:
        raise HTTPException(
            status_code=400,
            detail="Restaurante não selecionado",
        )

    query = db.query(PrintAgentToken).filter(
        PrintAgentToken.restaurante_id == rest_id,
        PrintAgentToken.ativo == True,
    )
    if req.agent_id:
        query = query.filter(
            PrintAgentToken.agent_id == req.agent_id.strip()
        )
    agent = query.order_by(
        PrintAgentToken.last_seen_at.desc()
    ).first()
    if not agent:
        raise HTTPException(
            status_code=404,
            detail=(
                "A impressão não está configurada neste computador. "
                "Contate o suporte para concluir a preparação inicial."
            ),
        )

    now = datetime.datetime.now(datetime.timezone.utc)
    printer_state = _agent_printer_state(agent, now)
    if not printer_state["online"]:
        raise HTTPException(
            status_code=409,
            detail=(
                "A impressão está temporariamente indisponível neste "
                "computador. Tente novamente."
            ),
        )
    if not printer_state["supports_usb_commands"]:
        raise HTTPException(
            status_code=409,
            detail=(
                "Não foi possível preparar a conexão USB neste computador. "
                "Tente novamente; se continuar, contate o suporte."
            ),
        )

    _expire_stale_agent_command(agent, now)
    pending_age = _age_seconds(agent.command_requested_at, now)
    if (
        isinstance(agent.pending_command, Mapping)
        and pending_age is not None
        and pending_age <= AGENT_COMMAND_TIMEOUT_SECONDS
    ):
        raise HTTPException(
            status_code=409,
            detail="Este computador já está procurando uma impressora USB.",
        )

    command_id = f"usb_{secrets.token_urlsafe(12)}"
    command = {
        "id": command_id,
        "action": "connect_usb",
        "printer_name": (req.printer_name or "").strip() or None,
        "printer_uri": (req.printer_uri or "").strip() or None,
        "requested_at": now.isoformat(),
    }
    agent.pending_command = command
    agent.command_requested_at = now
    agent.last_command_result = None
    agent.command_completed_at = None
    db.commit()
    _schedule_print_monitor_refresh(background_tasks, rest_id)

    return {
        "status": "queued",
        "agent_id": agent.agent_id,
        "command": command,
    }


@router.post("/jobs/inject", summary="Injetar PrintJob manualmente (admin)")
def inject_print_job(
    req: InjectJobRequest,
    background_tasks: BackgroundTasks,
    current_user: Usuario = Depends(require_permission("impressao:administrar")),
    db: Session = Depends(get_db)
):
    """
    Enfileira um PrintJob manualmente para testes ou reimpressões administrativas.
    Requer autenticação de usuário (JWT). Apenas admin/gerente.

    O restaurante_id vem exclusivamente da sessão autenticada. O campo legado
    no body é aceito apenas quando coincide com o tenant do usuário.
    """
    from ..database import current_restaurante_id as _ctx_rid

    rest_id = (
        _ctx_rid.get()
        or getattr(current_user, "restaurante_id", None)
    )
    if not rest_id or not isinstance(rest_id, int) or rest_id <= 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "restaurante_id não pôde ser determinado a partir da sessão autenticada."
            )
        )
    if req.restaurante_id is not None and req.restaurante_id != rest_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Não é permitido injetar impressão em outro restaurante."
        )

    is_test_print = (
        req.source_type.strip().casefold().startswith("teste")
        or "TESTE REAL DO KÔMA PRINT" in req.payload_text.upper()
    )
    if is_test_print and not _restaurant_has_ready_printer(
        db,
        rest_id,
        datetime.datetime.now(datetime.timezone.utc),
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Teste não enviado: nenhuma impressora física está "
                "conectada e pronta."
            ),
        )

    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S%f")
    ikey = req.idempotency_key or f"inject:{req.source_type}:{req.source_id}:{ts}"

    # PostgreSQL TEXT columns reject null bytes (\x00). Encode them as the
    # literal two-character sequence \x00 so the agent can decode them back.
    safe_payload = req.payload_text.replace("\x00", "\\x00")

    job = PrintJob(
        restaurante_id=rest_id,
        document_type=req.document_type.lower(),
        destination=req.destination.upper(),
        source_type=req.source_type.lower(),
        source_id=str(req.source_id),
        payload_text=safe_payload,
        status="pending",
        idempotency_key=ikey,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    _schedule_print_monitor_refresh(background_tasks, rest_id)

    return {
        "status": "enqueued",
        "job_id": job.id,
        "idempotency_key": ikey,
        "restaurante_id": rest_id,
    }

@router.post("/register")
def register_agent(
    req: RegisterAgentRequest,
    current_user: Usuario = Depends(require_permission("impressao:administrar")),
    db: Session = Depends(get_db)
):
    """
    Registra um novo agente para o restaurante do usuário logado.
    Retorna o token_hash puro APENAS UMA VEZ.
    """
    rest_id = current_restaurante_id.get()
    if not rest_id:
        raise HTTPException(status_code=400, detail="Restaurante não selecionado")

    agent_id_clean = req.agent_id.strip()
    if not agent_id_clean:
        raise HTTPException(status_code=400, detail="agent_id é obrigatório")

    raw_token = f"koma_ag_{secrets.token_urlsafe(32)}"
    token_h = hash_token(raw_token)

    existing = db.query(PrintAgentToken).filter(
        PrintAgentToken.restaurante_id == rest_id,
        PrintAgentToken.agent_id == agent_id_clean
    ).first()

    if existing:
        existing.token_hash = token_h
        existing.ativo = True
        existing.created_at = datetime.datetime.now(datetime.timezone.utc)
    else:
        new_token = PrintAgentToken(
            restaurante_id=rest_id,
            agent_id=agent_id_clean,
            token_hash=token_h,
            ativo=True
        )
        db.add(new_token)

    db.commit()

    return {
        "status": "registered",
        "agent_id": agent_id_clean,
        "restaurante_id": rest_id,
        "agent_token": raw_token
    }

@router.post("/heartbeat")
def agent_heartbeat(
    background_tasks: BackgroundTasks,
    req: Optional[HeartbeatRequest] = None,
    agent: PrintAgentToken = Depends(get_current_agent),
    db: Session = Depends(get_db),
):
    """Heartbeat enviado periodicamente pelo agente local."""
    now = datetime.datetime.now(datetime.timezone.utc)
    previous_heartbeat_age = _age_seconds(agent.last_seen_at, now)
    presence_changed = (
        previous_heartbeat_age is None
        or previous_heartbeat_age > AGENT_ONLINE_THRESHOLD_SECONDS
    )
    diagnostics_changed = False
    agent.last_seen_at = now
    if req and req.diagnostics:
        diagnostics = req.diagnostics.model_dump()
        previous_diagnostics = (
            dict(agent.printer_diagnostics)
            if isinstance(agent.printer_diagnostics, Mapping)
            else None
        )
        diagnostics_changed = previous_diagnostics != diagnostics
        agent.printer_diagnostics = diagnostics
        agent.diagnostics_updated_at = now

    command = (
        dict(agent.pending_command)
        if isinstance(agent.pending_command, Mapping)
        else None
    )
    if _expire_stale_agent_command(agent, now):
        command = None
    db.commit()
    if presence_changed or diagnostics_changed:
        _schedule_print_monitor_refresh(
            background_tasks,
            agent.restaurante_id,
        )
    return {
        "status": "ok",
        "agent_id": agent.agent_id,
        "restaurante_id": agent.restaurante_id,
        "timestamp": now.isoformat(),
        "command": command,
    }


@router.post(
    "/actions/{command_id}/complete",
    summary="Confirmar comando local do agente de impressão",
)
def complete_agent_command(
    command_id: str,
    req: CompleteAgentCommandRequest,
    background_tasks: BackgroundTasks,
    agent: PrintAgentToken = Depends(get_current_agent),
    db: Session = Depends(get_db),
):
    """Registra o resultado idempotente da tentativa de conexão USB."""
    now = datetime.datetime.now(datetime.timezone.utc)
    pending = (
        dict(agent.pending_command)
        if isinstance(agent.pending_command, Mapping)
        else None
    )
    previous = (
        dict(agent.last_command_result)
        if isinstance(agent.last_command_result, Mapping)
        else None
    )
    if not pending or pending.get("id") != command_id:
        if previous and previous.get("id") == command_id:
            return {
                "status": "already_completed",
                "command_id": command_id,
            }
        raise HTTPException(
            status_code=409,
            detail="O comando não está mais pendente para este computador.",
        )

    result = {
        "id": command_id,
        "success": req.success,
        "code": req.code,
        "message": req.message,
        "printer_name": req.printer_name,
        "completed_at": now.isoformat(),
    }
    agent.last_command_result = result
    agent.command_completed_at = now
    agent.pending_command = None
    agent.command_requested_at = None
    agent.last_seen_at = now
    if req.diagnostics:
        agent.printer_diagnostics = req.diagnostics.model_dump()
        agent.diagnostics_updated_at = now
    db.commit()
    _schedule_print_monitor_refresh(
        background_tasks,
        agent.restaurante_id,
    )
    return {
        "status": "completed",
        "command_id": command_id,
        "result": result,
    }


@router.get("/jobs/next")
def get_next_job(
    agent: PrintAgentToken = Depends(get_current_agent),
    db: Session = Depends(get_db)
):
    """
    Retorna o próximo job pendente na fila do restaurante do agente.
    Libera automaticamente jobs travados em 'claimed' há mais de 5 minutos.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    if not _agent_printer_state(agent, now)["printer_ready"]:
        return None

    # Compatibilidade com agentes antigos. Agentes novos usam /jobs/claim-next,
    # que busca e reserva o trabalho na mesma chamada.
    expired_jobs = _expire_stale_unresolved_jobs(
        db,
        agent.restaurante_id,
        now,
    )
    released_jobs = _release_stuck_jobs(db, agent.restaurante_id, now)
    if expired_jobs or released_jobs:
        db.commit()

    job = db.query(PrintJob).filter(
        PrintJob.restaurante_id == agent.restaurante_id,
        PrintJob.status == "pending"
    ).order_by(PrintJob.created_at.asc()).first()

    if not job:
        return None

    return {
        "id": job.id,
        "restaurante_id": job.restaurante_id,
        "document_type": job.document_type,
        "destination": job.destination,
        "source_type": job.source_type,
        "source_id": job.source_id,
        "payload_text": job.payload_text,
        "attempts": job.attempts,
        "idempotency_key": job.idempotency_key,
        "created_at": job.created_at.isoformat() if job.created_at else None
    }


@router.post("/jobs/claim-next")
def claim_next_job(
    agent: PrintAgentToken = Depends(get_current_agent),
    db: Session = Depends(get_db),
):
    """
    Busca e reserva o próximo job em uma única chamada.

    No PostgreSQL, ``FOR UPDATE SKIP LOCKED`` garante que agentes concorrentes
    nunca recebam o mesmo trabalho. O endpoint antigo em duas etapas permanece
    disponível para instalações que ainda não atualizaram o agente.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    if not _agent_printer_state(agent, now)["printer_ready"]:
        return None

    claimed_jobs = _claim_pending_jobs(db, agent, now, limit=1)
    return claimed_jobs[0] if claimed_jobs else None


@router.post("/jobs/claim-batch")
def claim_job_batch(
    limit: int = Query(default=10, ge=1, le=MAX_CLAIM_BATCH_SIZE),
    agent: PrintAgentToken = Depends(get_current_agent),
    db: Session = Depends(get_db),
):
    """
    Reserva um pequeno lote FIFO em uma única ida à nuvem.

    Os cupons continuam sendo enviados sequencialmente ao CUPS para manter a
    ordem da impressora; o lote elimina apenas a espera de rede entre eles.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    if not _agent_printer_state(agent, now)["printer_ready"]:
        return []
    return _claim_pending_jobs(db, agent, now, limit=limit)


@router.post("/jobs/{job_id}/claim")
def claim_job(
    job_id: str,
    agent: PrintAgentToken = Depends(get_current_agent),
    db: Session = Depends(get_db)
):
    """
    Realiza o claim 100% atômico de um job pendente pelo agente logado.
    Garante que dois agentes concorrentes NUNCA assumam o mesmo job.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    if not _agent_printer_state(agent, now)["printer_ready"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Impressora física indisponível; o trabalho permanecerá "
                "na fila."
            ),
        )

    expired_jobs = _expire_stale_unresolved_jobs(
        db,
        agent.restaurante_id,
        now,
    )
    if expired_jobs:
        db.commit()

    # UPDATE atômico condicional — retorna o número de linhas realmente alteradas
    rows_updated = db.query(PrintJob).filter(
        PrintJob.id == job_id,
        PrintJob.restaurante_id == agent.restaurante_id,
        PrintJob.status == "pending"
    ).update({
        "status": "claimed",
        "claimed_at": now,
        "agent_id": agent.agent_id
    }, synchronize_session=False)
    db.commit()

    if rows_updated == 0:
        existing = db.query(PrintJob).filter(
            PrintJob.id == job_id,
            PrintJob.restaurante_id == agent.restaurante_id
        ).first()

        if not existing:
            raise HTTPException(status_code=404, detail="Job de impressão não encontrado")
        
        # Se o job já foi reservado por ESTE MESMO AGENTE, aceita o claim como sucesso (200 OK)
        if existing.agent_id == agent.agent_id:
            return {
                "id": existing.id,
                "restaurante_id": existing.restaurante_id,
                "document_type": existing.document_type,
                "destination": existing.destination,
                "source_type": existing.source_type,
                "source_id": existing.source_id,
                "payload_text": existing.payload_text,
                "idempotency_key": existing.idempotency_key
            }

        raise HTTPException(
            status_code=409,
            detail=f"Job já foi assumido por outro agente ('{existing.agent_id}') ou não está pendente (status: '{existing.status}')"
        )

    job = db.query(PrintJob).filter(
        PrintJob.id == job_id,
        PrintJob.restaurante_id == agent.restaurante_id,
    ).first()

    return {
        "id": job.id,
        "restaurante_id": job.restaurante_id,
        "document_type": job.document_type,
        "destination": job.destination,
        "source_type": job.source_type,
        "source_id": job.source_id,
        "payload_text": job.payload_text,
        "idempotency_key": job.idempotency_key
    }

@router.post("/jobs/complete-batch")
def complete_job_batch(
    req: CompleteJobsRequest,
    background_tasks: BackgroundTasks,
    agent: PrintAgentToken = Depends(get_current_agent),
    db: Session = Depends(get_db),
):
    """Confirma vários trabalhos enviados ao spooler em uma única chamada."""
    requested_items = {
        item.job_id: item
        for item in req.jobs
    }
    jobs = (
        db.query(PrintJob)
        .filter(
            PrintJob.restaurante_id == agent.restaurante_id,
            PrintJob.id.in_(requested_items),
        )
        .all()
    )
    jobs_by_id = {job.id: job for job in jobs}
    now = datetime.datetime.now(datetime.timezone.utc)
    confirmed_job_ids: list[str] = []
    rejected_job_ids: list[str] = []
    changed = False

    for job_id, item in requested_items.items():
        job = jobs_by_id.get(job_id)
        if (
            not job
            or job.agent_id != agent.agent_id
            or job.status not in ("claimed", "printing", "printed")
        ):
            rejected_job_ids.append(job_id)
            continue
        if job.status != "printed":
            job.status = "printed"
            job.printed_at = now
            job.printer_name = item.printer_name or "Padrão"
            changed = True
        confirmed_job_ids.append(job_id)

    db.commit()
    if confirmed_job_ids:
        _schedule_print_monitor_refresh(
            background_tasks,
            agent.restaurante_id,
        )
    if changed:
        _schedule_print_history_maintenance(
            background_tasks,
            agent.restaurante_id,
            now,
        )

    return {
        "status": "processed",
        "confirmed_job_ids": confirmed_job_ids,
        "rejected_job_ids": rejected_job_ids,
    }


@router.post("/jobs/release-batch")
def release_job_batch(
    req: ReleaseJobsRequest,
    agent: PrintAgentToken = Depends(get_current_agent),
    db: Session = Depends(get_db),
):
    """
    Devolve ao estado pendente trabalhos ainda não enviados ao CUPS.

    É usado quando a impressora some no meio de um lote; esses trabalhos não
    consomem tentativa e permanecem íntegros para o próximo ciclo.
    """
    requested_ids = list(dict.fromkeys(req.job_ids))
    jobs = (
        db.query(PrintJob)
        .filter(
            PrintJob.restaurante_id == agent.restaurante_id,
            PrintJob.id.in_(requested_ids),
            PrintJob.agent_id == agent.agent_id,
            PrintJob.status == "claimed",
        )
        .all()
    )
    released_ids = []
    for job in jobs:
        job.status = "pending"
        job.claimed_at = None
        job.agent_id = None
        released_ids.append(job.id)
    db.commit()
    return {
        "status": "released",
        "released_job_ids": released_ids,
    }


@router.post("/jobs/{job_id}/complete")
def complete_job(
    job_id: str,
    req: CompleteJobRequest,
    background_tasks: BackgroundTasks,
    agent: PrintAgentToken = Depends(get_current_agent),
    db: Session = Depends(get_db)
):
    """
    Confirma a impressão bem-sucedida pelo agente que assumiu o job.

    Uma repetição da confirmação pelo mesmo agente é idempotente. Isso cobre o
    caso em que o servidor gravou o sucesso, mas a resposta HTTP se perdeu.
    """
    job = db.query(PrintJob).filter(
        PrintJob.id == job_id,
        PrintJob.restaurante_id == agent.restaurante_id
    ).first()

    if not job:
        raise HTTPException(status_code=404, detail="Job de impressão não encontrado")

    if job.agent_id != agent.agent_id:
        raise HTTPException(
            status_code=403,
            detail="Operação negada: o job foi assumido por outro agente"
        )

    if job.status == "printed":
        return {"status": "printed", "job_id": job.id}

    if job.status not in ("claimed", "printing"):
        raise HTTPException(
            status_code=400,
            detail=f"Job não está em estado para ser completado (status atual: '{job.status}')"
        )

    now = datetime.datetime.now(datetime.timezone.utc)
    job.status = "printed"
    job.printed_at = now
    job.printer_name = req.printer_name or "Padrão"
    db.commit()
    _schedule_print_monitor_refresh(
        background_tasks,
        agent.restaurante_id,
    )
    _schedule_print_history_maintenance(
        background_tasks,
        agent.restaurante_id,
        now,
    )

    return {"status": "printed", "job_id": job.id}

@router.post("/jobs/{job_id}/fail")
def fail_job(
    job_id: str,
    req: FailJobRequest,
    background_tasks: BackgroundTasks,
    agent: PrintAgentToken = Depends(get_current_agent),
    db: Session = Depends(get_db)
):
    """
    Registra falha de impressão enviada pelo agente.
    Se o limite de tentativas for atingido, marca como 'failed'. Caso contrário, volta a 'pending'.
    """
    job = db.query(PrintJob).filter(
        PrintJob.id == job_id,
        PrintJob.restaurante_id == agent.restaurante_id
    ).first()

    if not job:
        raise HTTPException(status_code=404, detail="Job de impressão não encontrado")

    if job.agent_id != agent.agent_id:
        raise HTTPException(
            status_code=403,
            detail="Operação negada: o job pertence a outro agente"
        )

    job.attempts += 1
    job.last_error = req.error[:500] if req.error else "Erro desconhecido"

    if job.attempts >= MAX_ATTEMPTS:
        job.status = "failed"
    else:
        # Libera para tentativa futura
        job.status = "pending"
        job.claimed_at = None
        job.agent_id = None

    db.commit()
    _schedule_print_monitor_refresh(
        background_tasks,
        agent.restaurante_id,
    )
    if job.status == "failed":
        _schedule_print_history_maintenance(
            background_tasks,
            agent.restaurante_id,
            datetime.datetime.now(datetime.timezone.utc),
        )

    return {
        "status": job.status,
        "job_id": job.id,
        "attempts": job.attempts,
        "max_attempts": MAX_ATTEMPTS
    }

@router.post("/jobs/retry-batch")
def retry_failed_jobs(
    req: RetryJobsRequest,
    background_tasks: BackgroundTasks,
    current_user: Usuario = Depends(
        require_permission("impressao:administrar")
    ),
    db: Session = Depends(get_db),
):
    """Recupera falhas usando os jobs originais, sem duplicar payloads."""
    rest_id = (
        current_restaurante_id.get()
        or getattr(current_user, "restaurante_id", None)
    )
    unique_ids = list(dict.fromkeys(req.job_ids))
    failed_jobs = (
        db.query(PrintJob)
        .filter(
            PrintJob.restaurante_id == rest_id,
            PrintJob.id.in_(unique_ids),
            PrintJob.status == "failed",
            PrintJob.payload_text != "",
        )
        .with_for_update()
        .all()
    )
    for job in failed_jobs:
        job.status = "pending"
        job.attempts = 0
        job.agent_id = None
        job.printer_name = None
        job.claimed_at = None
        job.printed_at = None
        job.last_error = None
    db.commit()
    if failed_jobs:
        _schedule_print_monitor_refresh(background_tasks, rest_id)
    retried_ids = [job.id for job in failed_jobs]
    return {
        "status": "queued",
        "retried_job_ids": retried_ids,
        "ignored_job_ids": [
            job_id for job_id in unique_ids if job_id not in retried_ids
        ],
    }


@router.post("/jobs/{job_id}/reprint")
def request_reprint(
    job_id: str,
    background_tasks: BackgroundTasks,
    current_user: Usuario = Depends(require_permission("impressao:administrar")),
    db: Session = Depends(get_db)
):
    """
    Gera um novo PrintJob de reimpressão manual com idempotency_key nova.
    """
    rest_id = current_restaurante_id.get()
    original_job = db.query(PrintJob).filter(
        PrintJob.id == job_id,
        PrintJob.restaurante_id == rest_id
    ).first()

    if not original_job:
        raise HTTPException(status_code=404, detail="Job original não encontrado")
    if not original_job.payload_text:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=(
                "O conteúdo desta impressão já expirou da janela de "
                "reimpressão de hoje."
            ),
        )

    timestamp_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S%f")
    new_idempotency_key = f"reprint:{original_job.id}:{timestamp_str}"

    reprint_job = PrintJob(
        restaurante_id=rest_id,
        document_type=original_job.document_type,
        destination=original_job.destination,
        source_type=original_job.source_type,
        source_id=original_job.source_id,
        payload_text=original_job.payload_text,
        status="pending",
        idempotency_key=new_idempotency_key
    )

    db.add(reprint_job)
    db.commit()
    _schedule_print_monitor_refresh(background_tasks, rest_id)

    return {
        "status": "created",
        "new_job_id": reprint_job.id,
        "idempotency_key": new_idempotency_key
    }
