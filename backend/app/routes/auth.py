from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, text
from sqlalchemy.orm import Session
from typing import List
import uuid
import logging

from ..database import bind_session_to_tenant, get_db, current_restaurante_id
from ..models import Usuario
from ..schemas import LoginRequest, LoginResponse, UsuarioCreate, UsuarioResponse, AtivarContaRequest
from ..security import (
    create_access_token,
    get_password_hash,
    require_permission,
    verify_password,
)

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


@router.post("/ativar", response_model=LoginResponse)
def ativar_conta(payload: AtivarContaRequest, db: Session = Depends(get_db)):
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
    return db.query(Usuario).all()

@router.post("/usuarios", response_model=UsuarioResponse, status_code=status.HTTP_201_CREATED)
def create_usuario(
    user_in: UsuarioCreate,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("equipe:administrar"))
):
    """Cadastra um novo usuário no sistema."""
    # Check if username is taken
    existing = db.query(Usuario).filter(Usuario.usuario == user_in.usuario).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nome de usuário já cadastrado."
        )
    
    novo_usuario = Usuario(
        id=str(uuid.uuid4())[:8],
        nome=user_in.nome,
        usuario=user_in.usuario,
        senha_hash=get_password_hash(user_in.senha),
        role=user_in.role
    )
    db.add(novo_usuario)
    db.commit()
    db.refresh(novo_usuario)
    return novo_usuario

@router.delete("/usuarios/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_usuario(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: Usuario = Depends(require_permission("equipe:administrar"))
):
    """Deleta um usuário do sistema."""
    usuario = db.query(Usuario).filter(Usuario.id == user_id).first()
    if not usuario:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuário não encontrado."
        )
    db.delete(usuario)
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
    import os
    import datetime
    from datetime import timezone
    import httpx
    from ..config import settings

    usuario = db.query(Usuario).filter(Usuario.id == user_id).first()
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

    evolution_sent = False
    evolution_url = getattr(settings, "EVOLUTION_API_URL", None) or os.getenv("EVOLUTION_API_URL", "")
    evolution_key = getattr(settings, "EVOLUTION_API_KEY", None) or os.getenv("EVOLUTION_API_KEY", "")
    evolution_instance = getattr(settings, "EVOLUTION_INSTANCE_NAME", None) or os.getenv("EVOLUTION_INSTANCE_NAME", "")

    if evolution_url and evolution_key and evolution_instance:
        try:
            url_disparo = f"{evolution_url.rstrip('/')}/message/sendText/{evolution_instance}"
            headers = {
                "Content-Type": "application/json",
                "apikey": evolution_key
            }
            payload = {
                "number": tel_clean,
                "text": mensagem_texto
            }
            with httpx.Client(timeout=5.0) as client:
                res = client.post(url_disparo, headers=headers, json=payload)
                if res.status_code in [200, 201]:
                    evolution_sent = True
                    logger.info(f"[EVOLUTION API] Convite reenviado para {tel_clean}: {res.status_code}")
                else:
                    logger.warning(f"[EVOLUTION API] Falha HTTP {res.status_code} ao reenviar convite: {res.text}")
        except Exception as err:
            logger.warning(f"[EVOLUTION API] Exceção de rede ao reenviar convite: {err}")

    return {
        "message": f"Convite gerado com sucesso para {usuario.nome}.",
        "token_convite": usuario.token_convite,
        "telefone": tel_clean,
        "nome": usuario.nome,
        "link": convite_link,
        "mensagem": mensagem_texto
    }
