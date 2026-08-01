import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.models import Restaurante, Comanda, Usuario
from app.services.whatsapp import enviar_notificacao_whatsapp_status

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def setup_db(monkeypatch):
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr("app.services.whatsapp.SessionLocal", TestingSessionLocal)
    yield
    Base.metadata.drop_all(bind=engine)


def test_whatsapp_notification_skipped_if_same_status():
    result = enviar_notificacao_whatsapp_status(
        comanda_id="cmd_100",
        status_novo="pronto",
        status_anterior="pronto",
        restaurante_id=999
    )
    assert result is False


def test_whatsapp_notification_resilient_if_unconfigured_or_missing_comanda():
    # 1. Missing comanda
    res1 = enviar_notificacao_whatsapp_status(
        comanda_id="cmd_99999",
        status_novo="pronto",
        status_anterior="producao",
        restaurante_id=999
    )
    assert res1 is False

    # 2. Existing comanda without Evolution API configured
    db = TestingSessionLocal()
    try:
        rest = db.query(Restaurante).filter(Restaurante.id == 999).first()
        if not rest:
            rest = Restaurante(id=999, nome="Bistrô Teste Notif", plano="pocket")
            db.add(rest)
        
        user = Usuario(id="usr_whatsapp_999", restaurante_id=999, nome="Garçom Teste", cargo="garcom")
        db.add(user)
        
        cmd = Comanda(
            id="cmd_whatsapp_100",
            restaurante_id=999,
            garcom_id="usr_whatsapp_999",
            tipo="Retirada",
            identificador="João Silva",
            delivery_telefone="81999998888",
            numero_pedido=101,
            delivery_status="producao"
        )
        db.add(cmd)
        db.commit()
    finally:
        db.close()

    res2 = enviar_notificacao_whatsapp_status(
        comanda_id="cmd_whatsapp_100",
        status_novo="pronto",
        status_anterior="producao",
        restaurante_id=999
    )
    # Returns False gracefully (skipped because EVOLUTION_API_URL is empty in dev/test) without throwing exceptions
    assert res2 is False
