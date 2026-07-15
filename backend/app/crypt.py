import base64
from typing import Optional
from cryptography.fernet import Fernet
import logging
from .config import settings

logger = logging.getLogger("koma.crypt")

# Clean base64 key
key_str = settings.ENCRYPTION_KEY
if key_str.startswith("b'") or key_str.startswith('b"'):
    key_str = key_str[2:-1]

try:
    if not key_str:
        raise ValueError("Empty key")
    cipher = Fernet(key_str.encode("utf-8"))
except Exception as e:
    import os
    # Garantir que falhe explicitamente em produção se ENCRYPTION_KEY estiver ausente ou for inválida
    is_production = os.getenv("ENVIRONMENT") == "production" or os.getenv("DATABASE_URL", "").startswith("postgres")
    if is_production:
        raise RuntimeError(
            f"A variável de ambiente 'ENCRYPTION_KEY' é inválida ou ausente em produção! Erro Fernet: {e}"
        )
    
    # Fallback autocurativo apenas para desenvolvimento local
    key_file = "bistro.key"
    fallback_key = None
    if os.path.exists(key_file):
        try:
            with open(key_file, "rb") as f:
                fallback_key = f.read().strip()
            cipher = Fernet(fallback_key)
        except Exception:
            fallback_key = None
            
    if not fallback_key:
        fallback_key = Fernet.generate_key()
        try:
            with open(key_file, "wb") as f:
                f.write(fallback_key)
        except Exception as write_err:
            print(f"[WARNING] Não foi possível persistir a chave de backup local: {write_err}")
        cipher = Fernet(fallback_key)

def encrypt_field(plain_text: Optional[str]) -> Optional[str]:
    """Encrypts plain text string using AES-256 (Fernet) if not empty."""
    if not plain_text:
        return plain_text
    try:
        return cipher.encrypt(plain_text.encode("utf-8")).decode("utf-8")
    except Exception:
        logger.exception("Falha ao criptografar campo sensível")
        try:
            import sentry_sdk
            sentry_sdk.capture_message(
                "encrypt_field falhou - dado pode ter sido salvo em texto puro",
                level="error"
            )
        except Exception:
            pass
        raise

def decrypt_field(cipher_text: Optional[str]) -> Optional[str]:
    """Decrypts cipher text string using AES-256 (Fernet). Returns plain text on error/fallback."""
    if not cipher_text:
        return cipher_text
    try:
        return cipher.decrypt(cipher_text.encode("utf-8")).decode("utf-8")
    except Exception:
        logger.exception("Falha ao descriptografar campo - retornando valor bruto")
        try:
            import sentry_sdk
            sentry_sdk.capture_message(
                "decrypt_field falhou - possível divergência de ENCRYPTION_KEY",
                level="error"
            )
        except Exception:
            pass
        return cipher_text
