import datetime as dt
from decimal import Decimal
from types import SimpleNamespace
import pytest
from sqlalchemy import create_engine
from app.config import settings
from app.database import Base, SessionLocal, current_restaurante_id
from app.models import (Restaurante, Usuario, CaixaTurno, Comanda, Categoria, Produto,
    OnlinePaymentIntent, Pagamento, RestaurantDirectPixConfig, DirectPixReceipt, DirectPixFeeInvoice, IntegrationOutbox)
from app.routes.direct_pix import confirm_receipt, ReceiptConfirmation, PendingCancellation, cancel_pending
from app.services.online_payments.service import OnlinePaymentService, OnlinePaymentConfigurationError
from app.services.online_payments.direct_pix import brcode, crc16, normalize_key
from app.services.direct_pix_billing import close_month
from app.saas_billing_models import SaaSSubscription
from app.application.orders.commands import CreateOrderCommand, CustomerInput, OrderItemInput
from app.application.orders.service import OrderApplicationService
from app.domain.orders.types import FulfillmentType, OrderChannel
from fastapi import HTTPException


@pytest.fixture
def db():
    disposable = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(disposable)
    token = current_restaurante_id.set(99420)
    session = SessionLocal(bind=disposable)
    session.add(Restaurante(id=99420,nome='Pix test',plano='pocket'))
    session.add(Usuario(id='direct-pix-user',restaurante_id=99420,nome='Operador',email='direct@example.test',senha_hash='unused',role='admin',cargo='admin',status='ativo'))
    session.flush()
    yield session
    session.close()
    current_restaurante_id.reset(token)
    disposable.dispose()


def order(db, monkeypatch):
    monkeypatch.setattr(settings,'DIRECT_PIX_ENABLED',True)
    monkeypatch.setattr(settings,'ONLINE_PAYMENT_PLAN_FEES_ENABLED',False)
    db.add(Categoria(id='direct-category',restaurante_id=99420,nome='Teste'))
    db.flush()
    db.add(Produto(id='direct-product',restaurante_id=99420,categoria_id='direct-category',nome='Produto',preco=100,ativo=True))
    shift=CaixaTurno(restaurante_id=99420,aberto_por_id='direct-pix-user',saldo_inicial=0,status='aberto')
    config=RestaurantDirectPixConfig(restaurante_id=99420,enabled=True,key_type='email',holder_name='RESTAURANTE',city='FORTALEZA',accepted_by='direct-pix-user',accepted_at=dt.datetime.now(dt.timezone.utc),terms_version='direct-pix-v1')
    config.pix_key='pix@example.com'
    db.add_all([shift,config]);db.commit()
    command=CreateOrderCommand(restaurant_id=99420,channel=OrderChannel.WEB_CARDAPIO,fulfillment=FulfillmentType.PICKUP,
        items=(OrderItemInput(product_id='direct-product',quantity=Decimal('1')),),customer=CustomerInput(name='Cliente'),idempotency_key='direct-test-order',operator_user_id='direct-pix-user',defer_operational_publish=True)
    dto=OrderApplicationService.create_order(db,command,commit=False)
    comanda=db.query(Comanda).filter(Comanda.id==dto.comanda_id).one()
    intent=OnlinePaymentService.create_intent_in_session(db,comanda=comanda,turno=shift,amount=Decimal('100'),idempotency_key='direct-test',provider='direct_pix')
    intent.marketplace_fee=1.79
    db.commit()
    return OnlinePaymentService.ensure_pix_created(db,intent=intent,payer_email=''),shift


def test_brcode_has_valid_structure_and_known_crc_vector():
    assert crc16('123456789')=='29B1'
    payload=brcode(key='pix@example.com',name='Restaurante',city='Fortaleza',amount=Decimal('100.00'),txid='PEDIDO123')
    assert payload.startswith('000201')
    assert '5406100.00' in payload
    assert 'br.gov.bcb.pix' in payload
    assert payload[-8:-4]=='6304'
    assert crc16(payload[:-4])==payload[-4:]
    assert '010212' not in payload  # no false dynamic/single-use claim


@pytest.mark.parametrize('kind,key',[('cpf','11111111111'),('cpf','12345678901'),('phone','85999999999'),('random','not-a-uuid'),('email','broken')])
def test_invalid_keys_are_rejected(kind,key):
    with pytest.raises(ValueError): normalize_key(kind,key)


def test_confirmation_is_manual_transactional_and_idempotent(db,monkeypatch):
    intent,shift=order(db,monkeypatch)
    assert intent.status=='pending' and intent.expires_at is None and intent.fee_settlement=='invoiced'
    assert intent.qr_code and not intent.qr_code_base64
    assert db.query(Pagamento).count()==0
    assert db.query(IntegrationOutbox).count()==0
    payload=ReceiptConfirmation(received_amount='100.00',bank_reference='E'+'1'*31,checked_bank_statement=True)
    result=confirm_receipt(intent.id,payload,db,SimpleNamespace(id='direct-pix-user'))
    assert result=={'status':'approved','already_confirmed':False}
    assert db.query(Pagamento).one().status=='aprovado'
    assert db.query(DirectPixReceipt).one().fee==Decimal('1.79')
    count=db.query(IntegrationOutbox).count()
    assert count>0
    assert confirm_receipt(intent.id,payload,db,SimpleNamespace(id='direct-pix-user'))['already_confirmed']
    assert db.query(Pagamento).count()==1 and db.query(IntegrationOutbox).count()==count
    assert OnlinePaymentService.active_account(db,99420).provider=='direct_pix'


def test_wrong_amount_and_other_tenant_cannot_confirm(db,monkeypatch):
    intent,_=order(db,monkeypatch)
    payload=ReceiptConfirmation(received_amount='99.00',bank_reference='E'+'2'*31,checked_bank_statement=True)
    with pytest.raises(HTTPException) as error: confirm_receipt(intent.id,payload,db,SimpleNamespace(id='direct-pix-user'))
    assert error.value.status_code==422
    token=current_restaurante_id.set(99421)
    try:
        with pytest.raises(HTTPException) as error: confirm_receipt(intent.id,payload,db,SimpleNamespace(id='other'))
        assert error.value.status_code==404
    finally: current_restaurante_id.reset(token)
    assert db.query(Pagamento).count()==0


def test_cash_close_requires_operator_to_resolve_pending_direct_pix(db,monkeypatch):
    intent,shift=order(db,monkeypatch)
    with pytest.raises(OnlinePaymentConfigurationError,match='Pix diretos pendentes'):
        OnlinePaymentService.prepare_shift_for_close(db,restaurant_id=99420,shift_id=shift.id)
    cancel_pending(intent.id,PendingCancellation(checked_no_receipt=True),db,SimpleNamespace(id='direct-pix-user'))
    assert intent.status=='cancelled'
    assert db.query(DirectPixReceipt).count()==0
    assert db.query(Pagamento).count()==0


def test_annual_invoice_only_fees_and_retry_is_same_invoice(db,monkeypatch):
    intent,_=order(db,monkeypatch)
    confirm_receipt(intent.id,ReceiptConfirmation(received_amount='100.00',bank_reference='E'+'3'*31,checked_bank_statement=True),db,SimpleNamespace(id='direct-pix-user'))
    receipt=db.query(DirectPixReceipt).one()
    receipt.confirmed_at=dt.datetime(2025,1,15,tzinfo=dt.timezone.utc)
    db.add(SaaSSubscription(restaurante_id=99420,billing_cycle='annual',status='active',payment_method_type='pix'))
    db.commit()
    monkeypatch.setattr('app.services.direct_pix_billing.tenant_commercial_terms',lambda *_:SimpleNamespace(billing_amount=Decimal('1200')))
    invoice=close_month(db,restaurant_id=99420,period='2025-01');db.commit()
    assert invoice.fees==Decimal('1.79') and invoice.subscription_amount==0
    assert close_month(db,restaurant_id=99420,period='2025-01').id==invoice.id
    assert db.query(DirectPixFeeInvoice).count()==1


def test_bank_reference_cannot_pay_two_orders(db,monkeypatch):
    first,shift=order(db,monkeypatch)
    payload=ReceiptConfirmation(received_amount='100.00',bank_reference='E'+'4'*31,checked_bank_statement=True)
    confirm_receipt(first.id,payload,db,SimpleNamespace(id='direct-pix-user'))
    command=CreateOrderCommand(restaurant_id=99420,channel=OrderChannel.WEB_CARDAPIO,fulfillment=FulfillmentType.PICKUP,
        items=(OrderItemInput(product_id='direct-product',quantity=Decimal('1')),),customer=CustomerInput(name='Segundo'),
        idempotency_key='second-order',operator_user_id='direct-pix-user',defer_operational_publish=True)
    dto=OrderApplicationService.create_order(db,command,commit=False)
    comanda=db.query(Comanda).filter(Comanda.id==dto.comanda_id).one()
    second=OnlinePaymentService.create_intent_in_session(db,comanda=comanda,turno=shift,amount=dto.total,idempotency_key='second',provider='direct_pix')
    db.commit()
    OnlinePaymentService.ensure_pix_created(db,intent=second,payer_email='')
    with pytest.raises(HTTPException) as error:
        confirm_receipt(second.id,payload,db,SimpleNamespace(id='direct-pix-user'))
    assert error.value.status_code==409
    db.refresh(second)
    assert second.status=='pending'
    assert db.query(Pagamento).count()==1


def test_invoice_payment_is_amount_bound_and_does_not_extend_annual(db,monkeypatch):
    from app.services.direct_pix_billing import reconcile_invoice_payment
    sub=SaaSSubscription(restaurante_id=99420,billing_cycle='annual',status='active',payment_method_type='pix',
        current_period_end=dt.datetime(2027,1,1,tzinfo=dt.timezone.utc))
    row=DirectPixFeeInvoice(restaurante_id=99420,period='2025-01',fees=Decimal('179'),subscription_amount=0,status='open',provider_payment_id='invoice-payment')
    db.add_all([sub,row]);db.commit()
    initial_end=sub.current_period_end
    payment={'id':'invoice-payment','status':'approved','external_reference':f'KOMA-FEE-99420-{row.id}',
        'currency_id':'BRL','payment_method_id':'pix','transaction_amount':178.99}
    with pytest.raises(ValueError,match='diverge'): reconcile_invoice_payment(db,restaurant_id=99420,invoice_id=row.id,payment=payment)
    assert row.status=='open'
    payment['transaction_amount']=179
    assert reconcile_invoice_payment(db,restaurant_id=99420,invoice_id=row.id,payment=payment)
    db.commit()
    assert row.status=='paid' and sub.current_period_end==initial_end
    assert reconcile_invoice_payment(db,restaurant_id=99420,invoice_id=row.id,payment=payment)


def test_migration_preserves_existing_mp_and_rolls_back_empty_direct_data(monkeypatch):
    import importlib.util
    from pathlib import Path
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import MetaData, CheckConstraint, inspect, text
    copy=MetaData()
    for table in Base.metadata.sorted_tables:
        if table.name not in {'restaurant_direct_pix_configs','direct_pix_receipts','direct_pix_fee_invoices'}:
            table.to_metadata(copy)
    intent=copy.tables['online_payment_intents']
    intent._columns.remove(intent.c.fee_settlement)
    for constraint in list(intent.constraints):
        if constraint.name=='ck_online_payment_intents_provider': intent.constraints.remove(constraint)
    intent.append_constraint(CheckConstraint("provider IN ('mercado_pago')",name='ck_online_payment_intents_provider'))
    disposable=create_engine('sqlite:///:memory:')
    copy.create_all(disposable)
    path=Path(__file__).parents[1]/'alembic/versions/d1e2f3a4b5c6_direct_pix.py'
    spec=importlib.util.spec_from_file_location('direct_pix_migration',path)
    migration=importlib.util.module_from_spec(spec);spec.loader.exec_module(migration)
    with disposable.begin() as conn:
        monkeypatch.setattr(migration,'op',Operations(MigrationContext.configure(conn)))
        migration.upgrade()
        assert 'fee_settlement' in {c['name'] for c in inspect(conn).get_columns('online_payment_intents')}
        assert 'direct_pix_receipts' in inspect(conn).get_table_names()
        migration.downgrade()
        assert 'fee_settlement' not in {c['name'] for c in inspect(conn).get_columns('online_payment_intents')}
        assert 'direct_pix_receipts' not in inspect(conn).get_table_names()
    disposable.dispose()


def test_postgres_migration_rls_and_legacy_tenant_preservation(monkeypatch):
    import os
    import importlib.util
    from pathlib import Path
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import text
    url=os.getenv('DIRECT_PIX_TEST_POSTGRES_URL')
    if not url:
        pytest.skip('requires disposable local PostgreSQL')
    if '127.0.0.1' not in url or 'koma_direct_pix_test' not in url:
        raise RuntimeError('PostgreSQL test must be local and disposable')
    pg=create_engine(url)
    with pg.begin() as conn:
        conn.execute(text('CREATE ROLE koma_app NOLOGIN'))
        conn.execute(text('CREATE TABLE restaurantes (id integer PRIMARY KEY)'))
        conn.execute(text("CREATE TABLE online_payment_intents (id varchar(36) PRIMARY KEY, restaurante_id integer NOT NULL, provider varchar(32) NOT NULL, CONSTRAINT ck_online_payment_intents_provider CHECK(provider IN ('mercado_pago')))"))
        conn.execute(text("INSERT INTO restaurantes VALUES (6),(99420),(99421)"))
        conn.execute(text("INSERT INTO online_payment_intents VALUES ('legacy-mp-6',6,'mercado_pago')"))
        path=Path(__file__).parents[1]/'alembic/versions/d1e2f3a4b5c6_direct_pix.py'
        spec=importlib.util.spec_from_file_location('direct_pix_pg_migration',path)
        migration=importlib.util.module_from_spec(spec);spec.loader.exec_module(migration)
        monkeypatch.setattr(migration,'op',Operations(MigrationContext.configure(conn)))
        migration.upgrade()
        legacy=conn.execute(text("SELECT provider,fee_settlement FROM online_payment_intents WHERE id='legacy-mp-6'")).one()
        assert legacy==('mercado_pago',None)
        conn.execute(text("INSERT INTO restaurant_direct_pix_configs VALUES (99420,true,'email','encrypted','TEST','CITY','operator',now(),'direct-pix-v1')"))
        conn.execute(text("INSERT INTO restaurant_direct_pix_configs VALUES (99421,true,'email','encrypted2','TEST2','CITY2','operator2',now(),'direct-pix-v1')"))
    with pg.begin() as conn:
        conn.execute(text('SET LOCAL ROLE koma_app'))
        conn.execute(text("SELECT set_config('app.current_restaurante_id','99420',true)"))
        assert conn.execute(text('SELECT restaurante_id FROM restaurant_direct_pix_configs')).scalars().all()==[99420]
        assert conn.execute(text('UPDATE restaurant_direct_pix_configs SET enabled=false WHERE restaurante_id=99421')).rowcount==0
        from sqlalchemy.exc import DBAPIError
        with pytest.raises(DBAPIError):
            with conn.begin_nested():
                conn.execute(text("INSERT INTO direct_pix_fee_invoices VALUES ('wrong',99421,'2025-01',null,null,null,null,0,0,'open',now())"))
    # Container is disposable, but leave the database clean for repeatability.
    with pg.begin() as conn:
        conn.execute(text('DROP TABLE direct_pix_receipts, direct_pix_fee_invoices, restaurant_direct_pix_configs, online_payment_intents, restaurantes CASCADE'))
        conn.execute(text('DROP ROLE koma_app'))
    pg.dispose()


def test_kill_switch_never_redirects_direct_sales_to_mercado_pago(db,monkeypatch):
    from app.models import RestaurantPaymentAccount
    intent,_=order(db,monkeypatch)
    mp=RestaurantPaymentAccount(restaurante_id=99420,provider='mercado_pago',status='active')
    mp.access_token='test-token';mp.webhook_secret='test-secret'
    db.add(mp);db.commit()
    monkeypatch.setattr(settings,'DIRECT_PIX_ENABLED',False)
    assert not OnlinePaymentService.has_active_account(db,99420)
    with pytest.raises(OnlinePaymentConfigurationError,match='temporariamente indisponível'):
        OnlinePaymentService.active_account(db,99420)
    # A pending transfer can still be resolved safely without accepting new direct orders.
    result=confirm_receipt(intent.id,ReceiptConfirmation(received_amount='100.00',bank_reference='E'+'5'*31,checked_bank_statement=True),db,SimpleNamespace(id='direct-pix-user'))
    assert result['status']=='approved'


def test_invoice_pix_uses_platform_gateway_and_reuses_issued_charge(db,monkeypatch):
    import httpx
    from app.services.direct_pix_billing import create_invoice_pix
    posted=[]
    row=DirectPixFeeInvoice(restaurante_id=99420,period='2025-01',fees=Decimal('179'),subscription_amount=0,status='open')
    db.add(row);db.commit()
    reference=f'KOMA-FEE-99420-{row.id}'
    payment={'id':'fee-payment','status':'pending','external_reference':reference,'transaction_amount':179,
        'currency_id':'BRL','payment_method_id':'pix','point_of_interaction':{'transaction_data':{'qr_code':'pix-test'}}}
    class FakePlatformGateway:
        is_mock=False
        def _ensure_provider_ready(self): pass
        def _validate_merchant_identity(self,payment): pass
        def _client(self):
            def handler(request):
                posted.append(request)
                return httpx.Response(201,json=payment)
            return httpx.Client(base_url='https://api.mercadopago.com',transport=httpx.MockTransport(handler))
        def get_payment(self,payment_id):
            assert payment_id=='fee-payment'
            return payment
    monkeypatch.setattr('app.services.saas_mercadopago.default_saas_mp_service',FakePlatformGateway())
    first=create_invoice_pix(db,restaurant_id=99420,invoice_id=row.id,payer_email='admin@example.com')
    second=create_invoice_pix(db,restaurant_id=99420,invoice_id=row.id,payer_email='admin@example.com')
    assert first==second and first['amount']=='179.00'
    assert len(posted)==1 and posted[0].headers['X-Idempotency-Key']
    assert row.status=='open'
    payment['status']='approved'
    assert create_invoice_pix(db,restaurant_id=99420,invoice_id=row.id,payer_email='admin@example.com')['status']=='approved'
    assert row.status=='paid'


def test_monthly_pix_invoice_combines_one_fixed_installment_with_fees(db,monkeypatch):
    intent,_=order(db,monkeypatch)
    confirm_receipt(intent.id,ReceiptConfirmation(received_amount='100.00',bank_reference='E'+'6'*31,checked_bank_statement=True),db,SimpleNamespace(id='direct-pix-user'))
    db.query(DirectPixReceipt).one().confirmed_at=dt.datetime(2025,1,31,20,tzinfo=dt.timezone.utc)
    db.add(SaaSSubscription(restaurante_id=99420,billing_cycle='monthly',status='active',payment_method_type='pix',
        current_period_end=dt.datetime(2025,2,15,tzinfo=dt.timezone.utc)))
    db.commit()
    monkeypatch.setattr('app.services.direct_pix_billing.tenant_commercial_terms',lambda *_:SimpleNamespace(billing_amount=Decimal('99')))
    invoice=close_month(db,restaurant_id=99420,period='2025-01');db.commit()
    assert invoice.fees==Decimal('1.79') and invoice.subscription_amount==Decimal('99')
    assert invoice.fees+invoice.subscription_amount==Decimal('100.79')
    assert close_month(db,restaurant_id=99420,period='2025-01').id==invoice.id
