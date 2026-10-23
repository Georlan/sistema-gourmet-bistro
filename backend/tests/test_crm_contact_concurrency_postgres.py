"""Two operators must not bypass the confirmed-contact cooldown concurrently."""
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Cliente, Restaurante
from app.crm_models import CrmContatoCliente
from app.services.customer_crm import record_crm_customer_contact


def test_concurrent_manual_confirmations_create_one_contact():
    url = os.environ.get("CRM_POSTGRES_TEST_URL")
    if not url:
        pytest.skip("Requires disposable local PostgreSQL via CRM_POSTGRES_TEST_URL")
    assert make_url(url).host in {"localhost", "127.0.0.1"}, "Only local test PostgreSQL is allowed"
    engine = create_engine(url)
    customer_id = str(uuid.uuid4())
    restaurant_id = 9347
    try:
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            if db.get(Restaurante, restaurant_id) is None:
                db.add(Restaurante(id=restaurant_id, nome="Concurrent contact fixture"))
                db.flush()
            db.add(Cliente(id=customer_id, restaurante_id=restaurant_id,
                nome="Synthetic customer", telefone="85999993305"))
            db.commit()

        # Without a customer lock, both SELECTs observe no contact before
        # either INSERT commits. With the lock, the second SELECT must wait
        # for the first transaction, then observe its confirmed contact.
        rendezvous = threading.Barrier(2)

        @event.listens_for(engine, "after_cursor_execute")
        def synchronize_contact_reads(conn, cursor, statement, parameters, context, executemany):
            if "FROM crm_contatos_clientes" in statement and "ORDER BY" in statement:
                try:
                    rendezvous.wait(timeout=2)
                except threading.BrokenBarrierError:
                    pass

        def confirm(_):
            with Session(engine) as db:
                try:
                    record_crm_customer_contact(db, restaurante_id=restaurant_id,
                        usuario_id=None, cliente_id=customer_id,
                        acao_executada="CONTATO_MANUAL_CONFIRMADO")
                    return 201
                except HTTPException as exc:
                    db.rollback()
                    return exc.status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(confirm, range(2)))
        assert sorted(statuses) == [201, 409]
        with Session(engine) as db:
            assert db.query(CrmContatoCliente).filter_by(
                restaurante_id=restaurant_id, cliente_id=customer_id).count() == 1
    finally:
        engine.dispose()


def test_two_tenants_cannot_exceed_shared_campaign_daily_limit(monkeypatch):
    """Two workers competing for the fifth slot reserve exactly one attempt."""
    import datetime as dt
    from app.models import ConfiguracaoRestaurante, CentralWhatsAppSenderState
    from app.crm_models import CrmCampanha, CrmClientePreferencia
    from app.services.central_whatsapp_campaigns import reserve_campaign, CampaignDeferred
    monkeypatch.setattr("app.services.central_whatsapp_campaigns.campaign_now", lambda: dt.datetime.now(dt.timezone.utc).replace(hour=15))
    from app.services.central_whatsapp import transport_configuration, recipient_fingerprint
    from app.services.whatsapp_sender_gate import lock_sender
    from app.timezone_utils import OPERATIONAL_TIMEZONE
    url = os.environ.get('CRM_POSTGRES_TEST_URL')
    if not url: pytest.skip('Requires disposable local PostgreSQL via CRM_POSTGRES_TEST_URL')
    assert make_url(url).host in {'localhost','127.0.0.1'}
    monkeypatch.setenv('KOMA_CENTRAL_WA_ENABLED','true')
    monkeypatch.setenv('KOMA_CENTRAL_WA_CAMPAIGNS_ENABLED','true')
    monkeypatch.setenv('KOMA_CENTRAL_WA_ALLOWED_RESTAURANT_IDS','9351,9352')
    monkeypatch.setenv('KOMA_CENTRAL_WA_CAMPAIGN_RESTAURANT_IDS','9351,9352')
    monkeypatch.setenv('KOMA_CENTRAL_WA_SENDER_PHONE','5511888888888')
    monkeypatch.setenv('KOMA_CENTRAL_WA_INSTANCE_NAME','campaign-race-'+uuid.uuid4().hex)
    cfg=transport_configuration()
    engine=create_engine(url)
    now=dt.datetime.now(dt.timezone.utc)
    snapshots=[]
    try:
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            for rid in (9351,9352):
                db.add(Restaurante(id=rid,nome='Synthetic campaign race'))
                db.flush()
                cid=str(uuid.uuid4());campaign_id=str(uuid.uuid4())
                db.add(ConfiguracaoRestaurante(restaurante_id=rid))
                db.add(Cliente(id=cid,restaurante_id=rid,nome='Fixture',telefone='5511999999999'))
                db.add(CrmCampanha(id=campaign_id,restaurante_id=rid,nome='Fixture campaign',objetivo='CUSTOM',segmento_filtro='ALL',abordagem_tipo='SEM_DESCONTO',template_mensagem='Mensagem de teste isolada',status='EM_EXECUCAO'))
                db.flush()
                db.add(CrmClientePreferencia(restaurante_id=rid,cliente_id=cid,whatsapp_marketing_opt_in=True,
                    whatsapp_interaction_at=now-dt.timedelta(days=1),whatsapp_interaction_phone_hash=recipient_fingerprint(rid,'5511999999999')))
                snapshots.append({'restaurante_id':rid,'event_id':str(uuid.uuid4()),'payload':{'customer_id':cid,'campaign_id':campaign_id}})
            state=lock_sender(db,cfg)
            state.campaign_day=now.astimezone(OPERATIONAL_TIMEZONE).date().isoformat()
            state.campaign_attempts=4
            db.commit()
        start=threading.Barrier(2)
        def reserve(snapshot):
            with Session(engine) as db:
                start.wait(timeout=5)
                try:
                    state=lock_sender(db,cfg)
                    reserve_campaign(db,snapshot,state)
                    db.commit();return 202
                except HTTPException as exc:
                    db.rollback();return exc.status_code
                except CampaignDeferred:
                    db.rollback();return 429
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(reserve,snapshots))
        assert sorted(results)==[202,429]
        with Session(engine) as db:
            from app.services.whatsapp_sender_gate import _key
            assert db.get(CentralWhatsAppSenderState,_key(cfg)).campaign_attempts==5
            assert db.query(CrmClientePreferencia).filter(CrmClientePreferencia.restaurante_id.in_([9351,9352]),CrmClientePreferencia.whatsapp_campaign_last_sent_at.is_not(None)).count()==1
    finally:
        engine.dispose()
