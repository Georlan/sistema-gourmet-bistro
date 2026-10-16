"""Real RLS and concurrent shared-sender reservation, only on disposable localhost PG."""
import concurrent.futures
import datetime as dt
import os
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.services.central_whatsapp import CentralConfiguration
from app.services.whatsapp_sender_gate import lock_sender, wait_until

URL = os.getenv('KOMA_SECURITY_TEST_DATABASE_URL', '')
pytestmark = pytest.mark.skipif(not URL, reason='Requires disposable local PostgreSQL security database')


@pytest.fixture
def pg():
    url = make_url(URL)
    assert url.host in {'127.0.0.1','localhost'} and url.database == 'koma_security'
    engine = create_engine(URL)
    yield engine
    engine.dispose()


def test_opt_out_rls_and_browser_roles(pg):
    digest = uuid.uuid4().hex * 2
    with pg.connect() as conn:
        tx = conn.begin()
        for rid in (991701,991702):
            conn.execute(text("INSERT INTO restaurantes(id,nome,plano,billing_mode,saas_status) VALUES (:rid,'Synthetic WA RLS','pocket','legacy','active')"), {'rid':rid})
            conn.execute(text("INSERT INTO whatsapp_contact_opt_outs(restaurante_id,phone_hash,created_at) VALUES (:rid,:hash,now())"), {'rid':rid,'hash':digest})
        conn.execute(text('SET LOCAL ROLE koma_app'))
        conn.execute(text("SELECT set_config('app.current_restaurante_id','991701',true)"))
        assert conn.execute(text('SELECT restaurante_id FROM whatsapp_contact_opt_outs')).scalars().all() == [991701]
        with pytest.raises(Exception):
            with conn.begin_nested():
                conn.execute(text('INSERT INTO whatsapp_contact_opt_outs(restaurante_id,phone_hash,created_at) VALUES (991702,:hash,now())'), {'hash':uuid.uuid4().hex*2})
        conn.execute(text("SELECT set_config('app.current_restaurante_id','',true)"))
        assert conn.execute(text('SELECT * FROM whatsapp_contact_opt_outs')).all() == []
        conn.execute(text('RESET ROLE'))
        for role in ('anon','authenticated'):
            assert not conn.execute(text("SELECT has_table_privilege(:role,'public.whatsapp_contact_opt_outs','SELECT')"), {'role':role}).scalar()
            assert not conn.execute(text("SELECT has_table_privilege(:role,'public.central_whatsapp_sender_state','SELECT')"), {'role':role}).scalar()
        tx.rollback()


def test_two_tenants_share_one_atomic_business_slot(pg):
    cfg = CentralConfiguration(frozenset({991701,991702}), '5511888888888', 'synthetic-'+uuid.uuid4().hex)
    def reserve(rid):
        with Session(pg) as db:
            db.execute(text('SET LOCAL ROLE koma_app'))
            db.execute(text("SELECT set_config('app.current_restaurante_id',:rid,true)"), {'rid':str(rid)})
            state = lock_sender(db,cfg)
            if wait_until(state):
                db.rollback()
                return False
            state.next_send_at = dt.datetime.now(dt.timezone.utc)+dt.timedelta(seconds=15)
            db.commit()
            return True
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(reserve,[991701,991702])) == [False,True]
    finally:
        from app.services.whatsapp_sender_gate import _key
        with pg.begin() as conn:
            conn.execute(text('DELETE FROM central_whatsapp_sender_state WHERE sender_key=:key'), {'key':_key(cfg)})
