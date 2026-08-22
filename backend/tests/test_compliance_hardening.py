import pytest
from app.database import SessionLocal, Base, engine, current_restaurante_id
from app.models import ActivityLog, Usuario
from app.crypt import encrypt_field, decrypt_field
from app.security import get_password_hash

@pytest.fixture(scope="module")
def setup_db():
    token_var = current_restaurante_id.set(1)
    try:
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)

        db = SessionLocal()
        try:
            # Create standard admin user
            admin = Usuario(
                id="admin",
                restaurante_id=1,
                nome="Admin",
                usuario="admin",
                senha_hash=get_password_hash("123"),
                role="admin",
                status="ativo",
            )
            db.add(admin)

            # Create standard garcom user
            garcom = Usuario(
                id="garcom_test",
                restaurante_id=1,
                nome="Garcom",
                usuario="garcom_test",
                senha_hash=get_password_hash("123"),
                role="garcom",
                status="ativo",
            )
            db.add(garcom)

            db.commit()
        finally:
            db.close()
        yield
        Base.metadata.drop_all(bind=engine)
    finally:
        current_restaurante_id.reset(token_var)

def test_field_encryption():
    # Test encryption helper directly
    original = "Hello World 123"
    encrypted = encrypt_field(original)
    assert encrypted != original
    decrypted = decrypt_field(encrypted)
    assert decrypted == original

def test_immutable_logs(setup_db):
    db = SessionLocal()
    try:
        log = ActivityLog(
            garcom_id="admin",
            action="TEST_ACTION",
            details="Immutable test"
        )
        db.add(log)
        db.commit()

        # Verify read is fine
        assert log.id is not None

        # Test update blocks
        log.details = "Modified details"
        with pytest.raises(PermissionError):
            db.commit()
        db.rollback()

        # Test delete blocks
        db.delete(log)
        with pytest.raises(PermissionError):
            db.commit()
        db.rollback()
    finally:
        db.close()


def test_encryption_errors():
    import app.crypt as crypt
    from cryptography.fernet import Fernet

    # Backup original cipher
    original_cipher = crypt.cipher

    try:
        # 1. Simular uma chave Fernet inválida/diferente
        bad_cipher = Fernet(Fernet.generate_key())
        crypt.cipher = bad_cipher

        # 2. Se tentarmos descriptografar algo encriptado com a chave original,
        # decrypt_field deve logar e retornar o texto original (cipher text bruto) sem crashar
        original_text = "test_text"
        encrypted_with_good_key = original_cipher.encrypt(original_text.encode("utf-8")).decode("utf-8")

        decrypted = crypt.decrypt_field(encrypted_with_good_key)
        # Deve retornar o valor encriptado bruto (divergência de chave) e não o original
        assert decrypted == encrypted_with_good_key

        # 3. Se tentarmos encriptar com o cipher corrompido (ex: forçar falha no cipher)
        class FailedCipher:
            def encrypt(self, *args, **kwargs):
                raise RuntimeError("Encryption failure simulation")
            def decrypt(self, *args, **kwargs):
                raise RuntimeError("Decryption failure simulation")

        crypt.cipher = FailedCipher()

        # encrypt_field deve levantar a exceção
        with pytest.raises(RuntimeError) as exc_info:
            crypt.encrypt_field("plain text")
        assert "Encryption failure simulation" in str(exc_info.value)

    finally:
        # Restaurar cipher original
        crypt.cipher = original_cipher
