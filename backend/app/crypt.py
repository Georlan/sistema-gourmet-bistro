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
except Exception:
    # Fallback autocurativo com persistência em arquivo local bistro.key
    import os
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
        except Exception as e:
            print(f"[WARNING] Não foi possível persistir a chave de backup: {e}")
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
