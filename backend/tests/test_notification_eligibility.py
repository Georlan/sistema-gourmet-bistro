"""Legacy notification policy: no provider, production data or message effects."""
import asyncio
import uuid
from unittest.mock import MagicMock

import pytest
from app.config import settings
from app.database import Base, SessionLocal, engine, current_restaurante_id
from app.models import Comanda, ConfiguracaoRestaurante, NotificacaoWhatsApp, Restaurante, Usuario
from app.services import notificacoes as notices, whatsapp


@pytest.fixture
def policy_db(monkeypatch):
    Base.metadata.create_all(engine)
    token = current_restaurante_id.set(991)
    monkeypatch.setattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", True)
    monkeypatch.setenv("KOMA_CUSTOMER_WA_ENABLED", "false")
    with SessionLocal(restaurante_id=991) as db:
        if not db.get(Restaurante, 991):
            db.add(Restaurante(id=991, nome="Fixture", slug="eligibility-fixture", plano="pro"))
            db.flush()
        config = db.query(ConfiguracaoRestaurante).filter_by(restaurante_id=991).first()
        if config is None:
            config = ConfiguracaoRestaurante(restaurante_id=991)
            db.add(config)
        config.whatsapp_customer_notices_enabled = True
        config.whatsapp_alerts_enabled = True
        if not db.get(Usuario, "eligibility-user"):
            db.add(Usuario(id="eligibility-user", restaurante_id=991, nome="Fixture", cargo="admin", status="ativo"))
            db.flush()
        order = Comanda(numero_pedido=int(uuid.uuid4().hex[:7], 16), garcom_id="eligibility-user", id=uuid.uuid4().hex, restaurante_id=991, tipo="Retirada", delivery_telefone="81999991111", whatsapp_status_opt_in=True)
        db.add(order)
        db.commit()
        yield db, config, order
    current_restaurante_id.reset(token)


def test_disabled_does_not_schedule_query_persist_or_send(monkeypatch):
    monkeypatch.setattr(settings, "KOMA_WHATSAPP_AUTOMATION_ENABLED", False)
    background = MagicMock()
    db = MagicMock()
    provider = MagicMock(side_effect=AssertionError("must not send"))
    monkeypatch.setattr(whatsapp, "enviar_texto_whatsapp_detalhado", provider)
    notices.agendar_notificacao_whatsapp_task(background, telefone="81999991111", conteudo="fixture", tipo="atribuicao_motoboy", restaurante_id=991)
    notices.agendar_notificacao_status_task(background, "fixture", "pronto", "81999991111", "Fixture", restaurante_id=991)
    result = asyncio.run(notices.enviar_notificacao_whatsapp(db, telefone="81999991111", conteudo="fixture", tipo="status_pedido", restaurante_id=991))
    assert result["status_envio"] == "ignorado"
    assert not db.mock_calls and not background.mock_calls and not provider.mock_calls


@pytest.mark.parametrize("change", ["consent", "config", "tenant", "phone"])
def test_changed_eligibility_blocks_before_persistence(policy_db, monkeypatch, change):
    db, config, order = policy_db
    assert notices.status_recipient_eligible(db, 991, order.id, order.delivery_telefone)
    rid, phone = 991, order.delivery_telefone
    if change == "consent":
        order.whatsapp_status_opt_in = False
    elif change == "config":
        config.whatsapp_customer_notices_enabled = False
    elif change == "tenant":
        rid = 992
    else:
        phone = "81988882222"
    db.commit()
    provider = MagicMock(side_effect=AssertionError("must not send"))
    monkeypatch.setattr(whatsapp, "enviar_texto_whatsapp_detalhado", provider)
    result = asyncio.run(notices.enviar_notificacao_whatsapp(db, telefone=phone, conteudo="fixture", tipo="status_pedido", restaurante_id=rid, comanda_id=order.id))
    assert result["status_envio"] == "ignorado"
    assert db.query(NotificacaoWhatsApp).filter_by(comanda_id=order.id).count() == 0
    provider.assert_not_called()


def test_courier_does_not_require_customer_consent(policy_db, monkeypatch):
    db, config, order = policy_db
    order.whatsapp_status_opt_in = False
    db.commit()
    provider = MagicMock(return_value=whatsapp.ResultadoEnvioWhatsApp(sucesso=True, provider="evolution"))
    monkeypatch.setattr(whatsapp, "enviar_texto_whatsapp_detalhado", provider)
    result = asyncio.run(notices.enviar_notificacao_whatsapp(db, telefone="81988882222", conteudo="fixture", tipo="atribuicao_motoboy", restaurante_id=991, comanda_id=order.id))
    assert result["status_envio"] == "enviado"
    provider.assert_called_once()


def test_revocation_between_queue_and_task_prevents_send(policy_db, monkeypatch):
    from starlette.background import BackgroundTasks
    db, config, order = policy_db
    background = BackgroundTasks()
    notices.agendar_notificacao_status_task(background, order.id, "pronto", order.delivery_telefone, "Fixture", restaurante_id=991)
    assert len(background.tasks) == 1
    order.whatsapp_status_opt_in = False
    db.commit()
    provider = MagicMock(side_effect=AssertionError("revoked consent"))
    monkeypatch.setattr(whatsapp, "enviar_texto_whatsapp_detalhado", provider)
    background.tasks[0].func()
    assert db.query(NotificacaoWhatsApp).filter_by(comanda_id=order.id).count() == 0
    provider.assert_not_called()


def test_disabled_tenant_does_not_schedule_courier(policy_db):
    db, config, order = policy_db
    config.whatsapp_alerts_enabled = False
    db.commit()
    background = MagicMock()
    notices.agendar_notificacao_whatsapp_task(background, telefone="81988882222", conteudo="fixture", tipo="atribuicao_motoboy", restaurante_id=991, comanda_id=order.id, db=db)
    background.add_task.assert_not_called()


def test_notification_provider_does_not_hold_sql_transaction(policy_db, monkeypatch):
    db, config, order = policy_db
    def provider(*args, **kwargs):
        assert not db.in_transaction()
        return whatsapp.ResultadoEnvioWhatsApp(sucesso=True, provider="evolution")
    monkeypatch.setattr(whatsapp, "enviar_texto_whatsapp_detalhado", provider)
    result = asyncio.run(notices.enviar_notificacao_whatsapp(db, telefone="81999991111", conteudo="fixture", tipo="status_pedido", restaurante_id=991, comanda_id=order.id))
    assert result["status_envio"] == "enviado"


def test_managed_customer_channel_never_falls_back_to_legacy_transport(policy_db):
    db, config, order = policy_db
    config.whatsapp_platform_managed = True
    config.whatsapp_platform_customer_allowed = False
    db.commit()
    assert not notices.status_recipient_eligible(db, 991, order.id, order.delivery_telefone)
