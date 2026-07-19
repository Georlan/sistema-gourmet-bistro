import jwt
from datetime import datetime, timedelta, timezone
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

def create_access_token(
    subject: Union[str, Any],
    restaurante_id: int = 1,
    expires_delta: timedelta = None,
    role: Optional[str] = None,
    extra_claims: Optional[dict] = None
) -> str:
    """Creates a JWT access token for persistent login session."""
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode = {"exp": expire, "sub": str(subject), "restaurante_id": restaurante_id}
    if role is not None:
        to_encode["role"] = role
    if extra_claims:
        to_encode.update(extra_claims)

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
    return user


