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
    """Generates a bcrypt hash for the password."""
    salt = bcrypt.gensalt()
    hashed_password = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed_password.decode("utf-8")

RESERVED_CLAIMS = {"sub", "exp", "restaurante_id", "role"}

# Matriz central de autorização do backoffice. As rotas devem depender de uma
# permissão de negócio, em vez de repetir listas de cargos localmente.
PERMISSION_ROLES = MappingProxyType({
    "caixa:operar": frozenset({"admin", "gerente", "caixa"}),
    "smartpos:receber": frozenset({"garcom", "caixa", "gerente"}),
    "equipe:administrar": frozenset({"admin", "gerente", "caixa"}),
    "estoque:consultar": frozenset({"admin", "gerente", "caixa"}),
    "estoque:administrar": frozenset({"admin", "gerente", "caixa"}),
    "relatorios:consultar": frozenset({"admin", "gerente", "caixa"}),
    "relatorios:administrar": frozenset({"admin", "gerente", "caixa"}),
    "catalogo:administrar": frozenset({"admin", "gerente", "caixa"}),
    "configuracoes:administrar": frozenset({"admin", "gerente", "caixa"}),
    "fidelidade:operar": frozenset({"admin", "gerente", "caixa"}),
    "fidelidade:administrar": frozenset({"admin", "gerente", "caixa"}),
    "privacidade:administrar": frozenset({"admin", "gerente", "caixa"}),
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


def _authenticated_user_from_token(token: str, db: Session) -> Usuario:
    """Valida assinatura, tenant e estado atual da conta no banco.

    O JWT seleciona o escopo RLS da requisição, mas nunca é a fonte final de
    cargo ou status. Esses atributos são sempre recarregados da conta atual.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciais inválidas ou ausentes.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )
        user_id = payload.get("sub")
        restaurante_id = payload.get("restaurante_id")
        if (
            user_id is None
            or not isinstance(restaurante_id, int)
            or isinstance(restaurante_id, bool)
            or restaurante_id <= 0
        ):
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception

    user = db.query(Usuario).filter(Usuario.id == str(user_id)).first()
    if user is None or user.restaurante_id != restaurante_id:
        raise credentials_exception

    status_val = str(
        getattr(user, "status", "pendente_ativacao") or "pendente_ativacao"
    ).lower().strip()
    if status_val != "ativo":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Conta de usuário pendente, inativa ou bloqueada.",
        )
    return user

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
    return _authenticated_user_from_token(token, db)


def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> Usuario:
    """
    Dependency obrigatória. Levanta 401 se não houver token válido ou
    se o usuário não existir mais no banco.
    """
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciais inválidas ou ausentes.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _authenticated_user_from_token(token, db)


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

    status_val = str(
        getattr(current_user, "status", "pendente_ativacao") or "pendente_ativacao"
    ).lower().strip()
    if status_val != "ativo":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Conta de usuário pendente, inativa ou bloqueada."
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


def create_motoboy_token(motoboy_id: int, restaurante_id: int, jti: str) -> str:
    """Cria um token JWT temporário seguro para o PWA do Motoboy com TTL de 4 horas e JTI de controle."""
    expire = datetime.now(timezone.utc) + timedelta(hours=4)
    to_encode = {
        "sub": f"motoboy_{motoboy_id}",
        "motoboy_id": motoboy_id,
        "restaurante_id": restaurante_id,
        "type": "motoboy_pwa",
        "jti": jti,
        "exp": expire
    }
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def verify_motoboy_token(token: str, db: Optional[Any] = None) -> dict:
    """Valida o token temporário do motoboy, checando assinatura, expiração e status de revogação no banco."""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token do entregador não fornecido."
        )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if payload.get("type") != "motoboy_pwa":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Tipo de token inválido."
            )
        motoboy_id = payload.get("motoboy_id")
        restaurante_id = payload.get("restaurante_id")
        jti = payload.get("jti")
        if not motoboy_id or not restaurante_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Dados do entregador incompletos no token."
            )

        # Checar revogação no banco de dados se a sessão db for fornecida e jti existir
        if db is not None and jti:
            from .models import MotoboyTokenAtivo
            token_db = db.query(MotoboyTokenAtivo).filter(
                MotoboyTokenAtivo.jti == jti,
                MotoboyTokenAtivo.motoboy_id == int(motoboy_id),
                MotoboyTokenAtivo.restaurante_id == int(restaurante_id)
            ).first()
            if not token_db or token_db.revogado:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Link do entregador foi revogado ou é inválido. Solicite um novo link no Caixa."
                )

        return {"motoboy_id": int(motoboy_id), "restaurante_id": int(restaurante_id), "jti": jti}
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Link do entregador expirou (válido por 4 horas). Solicite um novo link no Caixa."
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Link de entregador inválido."
        )


import time
from collections import defaultdict

class IPRateLimiter:
    """Rate limiter em memória com janela deslizante de 60 segundos."""
    def __init__(self, requests_per_minute: int = 30):
        self.requests_per_minute = requests_per_minute
        self.history = defaultdict(list)

    def check(self, request: Any):
        client_ip = request.client.host if request and hasattr(request, 'client') and request.client else "127.0.0.1"
        now = time.time()
        cutoff = now - 60.0

        # Purga requisições com mais de 60 segundos
        timestamps = [t for t in self.history[client_ip] if t > cutoff]
        if len(timestamps) >= self.requests_per_minute:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Muitas requisições. Aguarde um momento antes de tentar novamente."
            )
        timestamps.append(now)
        self.history[client_ip] = timestamps

motoboy_rate_limiter = IPRateLimiter(requests_per_minute=30)
