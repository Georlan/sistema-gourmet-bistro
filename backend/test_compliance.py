import os
os.environ["DATABASE_URL"] = "sqlite:///./test.db"

import pytest
from fastapi.testclient import TestClient
from app.database import SessionLocal, Base, engine
from app.main import app
from app.models import Comanda, MensagemWhatsApp, RascunhoPedido, ActivityLog, Usuario
from app.crypt import encrypt_field, decrypt_field
from app.security import get_password_hash, create_access_token

client = TestClient(app)

@pytest.fixture(scope="module")
def setup_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        # Create standard admin user
        admin = Usuario(
            id="admin",
            nome="Admin",
            usuario="admin",
            senha_hash=get_password_hash("123"),
            role="admin"
        )
        db.add(admin)
        
        # Create standard garcom user
        garcom = Usuario(
            id="garcom_test",
            nome="Garcom",
            usuario="garcom_test",
            senha_hash=get_password_hash("123"),
            role="garcom"
        )
        db.add(garcom)
        
        db.commit()
    finally:
        db.close()
    yield
    Base.metadata.drop_all(bind=engine)

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
        with pytest.raises(Exception):
            db.commit()
        db.rollback()
        
        # Test delete blocks
        db.delete(log)
        with pytest.raises(Exception):
            db.commit()
        db.rollback()
    finally:
        db.close()

def test_gdpr_opt_out(setup_db):
    db = SessionLocal()
    try:
        # Add a WhatsApp message with sensitive data
        msg = MensagemWhatsApp(
            id="msg-1",
            cliente_telefone="81999998888",
            remetente="cliente",
            conteudo="Quero fazer um pedido, moro na rua A, 123",
            transcricao="Moro na rua A"
        )
        db.add(msg)
        db.commit()
        
        # Verify stored encrypted in DB
        assert msg._cliente_telefone != "81999998888"
        assert msg.cliente_telefone == "81999998888"
        
        # 1. Test 401 Unauthorized without token
        resp_unauthorized = client.post("/auth/gdpr/opt-out", json={
            "telefone": "81999998888",
            "anonimizar": True
        })
        assert resp_unauthorized.status_code == 401
        
        # 2. Test 403 Forbidden for non-admin role (garcom)
        garcom_token = create_access_token(subject="garcom_test", restaurante_id=1)
        garcom_headers = {"Authorization": f"Bearer {garcom_token}"}
        resp_forbidden = client.post("/auth/gdpr/opt-out", json={
            "telefone": "81999998888",
            "anonimizar": True
        }, headers=garcom_headers)
        assert resp_forbidden.status_code == 403
        
        # 3. Fire GDPR request with Admin token (should succeed)
        admin_token = create_access_token(subject="admin", restaurante_id=1)
        admin_headers = {"Authorization": f"Bearer {admin_token}"}
        response = client.post("/auth/gdpr/opt-out", json={
            "telefone": "81999998888",
            "anonimizar": True
        }, headers=admin_headers)
        assert response.status_code == 200
        
        # Verify anonymization succeeded
        db.refresh(msg)
        assert msg.cliente_telefone == "ANONIMIZADO"
        assert msg.conteudo == "Mensagem removida por solicitação LGPD."
        
        # Verify audit log recorded GDPR action
        audit = db.query(ActivityLog).filter(ActivityLog.action == "GDPR_DELETE").first()
        assert audit is not None
        assert "81999998888" in audit.details
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
                raise Exception("Encryption failure simulation")
            def decrypt(self, *args, **kwargs):
                raise Exception("Decryption failure simulation")
                
        crypt.cipher = FailedCipher()
        
        # encrypt_field deve levantar a exceção
        with pytest.raises(Exception) as exc_info:
            crypt.encrypt_field("plain text")
        assert "Encryption failure simulation" in str(exc_info.value)
        
    finally:
        # Restaurar cipher original
        crypt.cipher = original_cipher
