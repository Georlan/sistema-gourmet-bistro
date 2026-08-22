from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing import List
import uuid
import logging

from ..database import bind_session_to_tenant, get_db, current_restaurante_id
from ..models import Usuario
from ..schemas import LoginRequest, LoginResponse, UsuarioResponse, AtivarContaRequest
from ..security import (
    create_access_token,
    get_password_hash,
    require_permission,
    verify_password,
)
from ..services.staff_login_rate_limit import (
    clear_staff_login_failures,
    record_staff_login_failure,
    staff_login_is_blocked,
)
from ..websocket_manager import manager

logger = logging.getLogger("koma.auth")

router = APIRouter(
    prefix="/auth",
    tags=["Autenticação"]
)


def _client_ip(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",", 1)[0].strip()
    if forwarded:
        return forwarded
    return request.client.host if request.client else "unknown"


def _lookup_users_before_tenant(
    db: Session,
    identifier: str,
    restaurante_id: int | None = None,
):
    """Resolve candidatos mínimos antes de o RLS conhecer o restaurante.

    Um identificador pode pertencer legitimamente a contas de restaurantes
    diferentes. Por isso esta etapa nunca escolhe uma linha com ``LIMIT 1``:
    a senha (e, quando informado, o tenant) precisa produzir uma identidade
    inequívoca antes de vincular a sessão ao restaurante.
    """
    if db.get_bind().dialect.name == "postgresql":
        return db.execute(
            text(
                "SELECT id, restaurante_id, senha_hash "
                "FROM koma_internal.auth_user_candidates(:identifier, :restaurante_id)"
            ),
            {
                "identifier": identifier,
                "restaurante_id": restaurante_id,
            },
        ).mappings().all()
    # O fallback SQLite precisa ignorar o filtro ORM de tenant exatamente como
    # a função interna do PostgreSQL. Retorna somente os três campos mínimos.
    return db.execute(
        text(
            """
            SELECT id, restaurante_id, senha_hash
            FROM usuarios
            WHERE (
                    lower(coalesce(email, '')) = :identifier
                 OR lower(coalesce(telefone, '')) = :identifier
            )
              AND (:restaurante_id IS NULL OR restaurante_id = :restaurante_id)
            ORDER BY restaurante_id, id
            LIMIT 10
            """
        ),
        {
            "identifier": identifier,
            "restaurante_id": restaurante_id,
        },
    ).mappings().all()


def _select_login_identity(candidates, password: str):
    """Seleciona uma única conta pela senha sem assumir um tenant arbitrário."""
    matches = [
        candidate
        for candidate in candidates
        if candidate.get("senha_hash")
        and verify_password(password, candidate["senha_hash"])
    ]
    if not matches:
        return None
    if len(matches) > 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Este login está associado a mais de um restaurante. "
                "Selecione o estabelecimento para continuar."
            ),
        )
    return matches[0]


def _login_user_payload(usuario: Usuario) -> dict:
    """Contrato único de identidade retornado por login e ativação."""
    return {
        "id": usuario.id,
        "nome": usuario.nome,
        "usuario": usuario.usuario,
        "email": usuario.email,
        "telefone": usuario.telefone,
        "role": usuario.role,
        "cargo": getattr(usuario, "cargo", None) or usuario.role,
        "restaurante_id": usuario.restaurante_id,
        "status": usuario.status,
    }


def _lookup_invite_before_tenant(db: Session, token: str):
    if db.get_bind().dialect.name == "postgresql":
        return db.execute(
            text("SELECT id, restaurante_id FROM koma_internal.auth_invite(:token)"),
            {"token": token},
        ).mappings().first()
    return db.execute(
        text(
            """
            SELECT id, restaurante_id
            FROM usuarios
            WHERE token_convite = :token
            LIMIT 1
            """
        ),
        {"token": token},
    ).mappings().first()

@router.post("/login", response_model=LoginResponse)
def login(
    login_data: LoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Realiza a autenticação do usuário por e-mail ou telefone.
    Retorna o token JWT e as informações do usuário.
    """
    username_val = (login_data.username or "").strip().lower()
    client_ip = _client_ip(request)
    candidates = _lookup_users_before_tenant(
        db,
        username_val,
        login_data.restaurante_id,
    )
    candidate_restaurants = [candidate.get("restaurante_id") for candidate in candidates]

    if candidates and staff_login_is_blocked(
        db,
        candidate_restaurants,
        identifier=username_val,
        client_ip=client_ip,
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Muitas tentativas de login. Aguarde alguns minutos e tente novamente.",
        )

    identity = _select_login_identity(candidates, login_data.password)
    if not identity:
        blocked = False
        if candidates:
            blocked = record_staff_login_failure(
                db,
                candidate_restaurants,
                identifier=username_val,
                client_ip=client_ip,
            )
        if blocked:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Muitas tentativas de login. Aguarde alguns minutos e tente novamente.",
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário ou senha incorretos"
        )

    restaurante_id = identity["restaurante_id"]
    if not isinstance(restaurante_id, int) or restaurante_id <= 0:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário ou senha incorretos"
        )

    bind_session_to_tenant(db, restaurante_id)
    tenant_context = current_restaurante_id.set(restaurante_id)
    try:
        usuario = db.query(Usuario).filter(Usuario.id == identity["id"]).first()
    finally:
        current_restaurante_id.reset(tenant_context)
    if not usuario:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário ou senha incorretos"
        )

    status_val = str(usuario.status or "pendente_ativacao").lower().strip()
    if status_val != "ativo":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Conta de usuário pendente, inativa ou bloqueada.",
        )

    # Materializa o payload antes de limpar o bucket. O cleanup pode encerrar a
    # transação de leitura atual, então não mantemos dependência de atributos ORM
    # depois desse ponto.
    access_token = create_access_token(subject=usuario.id, restaurante_id=usuario.restaurante_id)
    user_data = _login_user_payload(usuario)

    clear_staff_login_failures(
        db,
        restaurante_id,
        identifier=username_val,
        client_ip=client_ip,
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "garcom": user_data,
        "usuario": user_data
    }


@router.post("/ativar", response_model=LoginResponse)
def ativar_conta(
    payload: AtivarContaRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Ativa a conta do usuário através do token_convite.
    Recebe email e senha, valida unicidade do e-mail, salva a senha e mude o status para 'ativo'.
    Retorna o token JWT e dados do usuário para login automático.
    """
    from datetime import datetime, timezone

    token_str = payload.token_convite.strip()
    email_clean = payload.email.strip().lower()

    if not email_clean or "@" not in email_clean:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Informe um e-mail válido para a conta."
        )

    now_utc = datetime.now(timezone.utc)

    identity = _lookup_invite_before_tenant(db, token_str)
    if not identity or not isinstance(identity["restaurante_id"], int):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link de ativação inválido ou expirado"
        )

    restaurante_id = identity["restaurante_id"]
    bind_session_to_tenant(db, restaurante_id)
    tenant_context = current_restaurante_id.set(restaurante_id)
    try:
        usuario = db.query(Usuario).filter(Usuario.id == identity["id"]).first()
    finally:
        current_restaurante_id.reset(tenant_context)

    if not usuario:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link de ativação inválido ou expirado"
        )

    if usuario.status != "pendente_ativacao":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Esta conta já foi ativada previamente."
        )

    if usuario.token_expira_em is not None:
        token_exp = usuario.token_expira_em
        if token_exp.tzinfo is None:
            token_exp = token_exp.replace(tzinfo=timezone.utc)
        if now_utc > token_exp:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Link de ativação inválido ou expirado"
            )

    # A sessão já está vinculada ao restaurante do convite; portanto esta
    # consulta valida duplicidade somente dentro do tenant correto.
    existente_email = db.query(Usuario).filter(Usuario.email == email_clean).first()
    if existente_email and existente_email.id != usuario.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este e-mail já está cadastrado neste estabelecimento."
        )

    usuario.email = email_clean
    usuario.senha_hash = get_password_hash(payload.senha)
    usuario.status = "ativo"
    usuario.token_convite = None
    usuario.token_expira_em = None

    try:
        db.commit()
        db.refresh(usuario)
    except IntegrityError as exc:
        db.rollback()
        logger.warning(
            "Conflito de integridade ao ativar usuário %s no restaurante %s: %s",
            identity["id"],
            restaurante_id,
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Não foi possível ativar a conta porque o e-mail ou telefone "
                "já está em uso neste estabelecimento."
            ),
        ) from exc

    background_tasks.add_task(
        manager.broadcast,
        {
            "event": "team_updated",
            "detail": {"action": "activated", "user_id": usuario.id},
        },
        restaurante_id=usuario.restaurante_id,
        target_audience="internal",
    )

    access_token = create_access_token(subject=usuario.id, restaurante_id=usuario.restaurante_id)
    user_data = _login_user_payload(usuario)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "garcom": user_data,
        "usuario": user_data
    }

@router.get("/usuarios", response_model=List[UsuarioResponse])
def get_usuarios(
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("equipe:administrar"))
):
    """Retorna todos os usuários cadastrados (garçons, caixas, admins)."""
    return db.query(Usuario).filter(
        Usuario.restaurante_id == current_user.restaurante_id
    ).all()

@router.delete("/usuarios/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_usuario(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("equipe:administrar"))
):
    """Deleta um usuário do sistema."""
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Não é possível excluir o próprio usuário autenticado.",
        )

    usuario = db.query(Usuario).filter(
        Usuario.id == user_id,
        Usuario.restaurante_id == current_user.restaurante_id,
    ).first()
    if not usuario:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuário não encontrado."
        )

    target_role = (usuario.role or usuario.cargo or "").lower().strip()
    if target_role in {"admin", "superadmin"}:
        admin_rows = db.query(Usuario.id, Usuario.status).filter(
            Usuario.restaurante_id == current_user.restaurante_id,
            Usuario.cargo.in_(("admin", "superadmin")),
        ).with_for_update().all()
        has_remaining_active_admin = any(
            admin_id != usuario.id
            and str(admin_status or "").lower().strip() == "ativo"
            for admin_id, admin_status in admin_rows
        )
        if not has_remaining_active_admin:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="O restaurante deve manter pelo menos um administrador.",
            )

    try:
        db.delete(usuario)
        db.commit()
    except IntegrityError:
        db.rollback()
        target = db.query(Usuario).filter(
            Usuario.id == user_id,
            Usuario.restaurante_id == current_user.restaurante_id,
        ).first()
        if target:
            target.status = "inativo"
            db.commit()
    return


# ----------------- PRIVACY REQUEST OPERATIONS -----------------
from pydantic import BaseModel, Field
from typing import Optional
from ..models import Comanda, RascunhoPedido, MensagemWhatsApp, ActivityLog

class GdprOptOutRequest(BaseModel):
    telefone: str = Field(min_length=8, max_length=32)
    nome: Optional[str] = None
    anonimizar: bool = True

@router.post("/gdpr/opt-out", status_code=status.HTTP_200_OK)
def gdpr_opt_out(
    req: GdprOptOutRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("privacidade:administrar"))
):
    """Executa o escopo automatizado de uma solicitação de privacidade.

    Este fluxo não representa, sozinho, atendimento integral à LGPD. Dados
    financeiros, fiscais, backups e fornecedores devem seguir a política de
    retenção e a revisão manual do responsável pelo tratamento.
    """
    target_phone = req.telefone.strip()

    # 1. Locate all matching messages (check decrypted values)
    messages = db.query(MensagemWhatsApp).all()
    matched_msgs = [msg for msg in messages if msg.cliente_telefone == target_phone]

    # 2. Locate matching drafts
    drafts = db.query(RascunhoPedido).all()
    matched_drafts = [d for d in drafts if d.cliente_telefone == target_phone]

    # 3. Locate matching comandas by name
    matched_comandas = []
    if req.nome:
        comandas = db.query(Comanda).all()
        matched_comandas = [c for c in comandas if c.identificador and c.identificador.strip().lower() == req.nome.strip().lower()]

    try:
        # Apply action
        if req.anonimizar:
            for msg in matched_msgs:
                msg.cliente_telefone = "ANONIMIZADO"
                msg.conteudo = "Mensagem removida por solicitação LGPD."
                msg.transcricao = "Removido."
            for d in matched_drafts:
                d.cliente_telefone = "ANONIMIZADO"
                d.conteudo_json = "{}"
                d.ia_sugestao_resposta = "Removido."
            for c in matched_comandas:
                c.identificador = "Cliente Anonimizado (LGPD)"

            detail_msg = "Anonimização concluída no escopo automatizado."
        else:
            # Hard delete
            for msg in matched_msgs:
                db.delete(msg)
            for d in matched_drafts:
                db.delete(d)
            for c in matched_comandas:
                c.identificador = "Cliente Anonimizado (LGPD)"

            detail_msg = "Remoção concluída no escopo automatizado."

        # Registra a operação sem reintroduzir o telefone do titular no log.
        log = ActivityLog(
            restaurante_id=current_restaurante_id.get(),
            garcom_id="admin",
            action="PRIVACY_REQUEST",
            details=(
                f"{detail_msg} mensagens={len(matched_msgs)}; "
                f"rascunhos={len(matched_drafts)}; comandas={len(matched_comandas)}; "
                f"modo={'anonimizar' if req.anonimizar else 'remover'}."
            ),
        )
        db.add(log)
        db.commit()
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("Falha ao processar dado sensível criptografado")
        raise HTTPException(
            status_code=500,
            detail="Erro ao processar dado sensível, contate o suporte."
        )

    return {
        "status": "success",
        "detail": detail_msg,
        "automated_scope": ["mensagens_whatsapp", "rascunhos_pedido", "identificador_comanda"],
        "manual_review_required": True,
    }


@router.post("/usuarios/{user_id}/reenviar-convite")
def reenviar_convite_usuario(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("equipe:administrar"))
):
    """Renova o convite para compartilhamento manual pelo administrador."""
    import datetime
    from datetime import timezone

    usuario = db.query(Usuario).filter(
        Usuario.id == user_id,
        Usuario.restaurante_id == current_user.restaurante_id,
    ).first()
    if not usuario:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuário não encontrado."
        )

    if usuario.status != "pendente_ativacao":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este usuário já ativou sua conta."
        )

    # Gera ou renova o token se não existir ou se expirado
    if not usuario.token_convite:
        usuario.token_convite = str(uuid.uuid4())
    usuario.token_expira_em = datetime.datetime.now(timezone.utc) + datetime.timedelta(hours=24)
    db.commit()
    db.refresh(usuario)

    tel_clean = usuario.telefone or ""
    return {
        "message": f"Convite renovado para {usuario.nome}.",
        "token_convite": usuario.token_convite,
        "telefone": tel_clean,
        "nome": usuario.nome,
    }
