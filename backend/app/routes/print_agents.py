import hashlib
import secrets
import datetime
import re
from collections.abc import Mapping
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Header, Query, status
from pydantic import BaseModel
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from ..database import bind_session_to_tenant, get_db, current_restaurante_id
from ..models import PrintJob, PrintAgentToken, Usuario
from ..security import require_permission

router = APIRouter(prefix="/api/print-agents", tags=["Print Agents"])

MAX_ATTEMPTS = 3
AGENT_ONLINE_THRESHOLD_SECONDS = 90
PRINT_DELAY_THRESHOLD_SECONDS = 120
UNRESOLVED_JOB_STATUSES = ("pending", "claimed", "printing")
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


def _age_seconds(
    value: Optional[datetime.datetime],
    now: datetime.datetime,
) -> Optional[int]:
    normalized = _as_utc(value)
    if normalized is None:
        return None
    return max(0, round((now - normalized).total_seconds()))


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
        candidate = db.query(PrintAgentToken).filter(
            PrintAgentToken.token_hash == computed_hash,
            PrintAgentToken.ativo == True,
        ).first()
        identity = (
            {"id": candidate.id, "restaurante_id": candidate.restaurante_id}
            if candidate
            else None
        )

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

class FailJobRequest(BaseModel):
    error: str

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
    limit: int = Query(default=20, ge=1, le=50),
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
    online_cutoff = now - datetime.timedelta(
        seconds=AGENT_ONLINE_THRESHOLD_SECONDS
    )
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
        .filter(PrintJob.restaurante_id == rest_id)
        .group_by(PrintJob.status)
        .all()
    )
    status_counts = {job_status: count for job_status, count in status_rows}

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

    jobs = (
        db.query(PrintJob)
        .filter(PrintJob.restaurante_id == rest_id)
        .order_by(PrintJob.created_at.desc())
        .limit(limit)
        .all()
    )
    latest_spooler_success = (
        db.query(PrintJob)
        .filter(
            PrintJob.restaurante_id == rest_id,
            PrintJob.status == "printed",
        )
        .order_by(
            PrintJob.printed_at.desc().nullslast(),
            PrintJob.created_at.desc(),
        )
        .first()
    )

    agent_payload = []
    for agent in agents:
        last_seen = _as_utc(agent.last_seen_at)
        is_online = bool(last_seen and last_seen >= online_cutoff)
        agent_payload.append(
            {
                "agent_id": agent.agent_id,
                "online": is_online,
                "last_seen_at": last_seen.isoformat() if last_seen else None,
                "seconds_since_heartbeat": _age_seconds(last_seen, now),
            }
        )

    job_payload = []
    for job in jobs:
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

        job_payload.append(
            {
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
                    "spooler_accepted" if accepted_by_spooler else job.status
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
                    "failed",
                    "cancelled",
                },
            }
        )

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
        "online_threshold_seconds": AGENT_ONLINE_THRESHOLD_SECONDS,
        "delay_threshold_seconds": PRINT_DELAY_THRESHOLD_SECONDS,
        "physical_completion_tracking": False,
        "agents": agent_payload,
        "latest_spooler_success": latest_success_payload,
        "summary": {
            "online_agents": sum(
                1 for agent in agent_payload if agent["online"]
            ),
            "active_agents": len(agent_payload),
            "pending": status_counts.get("pending", 0),
            "claimed": status_counts.get("claimed", 0),
            "printing": status_counts.get("printing", 0),
            "failed": status_counts.get("failed", 0),
            "delayed": delayed_count,
            "oldest_unresolved_seconds": _age_seconds(
                oldest_unresolved,
                now,
            ),
        },
        "jobs": job_payload,
    }


@router.post("/jobs/inject", summary="Injetar PrintJob manualmente (admin)")
def inject_print_job(
    req: InjectJobRequest,
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
    agent: PrintAgentToken = Depends(get_current_agent),
    db: Session = Depends(get_db),
):
    """Heartbeat enviado periodicamente pelo agente local."""
    now = datetime.datetime.now(datetime.timezone.utc)
    agent.last_seen_at = now
    db.commit()
    return {
        "status": "ok",
        "agent_id": agent.agent_id,
        "restaurante_id": agent.restaurante_id,
        "timestamp": now.isoformat()
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
    # Compatibilidade com agentes antigos. Agentes novos usam /jobs/claim-next,
    # que busca e reserva o trabalho na mesma chamada.
    released_jobs = _release_stuck_jobs(db, agent.restaurante_id, now)
    if released_jobs:
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
    _release_stuck_jobs(db, agent.restaurante_id, now)

    if db.get_bind().dialect.name == "postgresql":
        claimed = db.execute(
            text(
                """
                UPDATE print_jobs AS target
                SET
                    status = 'claimed',
                    claimed_at = :claimed_at,
                    agent_id = :agent_id
                WHERE target.id = (
                    SELECT candidate.id
                    FROM print_jobs AS candidate
                    WHERE candidate.restaurante_id = :restaurante_id
                      AND candidate.status = 'pending'
                    ORDER BY candidate.created_at ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
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
            },
        ).mappings().first()
        if not claimed:
            db.commit()
            return None
        payload = _claimed_job_payload(claimed, now)
        db.commit()
        return payload

    # SQLite é usado somente nos testes e no desenvolvimento local. O UPDATE
    # condicional preserva a mesma regra anti-duplicação sem depender de
    # FOR UPDATE SKIP LOCKED.
    while True:
        candidate = db.query(PrintJob.id).filter(
            PrintJob.restaurante_id == agent.restaurante_id,
            PrintJob.status == "pending",
        ).order_by(PrintJob.created_at.asc()).first()
        if not candidate:
            db.commit()
            return None

        rows_updated = db.query(PrintJob).filter(
            PrintJob.id == candidate[0],
            PrintJob.restaurante_id == agent.restaurante_id,
            PrintJob.status == "pending",
        ).update(
            {
                "status": "claimed",
                "claimed_at": now,
                "agent_id": agent.agent_id,
            },
            synchronize_session=False,
        )
        if rows_updated:
            job = db.query(PrintJob).filter(
                PrintJob.id == candidate[0],
                PrintJob.restaurante_id == agent.restaurante_id,
            ).first()
            payload = _claimed_job_payload(job, now)
            db.commit()
            return payload
        db.rollback()


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

    job = db.query(PrintJob).filter(PrintJob.id == job_id).first()

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

@router.post("/jobs/{job_id}/complete")
def complete_job(
    job_id: str,
    req: CompleteJobRequest,
    agent: PrintAgentToken = Depends(get_current_agent),
    db: Session = Depends(get_db)
):
    """
    Confirma a impressão bem-sucedida pelo agente que assumiu o job.
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

    if job.status not in ("claimed", "printing"):
        raise HTTPException(
            status_code=400,
            detail=f"Job não está em estado para ser completado (status atual: '{job.status}')"
        )

    job.status = "printed"
    job.printed_at = datetime.datetime.now(datetime.timezone.utc)
    job.printer_name = req.printer_name or "Padrão"
    db.commit()

    return {"status": "printed", "job_id": job.id}

@router.post("/jobs/{job_id}/fail")
def fail_job(
    job_id: str,
    req: FailJobRequest,
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

    return {
        "status": job.status,
        "job_id": job.id,
        "attempts": job.attempts,
        "max_attempts": MAX_ATTEMPTS
    }

@router.post("/jobs/{job_id}/reprint")
def request_reprint(
    job_id: str,
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

    return {
        "status": "created",
        "new_job_id": reprint_job.id,
        "idempotency_key": new_idempotency_key
    }
