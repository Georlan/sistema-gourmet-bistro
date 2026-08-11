from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import or_, text
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
from ..services.whatsapp import enviar_texto_whatsapp
from ..websocket_manager import manager

logger = logging.getLogger("koma.auth")

router = APIRouter(
    prefix="/auth",
    tags=["Autenticação"]
)


def _lookup_user_before_tenant(db: Session, identifier: str):
    """Resolve somente id/tenant antes do RLS conhecer o restaurante."""
    if db.get_bind().dialect.name == "postgresql":
        return db.execute(
            text("SELECT id, restaurante_id, senha_hash FROM koma_internal.auth_user(:identifier)"),
            {"identifier": identifier},
        ).mappings().first()
    usuario = db.query(Usuario).filter(
        or_(
            Usuario.email == identifier,
            Usuario.telefone == identifier,
            Usuario.usuario == identifier,
        )
    ).first()
    if not usuario:
        return None
    return {
        "id": usuario.id,
        "restaurante_id": usuario.restaurante_id,
        "senha_hash": usuario.senha_hash,
    }


def _lookup_invite_before_tenant(db: Session, token: str):
    if db.get_bind().dialect.name == "postgresql":
        return db.execute(
            text("SELECT id, restaurante_id FROM koma_internal.auth_invite(:token)"),
            {"token": token},
        ).mappings().first()
    usuario = db.query(Usuario).filter(Usuario.token_convite == token).first()
    if not usuario:
        return None
    return {"id": usuario.id, "restaurante_id": usuario.restaurante_id}

@router.post("/login", response_model=LoginResponse)
def login(login_data: LoginRequest, db: Session = Depends(get_db)):
    """
    Realiza a autenticação do usuário por e-mail ou telefone.
    Retorna o token JWT e as informações do usuário.
    """
    username_val = (login_data.username or "").strip().lower()
    identity = _lookup_user_before_tenant(db, username_val)
    if not identity or not verify_password(login_data.password, identity["senha_hash"]):
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

    access_token = create_access_token(subject=usuario.id, restaurante_id=usuario.restaurante_id)
    
    user_data = {
        "id": usuario.id,
        "nome": usuario.nome,
        "usuario": usuario.usuario,
        "email": usuario.email,
        "telefone": usuario.telefone,
        "role": usuario.role,
        "cargo": getattr(usuario, "cargo", None) or usuario.role,
        "restaurante_id": usuario.restaurante_id,
        "status": usuario.status
    }
    
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

    # Validar se o e-mail já não está em uso por outro usuário
    existente_email = db.query(Usuario).filter(Usuario.email == email_clean).first()
    if existente_email and existente_email.id != usuario.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este e-mail já está cadastrado no sistema."
        )
            
    usuario.email = email_clean
    usuario.senha_hash = get_password_hash(payload.senha)
    usuario.status = "ativo"
    usuario.token_convite = None
    usuario.token_expira_em = None
    
    db.commit()
    db.refresh(usuario)
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
    
    user_data = {
        "id": usuario.id,
        "nome": usuario.nome,
        "usuario": usuario.usuario,
        "role": usuario.role
    }
    
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


# ----------------- LGPD COMPLIANCE ENDPOINTS -----------------
from pydantic import BaseModel
from typing import Optional
from ..models import Comanda, RascunhoPedido, MensagemWhatsApp, ActivityLog

class GdprOptOutRequest(BaseModel):
    telefone: str
    nome: Optional[str] = None
    anonimizar: bool = True

@router.post("/gdpr/opt-out", status_code=status.HTTP_200_OK)
def gdpr_opt_out(
    req: GdprOptOutRequest,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("privacidade:administrar"))
):
    """
    LGPD Compliance: Erases or anonymizes client's personal data.
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
            
            detail_msg = f"Anonimização realizada para telefone {target_phone}."
        else:
            # Hard delete
            for msg in matched_msgs:
                db.delete(msg)
            for d in matched_drafts:
                db.delete(d)
            for c in matched_comandas:
                c.identificador = "Cliente Anonimizado (LGPD)"
            
            detail_msg = f"Remoção de dados concluída para telefone {target_phone}."

        # Write immutable log record
        log = ActivityLog(
            restaurante_id=current_restaurante_id.get(),
            garcom_id="admin",
            action="GDPR_DELETE",
            details=detail_msg
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
    
    return {"status": "success", "detail": detail_msg}


@router.post("/usuarios/{user_id}/reenviar-convite")
def reenviar_convite_usuario(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("equipe:administrar"))
):
    """Reenvia o link de convite por WhatsApp para o usuário pendente de ativação."""
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
    convite_link = f"https://sistema-gourmet-bistro.pages.dev/ativar?token={usuario.token_convite}"
    mensagem_texto = f"Olá {usuario.nome}! Você foi convidado para trabalhar no Kôma. Clique no link para criar sua senha e ativar sua conta: {convite_link}"

    evolution_sent = enviar_texto_whatsapp(
        tel_clean,
        mensagem_texto,
        contexto="reenvio de convite de funcionário",
    )

    return {
        "message": f"Convite gerado com sucesso para {usuario.nome}.",
        "token_convite": usuario.token_convite,
        "telefone": tel_clean,
        "nome": usuario.nome,
        "link": convite_link,
        "mensagem": mensagem_texto
    }
