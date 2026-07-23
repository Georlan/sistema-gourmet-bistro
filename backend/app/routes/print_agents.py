import hashlib
import secrets
import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Header, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..database import bind_session_to_tenant, get_db, current_restaurante_id
from ..models import PrintJob, PrintAgentToken, Usuario
from ..security import get_current_user

router = APIRouter(prefix="/api/print-agents", tags=["Print Agents"])

MAX_ATTEMPTS = 3

def hash_token(token: str) -> str:
    """Gera hash SHA-256 seguro para o token do agente."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

def get_current_agent(
    x_agent_token: Optional[str] = Header(None, alias="X-Agent-Token"),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
) -> PrintAgentToken:
    """
    Dependency de autenticação do Agent Token.
    Extrai o token do cabeçalho 'X-Agent-Token' ou 'Authorization: Bearer <token>'.
    Valida o hash no banco e atualiza o 'last_seen_at'.
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

        # Atualiza o visto por último (heartbeat implícito)
        agent_record.last_seen_at = datetime.datetime.now(datetime.timezone.utc)
        db.commit()
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
    restaurante_id: Optional[int] = None  # override explícito; usa o do usuário se omitido
    document_type: str = "producao"
    destination: str = "COZINHA"
    source_type: str = "pedido"
    source_id: str = "manual"
    payload_text: str
    idempotency_key: Optional[str] = None

# --- ENDPOINTS ---

@router.post("/jobs/inject", summary="Injetar PrintJob manualmente (admin)")
def inject_print_job(
    req: InjectJobRequest,
    current_user: Usuario = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Enfileira um PrintJob manualmente para testes ou reimpressões administrativas.
    Requer autenticação de usuário (JWT). Apenas admin/gerente.

    O restaurante_id é resolvido na seguinte ordem de prioridade:
      1. req.restaurante_id (override explícito no body)
      2. current_restaurante_id ContextVar (definido pelo middleware de autenticação)
      3. current_user.restaurante_id (fallback para admins globais)
    """
    from ..database import current_restaurante_id as _ctx_rid

    # Resolve tenant com fallback em cascata
    rest_id = (
        req.restaurante_id
        or _ctx_rid.get()
        or getattr(current_user, "restaurante_id", None)
    )
    if not rest_id or not isinstance(rest_id, int) or rest_id <= 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "restaurante_id não pôde ser determinado. "
                "Passe-o explicitamente no body: {\"restaurante_id\": 1, ...}"
            )
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
    current_user: Usuario = Depends(get_current_user),
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
    agent: PrintAgentToken = Depends(get_current_agent)
):
    """Heartbeat enviado periodicamente pelo agente local."""
    return {
        "status": "ok",
        "agent_id": agent.agent_id,
        "restaurante_id": agent.restaurante_id,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
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
    stuck_cutoff = now - datetime.timedelta(minutes=5)

    # Libera jobs abandonados/travados
    db.query(PrintJob).filter(
        PrintJob.restaurante_id == agent.restaurante_id,
        PrintJob.status == "claimed",
        PrintJob.claimed_at < stuck_cutoff
    ).update({
        "status": "pending",
        "claimed_at": None,
        "agent_id": None
    }, synchronize_session=False)
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
        raise HTTPException(
            status_code=409,
            detail=f"Job já foi assumido por outro agente ou não está pendente (status: '{existing.status}')"
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
    current_user: Usuario = Depends(get_current_user),
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
