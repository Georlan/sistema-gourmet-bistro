import jwt
from datetime import datetime, timedelta, timezone
from types import MappingProxyType
from typing import Any, Union, Optional
import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from .config import settings
from .database import get_db
from .models import Usuario

# Password context configuration
def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain text password against its bcrypt hash."""
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"), 
            hashed_password.encode("utf-8")
        )
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    """Generates a bcrypt hash from a plain text password."""
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")

RESERVED_CLAIMS = {"sub", "exp", "restaurante_id", "role"}

# Matriz central de autorização do backoffice. As rotas devem depender de uma
# permissão de negócio, em vez de repetir listas de cargos localmente.
PERMISSION_ROLES = MappingProxyType({
    "caixa:operar": frozenset({"admin", "gerente", "caixa"}),
    "equipe:administrar": frozenset({"admin", "gerente", "caixa"}),
    "estoque:consultar": frozenset({"admin", "gerente", "caixa"}),
    "estoque:administrar": frozenset({"admin", "gerente", "caixa"}),
    "relatorios:consultar": frozenset({"admin", "gerente", "caixa"}),
    "relatorios:administrar": frozenset({"admin", "gerente"}),
    "catalogo:administrar": frozenset({"admin", "gerente", "caixa"}),
    "configuracoes:administrar": frozenset({"admin", "gerente", "caixa"}),
    "fidelidade:operar": frozenset({"admin", "gerente", "caixa"}),
    "fidelidade:administrar": frozenset({"admin", "gerente"}),
    "privacidade:administrar": frozenset({"admin", "gerente"}),
    "impressao:administrar": frozenset({"admin", "gerente", "caixa"}),
    "comandas:forcar_fechamento": frozenset({"admin", "gerente", "caixa"}),
    "comandas:reabrir": frozenset({"admin", "gerente", "caixa"}),
    "pedidos:alterar_status": frozenset({"admin", "gerente", "caixa"}),
})

def create_access_token(
    subject: Union[str, Any],
    restaurante_id: int,
    expires_delta: Optional[timedelta] = None,
    role: Optional[str] = None,
    extra_claims: Optional[dict] = None
) -> str:
    """Creates a JWT access token for persistent login session."""
    if extra_claims:
        conflicts = RESERVED_CLAIMS.intersection(extra_claims.keys())
        if conflicts:
            raise ValueError(f"extra_claims não pode conter chaves reservadas: {', '.join(sorted(conflicts))}")

    if restaurante_id is None or not isinstance(restaurante_id, int) or isinstance(restaurante_id, bool):
        raise ValueError("restaurante_id é obrigatório e deve ser um inteiro válido.")

    if restaurante_id < 0 or (restaurante_id == 0 and role != "superadmin"):
        raise ValueError("restaurante_id deve ser um inteiro positivo válido.")

    if subject is None or str(subject).strip() == "":
        raise ValueError("subject é obrigatório.")

    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode = {}
    if extra_claims:
        to_encode.update(extra_claims)

    to_encode["sub"] = str(subject)
    to_encode["exp"] = expire
    to_encode["restaurante_id"] = restaurante_id
    if role is not None:
        to_encode["role"] = role

    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt



oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

def get_current_garcom_optional(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> Optional[Usuario]:
    """
    Optional dependency. Returns the Garcom object if a valid token is provided,
    otherwise returns None.
    """
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        garcom_id: str = payload.get("sub")
        if garcom_id is None:
            return None
    except jwt.PyJWTError:
        return None
    
    return db.query(Usuario).filter(Usuario.id == garcom_id).first()


def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> Usuario:
    """
    Dependency obrigatória. Levanta 401 se não houver token válido ou
    se o usuário não existir mais no banco.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciais inválidas ou ausentes.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_exception
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        garcom_id: str = payload.get("sub")
        if garcom_id is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception

    user = db.query(Usuario).filter(Usuario.id == garcom_id).first()
    if user is None:
        raise credentials_exception
        
    status_val = str(getattr(user, "status", "ativo") or "ativo").lower().strip()
    if status_val in ("inativo", "blocked", "disabled"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Conta de usuário inativa ou bloqueada."
        )
    return user


def ensure_permission(current_user: Optional[Usuario], permission: str) -> Usuario:
    """Valida uma permissão da matriz central para uso dentro de uma rota."""
    if permission not in PERMISSION_ROLES:
        raise RuntimeError(f"Permissão desconhecida na matriz RBAC: {permission}")

    if current_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciais inválidas ou ausentes.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    status_val = str(getattr(current_user, "status", "ativo") or "ativo").lower().strip()
    if status_val in ("inativo", "blocked", "disabled"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Conta de usuário inativa ou bloqueada."
        )

    user_role = (current_user.role or current_user.cargo or "garcom").lower().strip()
    if user_role in ("admin", "superadmin"):
        return current_user

    if user_role not in PERMISSION_ROLES[permission]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Acesso negado: o cargo '{user_role}' não possui a permissão "
                f"'{permission}'."
            )
        )
    return current_user


def require_permission(permission: str):
    """Dependency factory baseada na matriz central de permissões."""
    if permission not in PERMISSION_ROLES:
        raise RuntimeError(f"Permissão desconhecida na matriz RBAC: {permission}")

    def permission_checker(
        current_user: Usuario = Depends(get_current_user)
    ) -> Usuario:
        return ensure_permission(current_user, permission)

    return permission_checker


def require_roles(*allowed_roles: str):
    """
    Dependency factory que verifica se o usuário autenticado é ativo e possui
    um dos cargos autorizados. Admin/superadmin sempre têm acesso total.
    """
    def role_checker(current_user: Usuario = Depends(get_current_user)) -> Usuario:
        user_role = (current_user.role or current_user.cargo or "garcom").lower().strip()
        allowed = [r.lower().strip() for r in allowed_roles]

        # Admin e superadmin possuem bypass automático para todas as verificações de autorização
        if user_role in ("admin", "superadmin") or "admin" in allowed:
            if user_role in ("admin", "superadmin"):
                return current_user

        if user_role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Acesso negado: o cargo '{user_role}' não possui permissão para esta operação."
            )
        return current_user

    return role_checker
