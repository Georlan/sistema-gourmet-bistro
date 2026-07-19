from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
import uuid
import logging

from ..database import get_db, current_restaurante_id
from ..models import Usuario
from ..schemas import LoginRequest, LoginResponse, UsuarioCreate, UsuarioResponse
from ..security import verify_password, create_access_token, get_password_hash, get_current_user

logger = logging.getLogger("koma.auth")

def require_admin(user: Usuario):
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso restrito a administradores."
        )

router = APIRouter(
    prefix="/auth",
    tags=["Autenticação"]
)

@router.post("/login", response_model=LoginResponse)
def login(login_data: LoginRequest, db: Session = Depends(get_db)):
    """
    Realiza a autenticação do usuário.
    Retorna o token JWT e as informações do usuário.
    """
    from ..database import current_restaurante_id
    token_var = current_restaurante_id.set(None)
    try:
        usuario = db.query(Usuario).filter(Usuario.usuario == login_data.username).first()
    finally:
        current_restaurante_id.reset(token_var)

    if not usuario:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário ou senha incorretos"
        )
    
    if not verify_password(login_data.password, usuario.senha_hash):
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

@router.get("/usuarios", response_model=List[UsuarioResponse])
def get_usuarios(db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """Retorna todos os usuários cadastrados (garçons, caixas, admins)."""
    require_admin(current_user)
    return db.query(Usuario).all()

@router.post("/usuarios", response_model=UsuarioResponse, status_code=status.HTTP_201_CREATED)
def create_usuario(user_in: UsuarioCreate, db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """Cadastra um novo usuário no sistema."""
    require_admin(current_user)
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
def delete_usuario(user_id: str, db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """Deleta um usuário do sistema."""
    require_admin(current_user)
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
def gdpr_opt_out(req: GdprOptOutRequest, db: Session = Depends(get_db), current_user: Usuario = Depends(get_current_user)):
    """
    LGPD Compliance: Erases or anonymizes client's personal data.
    """
    require_admin(current_user)
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

