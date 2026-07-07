import os
os.environ["DATABASE_URL"] = "sqlite:///./test.db"

import pytest
from fastapi.testclient import TestClient
from app.database import SessionLocal, Base, engine
from app.main import app
from app.models import Comanda, MensagemWhatsApp, RascunhoPedido, ActivityLog, Usuario
from app.crypt import encrypt_field, decrypt_field

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
            senha_hash="hash",
            role="admin"
        )
        db.add(admin)
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
        
        # Fire GDPR request
        response = client.post("/auth/gdpr/opt-out", json={
            "telefone": "81999998888",
            "anonimizar": True
        })
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
