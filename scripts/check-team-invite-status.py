"""Run only against the disposable PostgreSQL migration gate database."""
import os
from sqlalchemy import create_engine, text

engine = create_engine(os.environ['DATABASE_URL'])
with engine.connect() as db:
    transaction = db.begin()
    try:
        for tenant in (1, 12):
            db.execute(text("""INSERT INTO public.signup_notifications
                (id, payload_encrypted, status, attempts, next_attempt_at, expires_at)
                VALUES (:id, 'disposable-test', 'pending', 0, now(), now()+interval '1 hour')"""),
                {'id': f'team-{tenant}-isolation-test:invite:email'})
        db.execute(text('SET LOCAL ROLE koma_app'))
        email_id = '00000000-0000-0000-0000-000000000001'
        db.execute(text("SELECT koma_internal.record_email_delivery_event(:id,'delivered',now())"), {'id': email_id})
        db.execute(text("SELECT koma_internal.record_email_acceptance(:id,:notification)"),
            {'id': email_id, 'notification': 'team-1-isolation-test:invite:email'})
        db.execute(text("SELECT koma_internal.record_email_delivery_event(:id,'sent',now()+interval '1 minute')"), {'id': email_id})
        assert not db.execute(text("SELECT has_table_privilege(current_user,'public.email_delivery_receipts','SELECT')")).scalar_one()
        db.execute(text("SELECT set_config('app.current_restaurante_id', '1', true)"))
        rows = db.execute(text('SELECT * FROM koma_internal.team_invite_delivery_status()')).mappings().all()
        assert [row['id'] for row in rows] == ['team-1-isolation-test:invite:email']
        assert rows[0]['delivery_status'] == 'delivered'
        db.execute(text("SELECT set_config('app.current_restaurante_id', '12', true)"))
        assert db.execute(text('SELECT id FROM koma_internal.team_invite_delivery_status()')).scalar_one() == 'team-12-isolation-test:invite:email'
        db.execute(text("SELECT set_config('app.current_restaurante_id', '', true)"))
        assert db.execute(text('SELECT * FROM koma_internal.team_invite_delivery_status()')).all() == []
        assert not db.execute(text("SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE n.nspname='koma_internal' AND p.proname='team_invite_delivery_status' AND a.grantee=0 AND a.privilege_type='EXECUTE')")).scalar_one()
    finally:
        transaction.rollback()
print('Team invitation delivery metadata is isolated by tenant')
