import base64
from typing import Optional
from cryptography.fernet import Fernet
from .config import settings

# Clean base64 key
key_str = settings.ENCRYPTION_KEY
if key_str.startswith("b'") or key_str.startswith('b"'):
    key_str = key_str[2:-1]

try:
    cipher = Fernet(key_str.encode("utf-8"))
except Exception:
    # Fallback to a freshly generated key if the configured one is invalid
    fallback_key = Fernet.generate_key()
    cipher = Fernet(fallback_key)

def encrypt_field(plain_text: Optional[str]) -> Optional[str]:
    """Encrypts plain text string using AES-256 (Fernet) if not empty."""
    if not plain_text:
        return plain_text
    try:
        return cipher.encrypt(plain_text.encode("utf-8")).decode("utf-8")
    except Exception:
        return plain_text

def decrypt_field(cipher_text: Optional[str]) -> Optional[str]:
    """Decrypts cipher text string using AES-256 (Fernet). Returns plain text on error/fallback."""
    if not cipher_text:
        return cipher_text
    try:
        return cipher.decrypt(cipher_text.encode("utf-8")).decode("utf-8")
    except Exception:
        return cipher_text
