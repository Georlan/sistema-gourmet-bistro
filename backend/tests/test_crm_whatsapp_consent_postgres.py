"""Real FORCE RLS and two incoming receipts competing for one challenge."""
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlsplit,parse_qs
import pytest
from sqlalchemy import create_engine,text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session
from app.database import TenantSession
from app.models import Restaurante,Cliente,ConfiguracaoRestaurante
from app.crm_models import CrmClientePreferencia
from app.services import whatsapp_marketing_consent as consent


def test_authenticated_consent_persists_under_rls_and_consumes_challenge_once(monkeypatch):
    url=os.getenv('CRM_POSTGRES_TEST_URL')
    if not url:pytest.skip('Requires disposable local PostgreSQL via CRM_POSTGRES_TEST_URL')
    assert make_url(url).host in {'localhost','127.0.0.1'}
    for key,value in {
        'KOMA_CENTRAL_WA_ENABLED':'true','KOMA_CENTRAL_WA_ALLOWED_RESTAURANT_IDS':'9411,9412',
        'KOMA_CENTRAL_WA_INSTANCE_NAME':'consent-pg-fixture','KOMA_CENTRAL_WA_SENDER_PHONE':'5511888888888',
        'KOMA_CENTRAL_WA_CONSENT_ENABLED':'true','KOMA_CENTRAL_WA_CONSENT_RESTAURANT_IDS':'9411',
        'KOMA_CENTRAL_WA_INBOUND_SECRET':'x'*48,
    }.items():monkeypatch.setenv(key,value)
    admin=create_engine(url)
    runtime=create_engine(make_url(url).set(username='koma_app',password='crm-runtime-test-only'))
    try:
        with admin.connect() as c:
            flags=c.execute(text("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='crm_clientes_preferencias'")).one()
            assert all(flags), 'Run the real CRM migrations before this proof'
        with Session(admin) as db:
            for rid in (9411,9412):
                db.add(Restaurante(id=rid,nome=f'Consent fixture {rid}'));db.flush()
                db.add(Cliente(id=f'consent-client-{rid}',restaurante_id=rid,nome='Fixture',telefone='5511999997777'))
                db.add(ConfiguracaoRestaurante(restaurante_id=rid));db.flush()
                db.add(CrmClientePreferencia(restaurante_id=rid,cliente_id=f'consent-client-{rid}'))
            db.commit()
        with TenantSession(bind=runtime,restaurante_id=9411) as db:
            invite=consent.prepare_invitation(db,9411,'consent-client-9411');db.commit()
            assert db.query(CrmClientePreferencia).filter_by(restaurante_id=9412).count()==0
        token=urlsplit(invite['url']).fragment
        with TenantSession(bind=runtime) as db:
            preview=consent.preview_invitation(db,token)
        body=parse_qs(urlsplit(preview['whatsapp_url']).query)['text'][0]
        barrier=threading.Barrier(2)
        def confirm(index):
            payload={'event':'messages.upsert','instance':'consent-pg-fixture','sender':'5511888888888@s.whatsapp.net','data':{
                'key':{'fromMe':False,'remoteJid':'5511999997777@s.whatsapp.net','id':f'fixture-receipt-{index}'},
                'messageTimestamp':int(consent.now().timestamp()),'message':{'conversation':body}}}
            with TenantSession(bind=runtime) as db:
                barrier.wait(timeout=5)
                result=consent.process_authenticated_inbound(db,payload)
                assert db.query(CrmClientePreferencia).count()==0  # Temporary tenant scope restored.
                return result
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(confirm,(1,2)))
        assert sorted(results)==[False,True]
        with Session(admin) as db:
            own=db.query(CrmClientePreferencia).filter_by(restaurante_id=9411).one()
            other=db.query(CrmClientePreferencia).filter_by(restaurante_id=9412).one()
            assert own.whatsapp_marketing_opt_in and own.whatsapp_consent_nonce_hash is None
            assert own.whatsapp_marketing_consented_at is not None and own.whatsapp_consent_message_hash
            assert other.whatsapp_marketing_opt_in is False and other.whatsapp_interaction_at is None
    finally:
        runtime.dispose();admin.dispose()
