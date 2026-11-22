from __future__ import annotations

import datetime
import json
import logging
from decimal import Decimal
from types import SimpleNamespace

import httpx
import pytest
from fastapi import BackgroundTasks, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.adapters.orders.web_adapter import validate_pix_payer_email
from app.config import settings
from app.database import Base, SessionLocal, current_restaurante_id, get_db
from app.main import app
from app.models import (
    CaixaTurno,
    Categoria,
    Comanda,
    Insumo,
    Item,
    Lancamento,
    MovimentacaoEstoque,
    OnlinePaymentIntent,
    OnlinePaymentWebhookEvent,
    Pagamento,
    Produto,
    Restaurante,
    RestaurantDirectPixConfig,
    RestaurantPaymentAccount,
    Usuario,
)
from app.online_order_control_models import OnlineOrderOperationalAudit
from app.routes.financial_cash_routes import ReconciledCloseRequest, fechar_turno_reconciliado
from app.security import create_access_token
from app.services.inventory import SALE_ORIGIN, SALE_REVERSAL_ORIGIN
from app.services.online_payments import OnlinePaymentService
from app.services.online_payments.base import ProviderPayment
from app.services.online_payments.pagbank.provider import PagBankError, PagBankProvider
from app.services.online_payments.pending_review import (
    classify_intent,
    parse_intent_error,
)

RID_A = 98101
RID_B = 98102


@pytest.fixture()
def isolated_env(monkeypatch):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)

    def override_get_db():
        session = SessionLocal(bind=engine)
        try:
            yield session
        finally:
            session.close()

    prev_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(settings, "DIRECT_PIX_ENABLED", True)
    monkeypatch.setattr(
        "app.services.billing_service.tenant_commercial_terms",
        lambda *_args, **_kwargs: SimpleNamespace(
            plan_name="Pro",
            billing_cycle="monthly",
            billing_amount=Decimal("99.00"),
            marketplace_fee_percent=Decimal("0.00"),
        ),
    )

    seed = SessionLocal(bind=engine)
    try:
        for rid, name in ((RID_A, "Restaurante Alpha"), (RID_B, "Restaurante Beta")):
            token = current_restaurante_id.set(rid)
            try:
                seed.add(
                    Restaurante(
                        id=rid,
                        nome=name,
                        plano="pro",
                        saas_status="active",
                        formas_pagamento_aceitas=["Pix", "Dinheiro"],
                    )
                )
                for role in ("admin", "gerente", "caixa", "garcom", "cozinha", "atendente"):
                    seed.add(
                        Usuario(
                            id=f"user-{rid}-{role}",
                            nome=f"{role.title()} {rid}",
                            cargo=role,
                            status="ativo",
                            restaurante_id=rid,
                            senha_hash="not-used-in-jwt-test",
                        )
                    )
                seed.add(Categoria(id=f"cat-{rid}", restaurante_id=rid, nome="Pratos"))
                seed.add(
                    Produto(
                        id=f"prod-{rid}",
                        restaurante_id=rid,
                        nome="Prato Executivo",
                        categoria_id=f"cat-{rid}",
                        preco=Decimal("4.50"),
                    )
                )
            finally:
                current_restaurante_id.reset(token)
        seed.commit()
    finally:
        seed.close()

    try:
        yield engine, TestClient(app)
    finally:
        if prev_override is not None:
            app.dependency_overrides[get_db] = prev_override
        else:
            app.dependency_overrides.pop(get_db, None)
        Base.metadata.drop_all(engine)
        engine.dispose()


def _auth_headers(rid: int, role: str = "admin") -> dict[str, str]:
    token = create_access_token(
        subject=f"user-{rid}-{role}",
        restaurante_id=rid,
        role=role,
    )
    return {"Authorization": f"Bearer {token}"}


def _seed_shift(engine, rid: int = RID_A, *, status: str = "aberto") -> CaixaTurno:
    session = SessionLocal(bind=engine)
    token = current_restaurante_id.set(rid)
    try:
        shift = CaixaTurno(
            restaurante_id=rid,
            aberto_por_id=f"user-{rid}-admin",
            saldo_inicial=100.0,
            status=status,
            aberto_em=datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=1),
        )
        session.add(shift)
        session.commit()
        session.refresh(shift)
        return shift
    finally:
        current_restaurante_id.reset(token)
        session.close()


def _seed_bank_account(
    engine,
    rid: int = RID_A,
    *,
    provider: str = "pagbank",
    status: str = "active",
) -> RestaurantPaymentAccount:
    session = SessionLocal(bind=engine)
    token = current_restaurante_id.set(rid)
    try:
        acc = RestaurantPaymentAccount(
            id=f"acc-{rid}-{provider}",
            restaurante_id=rid,
            provider=provider,
            provider_user_id=f"seller-{rid}-{provider}",
            provider_environment="production",
            access_token="encrypted-fake-token",
            refresh_token="encrypted-fake-refresh",
            webhook_secret="test-webhook-secret",
            status=status,
        )
        session.add(acc)
        session.commit()
        session.refresh(acc)
        return acc
    finally:
        current_restaurante_id.reset(token)
        session.close()


def _seed_pix_intent(
    engine,
    *,
    rid: int = RID_A,
    turno_id: int,
    suffix: str,
    order_number: int,
    amount: Decimal = Decimal("4.50"),
    provider: str = "pagbank",
    status: str = "error",
    last_error: str | None = None,
    external_payment_id: str | None = None,
    qr_code: str | None = None,
    reconciliation_attempted_at: datetime.datetime | None = None,
    age_minutes: int = 20,
    with_stock_outflow: bool = False,
) -> tuple[str, str]:
    session = SessionLocal(bind=engine)
    token = current_restaurante_id.set(rid)
    try:
        created_at = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=age_minutes)
        cmd = Comanda(
            id=f"cmd-{rid}-{suffix}",
            restaurante_id=rid,
            garcom_id=f"user-{rid}-admin",
            numero_pedido=order_number,
            tipo="Retirada",
            identificador=f"Pedido Teste {order_number}",
            fechada=False,
            criado_em=created_at,
            delivery_status="pendente",
            delivery_forma_pagamento="pix",
            online_payment_status="pending",
            valor_pago=0,
        )
        launch = Lancamento(
            id=f"lnc-{rid}-{suffix}",
            restaurante_id=rid,
            comanda_id=cmd.id,
            garcom_id=f"user-{rid}-admin",
            origem="cardapio",
            status="pendente",
            timestamp=created_at,
        )
        item = Item(
            id=f"itm-{rid}-{suffix}",
            restaurante_id=rid,
            comanda_id=cmd.id,
            lancamento_id=launch.id,
            produto_id=f"prod-{rid}",
            preco_unit=float(amount),
            status="preparando",
        )
        session.add_all([cmd, launch, item])
        session.flush()

        if with_stock_outflow:
            insumo = Insumo(
                id=f"ins-{rid}-{suffix}",
                restaurante_id=rid,
                nome="Insumo Teste",
                estoque_atual=9.0,
                estoque_minimo=1.0,
                estoque_maximo=50.0,
                unidade_medida="un",
            )
            session.add(insumo)
            session.flush()
            session.add(
                MovimentacaoEstoque(
                    restaurante_id=rid,
                    insumo_id=insumo.id,
                    tipo="saida",
                    quantidade=1.0,
                    saldo_anterior=10.0,
                    saldo_posterior=9.0,
                    motivo="Venda Cardápio Online",
                    origem=SALE_ORIGIN,
                    referencia_id=item.id,
                    usuario_id=f"user-{rid}-admin",
                )
            )

        intent = OnlinePaymentIntent(
            id=f"int-{rid}-{suffix}",
            restaurante_id=rid,
            comanda_id=cmd.id,
            turno_id=turno_id,
            provider=provider,
            method="pix",
            status=status,
            amount=amount,
            marketplace_fee=Decimal("0.00"),
            fee_settlement="none",
            idempotency_key=f"idem-{rid}-{suffix}",
            external_payment_id=external_payment_id,
            qr_code=qr_code,
            reconciliation_attempted_at=reconciliation_attempted_at,
            created_at=created_at,
            last_error=last_error,
        )
        session.add(intent)
        session.commit()
        return cmd.id, intent.id
    finally:
        current_restaurante_id.reset(token)
        session.close()


def test_1_2_pagbank_http_400_and_403_creation_failures_classified_and_provider_tagged(isolated_env):
    engine, client = isolated_env
    shift = _seed_shift(engine)
    _seed_bank_account(engine, provider="pagbank")

    _, intent_400 = _seed_pix_intent(
        engine,
        turno_id=shift.id,
        suffix="p116",
        order_number=116,
        last_error="PagBank recusou a operação (HTTP 400). Código: 40002. Referência PagBank: 6f5f628f-4004-4d7f-ad46-ba6258b987f7.",
    )
    _, intent_403 = _seed_pix_intent(
        engine,
        turno_id=shift.id,
        suffix="p103",
        order_number=103,
        last_error="PagBank recusou a criação/consulta da cobrança (HTTP 403). Verifique a liberação da API Order/Pix e as permissões da aplicação e da conta conectada.",
    )

    res = client.get("/payments/pending-review", headers=_auth_headers(RID_A))
    assert res.status_code == 200
    items = {row["id"]: row for row in res.json()["items"]}

    item_400 = items[intent_400]
    assert item_400["situation"] == "creation_failed"
    assert item_400["situation_label"] == "Falha na criação da cobrança"
    assert item_400["can_close_creation_failure"] is True
    assert item_400["can_reconcile"] is False
    assert item_400["provider_code"] == "40002"
    assert item_400["provider_request_id"] == "6f5f628f-4004-4d7f-ad46-ba6258b987f7"

    item_403 = items[intent_403]
    assert item_403["situation"] == "creation_failed"
    assert item_403["http_status"] == 403
    assert item_403["can_close_creation_failure"] is True

    # Also prove new HTTP 400 from PagBankProvider tags create_refused metadata without PII
    transport = httpx.MockTransport(
        lambda _req: httpx.Response(
            400,
            headers={"x-request-id": "req-400-test"},
            json={"error_messages": [{"code": "40002", "parameter_name": "charges[0].amount", "description": "buyer@secret.com"}]},
        )
    )
    prov = PagBankProvider("secret-token", environment="production")
    prov._client = httpx.Client(base_url="https://api.pagseguro.com", transport=transport)
    with pytest.raises(PagBankError) as exc_info:
        prov.create_pix(
            amount=Decimal("4.50"),
            marketplace_fee=Decimal("0.00"),
            payer_email="comprador@valido.com",
            external_reference="int-meta-test",
            idempotency_key="idem-meta-test",
            notification_url="https://api.example.com/hook",
            expires_at=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=30),
            payer_name="Cliente Teste",
            payer_tax_id="12345678909",
        )
    assert exc_info.value.error_stage == "create_refused"
    assert exc_info.value.provider_code == "40002"
    assert exc_info.value.provider_request_id == "req-400-test"
    assert "buyer@secret.com" not in str(exc_info.value)


def test_3_invalid_email_rejected_and_customer_email_400_auto_closed_without_orphan(isolated_env, monkeypatch):
    engine, client = isolated_env
    shift = _seed_shift(engine)
    _seed_bank_account(engine, provider="pagbank")

    # Preflight validation blocks invalid emails for automatic Pix providers
    for bad_email in ("sem-arroba", "a@b.c", "x @exemplo.com", "joão@exemplo.com"):
        with pytest.raises(HTTPException) as exc:
            validate_pix_payer_email("pagbank", bad_email)
        assert exc.value.status_code == 422
    assert validate_pix_payer_email("pagbank", " Cliente@USP.br ") == "cliente@usp.br"

    # Legacy order #42 message classifies safely as creation_failed
    _, legacy_42 = _seed_pix_intent(
        engine,
        turno_id=shift.id,
        suffix="p42",
        order_number=42,
        last_error="E-mail do comprador rejeitado pelo PagBank.",
    )
    res = client.get("/payments/pending-review", headers=_auth_headers(RID_A))
    row_42 = next(r for r in res.json()["items"] if r["id"] == legacy_42)
    assert row_42["situation"] == "creation_failed"
    assert row_42["can_close_creation_failure"] is True

    # New PagBank 400 customer.email refusal in ensure_pix_created auto-closes cleanly
    cmd_id, intent_id = _seed_pix_intent(
        engine,
        turno_id=shift.id,
        suffix="emailreject",
        order_number=942,
        status="created",
        with_stock_outflow=True,
    )
    monkeypatch.setattr(
        PagBankProvider,
        "create_pix",
        lambda *_a, **_kw: (_ for _ in ()).throw(
            PagBankError(
                "E-mail do comprador rejeitado pelo PagBank.",
                reason="customer_email_rejected",
                status_code=400,
                error_stage="create_refused",
                provider_code="40002",
                provider_parameter="customer.email",
            )
        ),
    )

    session = SessionLocal(bind=engine)
    token = current_restaurante_id.set(RID_A)
    try:
        intent = session.query(OnlinePaymentIntent).filter(OnlinePaymentIntent.id == intent_id).one()
        with pytest.raises(PagBankError):
            OnlinePaymentService.ensure_pix_created(
                session,
                intent=intent,
                payer_email="comprador@recusado.com",
                payer_name="Comprador Teste",
                payer_tax_id="12345678909",
            )
        session.expire_all()
        reloaded_intent = session.query(OnlinePaymentIntent).filter(OnlinePaymentIntent.id == intent_id).one()
        reloaded_cmd = session.query(Comanda).filter(Comanda.id == cmd_id).one()
        audit = session.query(OnlineOrderOperationalAudit).filter(
            OnlineOrderOperationalAudit.restaurante_id == RID_A,
            OnlineOrderOperationalAudit.action == "online_payment_creation_refused_auto_closed",
        ).one()
        assert reloaded_intent.status == "cancelled"
        assert reloaded_cmd.fechada is True
        assert reloaded_cmd.online_payment_status == "cancelled"
        assert audit.after_data["intent_id"] == intent_id
        assert session.query(MovimentacaoEstoque).filter(MovimentacaoEstoque.origem == SALE_REVERSAL_ORIGIN).count() == 1
    finally:
        current_restaurante_id.reset(token)
        session.close()


def test_4_5_6_missing_external_id_uncertain_query_failed_and_real_pending(isolated_env, monkeypatch):
    engine, client = isolated_env
    shift = _seed_shift(engine)
    _seed_bank_account(engine, provider="pagbank")

    _, i_creation = _seed_pix_intent(
        engine,
        turno_id=shift.id,
        suffix="c400",
        order_number=201,
        last_error="PagBank recusou a operação (HTTP 400). Código: 40002.",
    )
    _, i_uncertain = _seed_pix_intent(
        engine,
        turno_id=shift.id,
        suffix="u500",
        order_number=202,
        last_error="Resposta PagBank indisponível ou inválida. [meta:stage=create_uncertain]",
    )
    _, i_blank_error = _seed_pix_intent(
        engine,
        turno_id=shift.id,
        suffix="ublk",
        order_number=203,
        last_error=None,
    )
    _, i_created_only = _seed_pix_intent(
        engine,
        turno_id=shift.id,
        suffix="ucrt",
        order_number=204,
        status="created",
        last_error=None,
    )
    _, i_query_fail = _seed_pix_intent(
        engine,
        turno_id=shift.id,
        suffix="qfail",
        order_number=205,
        status="pending",
        external_payment_id="ORDE_QFAIL_205",
        qr_code="000201pix",
        reconciliation_attempted_at=datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=5),
        last_error="Consulta financeira indisponível ou divergente; revisão necessária. [meta:stage=reconcile_failed;http=503]",
    )
    _, i_awaiting = _seed_pix_intent(
        engine,
        turno_id=shift.id,
        suffix="wait",
        order_number=206,
        status="pending",
        external_payment_id="ORDE_WAIT_206",
        qr_code="000201pixwait",
        age_minutes=90,
    )

    # Without external_payment_id reconcile rejects with clear 409
    r_rec_fail = client.post(f"/payments/pending-review/{i_creation}/reconcile", headers=_auth_headers(RID_A))
    assert r_rec_fail.status_code == 409
    assert r_rec_fail.json()["detail"]["code"] == "CREATION_FAILURE_RECONCILE_NOT_NEEDED"

    r_rec_unc = client.post(f"/payments/pending-review/{i_uncertain}/reconcile", headers=_auth_headers(RID_A))
    assert r_rec_unc.status_code == 409
    assert r_rec_unc.json()["detail"]["code"] == "MISSING_EXTERNAL_PAYMENT_ID"

    # Initial classification before shift-close reconciliation
    res_before = client.get("/payments/pending-review", headers=_auth_headers(RID_A))
    assert res_before.status_code == 200
    before_by_id = {item["id"]: item for item in res_before.json()["items"]}
    assert before_by_id[i_query_fail]["situation"] == "provider_query_failed"
    assert before_by_id[i_query_fail]["can_reconcile"] is True
    assert before_by_id[i_query_fail]["can_close_creation_failure"] is False

    # Also ensure prepare_shift_for_close never cancels awaiting or uncertain intents based on time
    session = SessionLocal(bind=engine)
    token = current_restaurante_id.set(RID_A)
    ref_by_ext = {
        "ORDE_QFAIL_205": i_query_fail,
        "ORDE_WAIT_206": i_awaiting,
    }
    monkeypatch.setattr(
        PagBankProvider,
        "get_payment",
        lambda self, pid: ProviderPayment(
            external_id=pid,
            status="pending",
            amount=Decimal("4.50"),
            external_reference=ref_by_ext[pid],
        ),
    )
    try:
        OnlinePaymentService.prepare_shift_for_close(session, restaurant_id=RID_A, shift_id=shift.id)
        for idx in (i_uncertain, i_blank_error, i_created_only, i_awaiting):
            assert session.query(OnlinePaymentIntent).filter(OnlinePaymentIntent.id == idx).one().status in {"error", "created", "pending"}
    finally:
        current_restaurante_id.reset(token)
        session.close()

    res = client.get("/payments/pending-review", headers=_auth_headers(RID_A))
    assert res.status_code == 200
    by_id = {item["id"]: item for item in res.json()["items"]}

    assert by_id[i_uncertain]["situation"] == "uncertain"
    assert by_id[i_uncertain]["can_close_creation_failure"] is False
    assert by_id[i_uncertain]["requires_manual_escalation"] is True

    assert by_id[i_blank_error]["situation"] == "uncertain"
    assert by_id[i_blank_error]["can_close_creation_failure"] is False

    assert by_id[i_created_only]["situation"] == "uncertain"
    assert by_id[i_created_only]["can_close_creation_failure"] is False

    # After successful query on shift-close returning pending, provider_query_failed recovers to awaiting_payment
    assert by_id[i_query_fail]["situation"] == "awaiting_payment"
    assert by_id[i_query_fail]["can_reconcile"] is True
    assert by_id[i_query_fail]["can_close_creation_failure"] is False

    assert by_id[i_awaiting]["situation"] == "awaiting_payment"
    assert by_id[i_awaiting]["can_reconcile"] is True
    assert by_id[i_awaiting]["can_close_creation_failure"] is False


def test_7_8_late_approval_via_reconcile_and_webhook_prevents_duplicate_payment(isolated_env, monkeypatch):
    engine, client = isolated_env
    shift = _seed_shift(engine)
    acc = _seed_bank_account(engine, provider="pagbank")

    cmd_id, intent_id = _seed_pix_intent(
        engine,
        turno_id=shift.id,
        suffix="late",
        order_number=301,
        amount=Decimal("12.00"),
        status="pending",
        external_payment_id="ORDE_LATE_301",
        qr_code="000201pixlate",
    )

    # 9 check before approval: order hidden from operational /comandas/
    ops_before = client.get("/comandas/", headers=_auth_headers(RID_A))
    assert ops_before.status_code == 200
    assert all(c["id"] != cmd_id for c in ops_before.json())

    monkeypatch.setattr(
        PagBankProvider,
        "get_payment",
        lambda self, pid: ProviderPayment(
            external_id=pid,
            status="approved",
            amount=Decimal("12.00"),
            external_reference=intent_id,
        ),
    )

    rec_res = client.post(f"/payments/pending-review/{intent_id}/reconcile", headers=_auth_headers(RID_A))
    assert rec_res.status_code == 200
    assert rec_res.json()["approved"] is True
    assert rec_res.json()["item"]["situation"] == "approved"

    # Now order IS visible operationally in /comandas/
    ops_after = client.get("/comandas/", headers=_auth_headers(RID_A))
    assert any(c["id"] == cmd_id for c in ops_after.json())

    # Simulate late duplicate webhook snapshot replay -> idempotent, zero duplicate Pagamento
    session = SessionLocal(bind=engine)
    token = current_restaurante_id.set(RID_A)
    try:
        account_row = session.query(RestaurantPaymentAccount).filter(RestaurantPaymentAccount.id == acc.id).one()
        intent_row = session.query(OnlinePaymentIntent).filter(OnlinePaymentIntent.id == intent_id).one()
        _, newly_approved = OnlinePaymentService.apply_provider_snapshot_in_session(
            session,
            account=account_row,
            intent=intent_row,
            payment=ProviderPayment(
                external_id="ORDE_LATE_301",
                status="approved",
                amount=Decimal("12.00"),
                external_reference=intent_id,
            ),
        )
        session.commit()
        assert newly_approved is False
        assert session.query(Pagamento).filter(
            Pagamento.restaurante_id == RID_A,
            Pagamento.comanda_id == cmd_id,
        ).count() == 1
        cmd_row = session.query(Comanda).filter(Comanda.id == cmd_id).one()
        assert Decimal(str(cmd_row.valor_pago)) == Decimal("12.00")
    finally:
        current_restaurante_id.reset(token)
        session.close()


def test_9_10_caixa_visibility_parity_and_shift_separation(isolated_env):
    engine, client = isolated_env
    old_shift = _seed_shift(engine, status="fechado")
    cur_shift = _seed_shift(engine, status="aberto")
    _seed_bank_account(engine, provider="pagbank")

    # Seed 1 normal open operational order (consumption on table)
    session = SessionLocal(bind=engine)
    token = current_restaurante_id.set(RID_A)
    try:
        op_cmd = Comanda(
            id=f"cmd-{RID_A}-op",
            restaurante_id=RID_A,
            garcom_id=f"user-{RID_A}-admin",
            numero_pedido=500,
            tipo="Delivery",
            identificador="Operacional Aberto",
            fechada=False,
            delivery_status="producao",
            online_payment_status=None,
            valor_pago=0,
        )
        session.add(op_cmd)
        session.commit()
    finally:
        current_restaurante_id.reset(token)
        session.close()

    # Seed 1 current-shift failed Pix (R$ 14.00) and 1 previous-shift failed Pix (R$ 25.00)
    cmd_cur, _ = _seed_pix_intent(
        engine,
        turno_id=cur_shift.id,
        suffix="cur1",
        order_number=501,
        amount=Decimal("14.00"),
        last_error="PagBank recusou a operação (HTTP 400). Código: 40002.",
    )
    cmd_old, _ = _seed_pix_intent(
        engine,
        turno_id=old_shift.id,
        suffix="old1",
        order_number=502,
        amount=Decimal("25.00"),
        last_error="PagBank recusou a criação/consulta da cobrança (HTTP 403).",
    )

    op_list = client.get("/comandas/?fechada=false", headers=_auth_headers(RID_A)).json()
    op_ids = {c["id"] for c in op_list}
    assert op_ids == {f"cmd-{RID_A}-op"}
    assert cmd_cur not in op_ids
    assert cmd_old not in op_ids

    op_detail_ids = {c["id"] for c in client.get("/comandas/detalhes/todos", headers=_auth_headers(RID_A)).json()}
    assert cmd_cur not in op_detail_ids
    assert cmd_old not in op_detail_ids

    resumo = client.get("/caixa/turno-atual/resumo", headers=_auth_headers(RID_A)).json()
    review = client.get("/payments/pending-review", headers=_auth_headers(RID_A)).json()

    assert resumo["comandas_abertas_count"] == len(op_list) == 1
    assert resumo["pendencias_financeiras_count"] == review["summary"]["blocking_count"] == 2
    assert resumo["pendencias_financeiras_turno_atual_count"] == review["summary"]["current_shift_blocking_count"] == 1
    assert resumo["pendencias_financeiras_anteriores_count"] == review["summary"]["previous_shift_blocking_count"] == 1
    assert resumo["pendencias_financeiras_total"] == float(Decimal(review["summary"]["blocking_total_amount"])) == 39.0
    assert resumo["pendencias_financeiras_turno_atual_total"] == 14.0
    assert resumo["total_vendas"] == 0.0
    assert resumo["total_pix"] == 0.0


def test_11_12_13_14_17_structured_409_audited_close_uncertainty_block_and_direct_pix_switch(isolated_env, caplog):
    engine, client = isolated_env
    shift = _seed_shift(engine)
    acc = _seed_bank_account(engine, provider="pagbank")

    cmd_ok, int_ok = _seed_pix_intent(
        engine,
        turno_id=shift.id,
        suffix="ok400",
        order_number=601,
        amount=Decimal("4.50"),
        last_error="PagBank recusou a operação (HTTP 400). Código: 40002. Referência PagBank: req-601.",
        with_stock_outflow=True,
    )
    _, int_uncertain = _seed_pix_intent(
        engine,
        turno_id=shift.id,
        suffix="unc503",
        order_number=602,
        amount=Decimal("6.00"),
        last_error="Resposta PagBank indisponível ou inválida.",
    )
    cmd_hook, int_with_hook = _seed_pix_intent(
        engine,
        turno_id=shift.id,
        suffix="hook",
        order_number=603,
        amount=Decimal("9.00"),
        external_payment_id="ORDE_HOOK_603",
        last_error="PagBank recusou a operação (HTTP 400).",
    )
    session = SessionLocal(bind=engine)
    token = current_restaurante_id.set(RID_A)
    try:
        session.add(
            OnlinePaymentWebhookEvent(
                id="wh-603",
                restaurante_id=RID_A,
                provider="pagbank",
                request_id="req-wh-603",
                external_payment_id="ORDE_HOOK_603",
                status="received",
            )
        )
        session.commit()
    finally:
        current_restaurante_id.reset(token)
        session.close()

    with caplog.at_level(logging.WARNING, logger="koma.online_payments.pending_review"):
        disc_409 = client.post("/payments/pagbank/disconnect", headers=_auth_headers(RID_A))
    assert disc_409.status_code == 409
    detail = disc_409.json()["detail"]
    assert detail["code"] == "PAYMENT_DISCONNECT_BLOCKED"
    assert detail["blocking_count"] == 3
    assert detail["blocking_total_amount"] == "19.50"
    assert detail["categories"]["creation_failed"] == 1
    assert detail["categories"]["uncertain"] == 2
    assert {item["order_number"] for item in detail["blocking_items"]} == {601, 602, 603}
    serialized = json.dumps(detail)
    assert "encrypted-fake-token" not in serialized
    assert "@" not in serialized

    # Missing checkbox or short reason -> 422
    assert (
        client.post(
            f"/payments/pending-review/{int_ok}/close-creation-failure",
            headers=_auth_headers(RID_A),
            json={"reason": "Motivo válido", "confirmed_no_charge": False},
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"/payments/pending-review/{int_ok}/close-creation-failure",
            headers=_auth_headers(RID_A),
            json={"reason": "ok", "confirmed_no_charge": True},
        ).status_code
        == 422
    )

    # Uncertain & webhook-bearing attempts MUST stay blocked (409)
    close_unc = client.post(
        f"/payments/pending-review/{int_uncertain}/close-creation-failure",
        headers=_auth_headers(RID_A),
        json={"reason": "Tentativa sem prova segura", "confirmed_no_charge": True},
    )
    assert close_unc.status_code == 409
    assert close_unc.json()["detail"]["code"] == "CREATION_FAILURE_NOT_PROVEN"

    close_hook = client.post(
        f"/payments/pending-review/{int_with_hook}/close-creation-failure",
        headers=_auth_headers(RID_A),
        json={"reason": "Tem external id e webhook", "confirmed_no_charge": True},
    )
    assert close_hook.status_code == 409

    # Proven creation failure closes cleanly with stock reversal + audit + idempotent retry
    close_ok = client.post(
        f"/payments/pending-review/{int_ok}/close-creation-failure",
        headers=_auth_headers(RID_A),
        json={"reason": "PagBank recusou HTTP 400 sem gerar QR", "confirmed_no_charge": True},
    )
    assert close_ok.status_code == 200
    assert close_ok.json()["status"] == "cancelled"
    assert close_ok.json()["already_closed"] is False

    # 17: Idempotent repeat request returns already_closed=True without duplicating stock reversal
    close_repeat = client.post(
        f"/payments/pending-review/{int_ok}/close-creation-failure",
        headers=_auth_headers(RID_A),
        json={"reason": "Repetição segura da revisão", "confirmed_no_charge": True},
    )
    assert close_repeat.status_code == 200
    assert close_repeat.json()["already_closed"] is True

    session = SessionLocal(bind=engine)
    token = current_restaurante_id.set(RID_A)
    try:
        reversals = session.query(MovimentacaoEstoque).filter(
            MovimentacaoEstoque.restaurante_id == RID_A,
            MovimentacaoEstoque.origem == SALE_REVERSAL_ORIGIN,
        ).all()
        assert len(reversals) == 1
        assert reversals[0].quantidade == 1.0
        insumo = session.query(Insumo).filter(Insumo.id == f"ins-{RID_A}-ok400").one()
        assert insumo.estoque_atual == 10.0
        assert session.query(Pagamento).filter(Pagamento.restaurante_id == RID_A, Pagamento.comanda_id == cmd_ok).count() == 0
        cmd_row = session.query(Comanda).filter(Comanda.id == cmd_ok).one()
        assert cmd_row.fechada is True
        assert cmd_row.online_payment_status == "cancelled"
        assert cmd_row.delivery_status == "recusado"
        audit = session.query(OnlineOrderOperationalAudit).filter(
            OnlineOrderOperationalAudit.restaurante_id == RID_A,
            OnlineOrderOperationalAudit.action == "online_payment_creation_failure_closed",
        ).one()
        assert audit.actor_user_id == f"user-{RID_A}-admin"
        assert audit.after_data["intent_id"] == int_ok
    finally:
        current_restaurante_id.reset(token)
        session.close()

    # Check history tab returns the audited review
    history_payload = client.get("/payments/pending-review", headers=_auth_headers(RID_A)).json()
    closed_history = next(h for h in history_payload["history_items"] if h["id"] == int_ok)
    assert closed_history["situation"] == "closed_after_review"
    assert len(closed_history["review_history"]) == 1
    assert closed_history["review_history"][0]["actor_name"] == f"Admin {RID_A}"

    # 13: While uncertain remains, switch to Direct Pix and PagBank disconnect stay 409 blocked
    dp_blocked = client.put(
        "/payments/direct-pix/settings",
        headers=_auth_headers(RID_A),
        json={
            "enabled": True,
            "key_type": "email",
            "pix_key": "pix@loja.com",
            "holder_name": "Loja Alpha",
            "city": "Fortaleza",
            "accept_manual_confirmation_and_monthly_fees": True,
        },
    )
    assert dp_blocked.status_code == 409
    assert client.post("/payments/pagbank/disconnect", headers=_auth_headers(RID_A)).status_code == 409

    # Resolve remaining two via legitimate terminal/approved outcomes -> unlock disconnect & Direct Pix
    session = SessionLocal(bind=engine)
    token = current_restaurante_id.set(RID_A)
    try:
        for iid in (int_uncertain, int_with_hook):
            row = session.query(OnlinePaymentIntent).filter(OnlinePaymentIntent.id == iid).one()
            row.status = "expired"
        session.commit()
    finally:
        current_restaurante_id.reset(token)
        session.close()

    disc_ok = client.post("/payments/pagbank/disconnect", headers=_auth_headers(RID_A))
    assert disc_ok.status_code == 200
    assert disc_ok.json()["status"] == "disconnected"

    # Credentials retained on disconnected account for historical reconciliation
    session = SessionLocal(bind=engine)
    token = current_restaurante_id.set(RID_A)
    try:
        acc_row = session.query(RestaurantPaymentAccount).filter(RestaurantPaymentAccount.id == acc.id).one()
        assert acc_row.status == "disconnected"
        assert acc_row.access_token == "encrypted-fake-token"
    finally:
        current_restaurante_id.reset(token)
        session.close()

    # 14: Now Direct Pix activates cleanly and leaves historical PagBank intents intact
    dp_ok = client.put(
        "/payments/direct-pix/settings",
        headers=_auth_headers(RID_A),
        json={
            "enabled": True,
            "key_type": "email",
            "pix_key": "pix@loja.com",
            "holder_name": "Loja Alpha",
            "city": "Fortaleza",
            "accept_manual_confirmation_and_monthly_fees": True,
        },
    )
    assert dp_ok.status_code == 200
    assert dp_ok.json()["enabled"] is True

    session = SessionLocal(bind=engine)
    token = current_restaurante_id.set(RID_A)
    try:
        assert session.query(OnlinePaymentIntent).filter(OnlinePaymentIntent.id == int_ok).one().provider == "pagbank"
        assert session.query(RestaurantDirectPixConfig).filter(RestaurantDirectPixConfig.restaurante_id == RID_A).one().enabled is True
    finally:
        current_restaurante_id.reset(token)
        session.close()


def test_11_b_mercado_pago_disconnect_structured_409(isolated_env):
    engine, client = isolated_env
    shift = _seed_shift(engine)
    _seed_bank_account(engine, provider="mercado_pago")
    _seed_pix_intent(
        engine,
        turno_id=shift.id,
        suffix="mp701",
        order_number=701,
        amount=Decimal("18.50"),
        provider="mercado_pago",
        last_error="Mercado Pago recusou a criação do Pix (400): bad email.",
    )

    res = client.post("/payments/mercado-pago/disconnect", headers=_auth_headers(RID_A))
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["code"] == "PAYMENT_DISCONNECT_BLOCKED"
    assert detail["provider"] == "mercado_pago"
    assert detail["blocking_count"] == 1
    assert detail["blocking_items"][0]["order_number"] == 701
    assert detail["blocking_items"][0]["can_close_creation_failure"] is True


def test_15_16_tenant_isolation_and_role_permissions(isolated_env, monkeypatch):
    engine, client = isolated_env
    shift_a = _seed_shift(engine, rid=RID_A)
    _seed_bank_account(engine, rid=RID_A, provider="pagbank")
    _, intent_a = _seed_pix_intent(
        engine,
        rid=RID_A,
        turno_id=shift_a.id,
        suffix="iso",
        order_number=801,
        last_error="PagBank recusou a operação (HTTP 400). Código: 40002.",
    )

    # Tenant B cannot see, reconcile, or close Tenant A's intent
    res_b = client.get("/payments/pending-review", headers=_auth_headers(RID_B, "admin"))
    assert res_b.status_code == 200
    assert res_b.json()["items"] == []
    assert res_b.json()["summary"]["blocking_count"] == 0

    assert (
        client.post(
            f"/payments/pending-review/{intent_a}/reconcile",
            headers=_auth_headers(RID_B, "admin"),
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/payments/pending-review/{intent_a}/close-creation-failure",
            headers=_auth_headers(RID_B, "admin"),
            json={"reason": "Tentativa cross-tenant", "confirmed_no_charge": True},
        ).status_code
        == 404
    )

    # Waiter / kitchen / attendant receive 403 on review queue, reconcile, and close
    for denied_role in ("garcom", "cozinha", "atendente"):
        assert client.get("/payments/pending-review", headers=_auth_headers(RID_A, denied_role)).status_code == 403
        assert (
            client.post(
                f"/payments/pending-review/{intent_a}/reconcile",
                headers=_auth_headers(RID_A, denied_role),
            ).status_code
            == 403
        )
        assert (
            client.post(
                f"/payments/pending-review/{intent_a}/close-creation-failure",
                headers=_auth_headers(RID_A, denied_role),
                json={"reason": "Sem permissao", "confirmed_no_charge": True},
            ).status_code
            == 403
        )

    # Caixa & gerente can read pending review and caixa can run audited closure
    assert client.get("/payments/pending-review", headers=_auth_headers(RID_A, "caixa")).status_code == 200
    assert client.get("/payments/pending-review", headers=_auth_headers(RID_A, "gerente")).status_code == 200
    close_res = client.post(
        f"/payments/pending-review/{intent_a}/close-creation-failure",
        headers=_auth_headers(RID_A, "caixa"),
        json={"reason": "Operador de caixa validou falha 400", "confirmed_no_charge": True},
    )
    assert close_res.status_code == 200


def test_17_reconcile_cooldown_and_18_cash_close_without_counting_unpaid_pix(isolated_env, monkeypatch):
    engine, client = isolated_env
    old_shift = _seed_shift(engine, status="fechado")
    cur_shift = _seed_shift(engine, status="aberto")
    _seed_bank_account(engine, provider="pagbank")

    # Previous shift still has an old failed intent (should NOT poison current shift close as "open check")
    _seed_pix_intent(
        engine,
        turno_id=old_shift.id,
        suffix="prev",
        order_number=901,
        amount=Decimal("22.00"),
        last_error="PagBank recusou a operação (HTTP 400). Código: 40002.",
        age_minutes=300,
    )
    # Current shift has a failed intent (age 60m — MUST NOT auto-cancel by time!)
    _, cur_intent_id = _seed_pix_intent(
        engine,
        turno_id=cur_shift.id,
        suffix="curclose",
        order_number=902,
        amount=Decimal("15.00"),
        last_error="PagBank recusou a operação (HTTP 400). Código: 40002.",
        age_minutes=60,
    )
    # Also test reconcile throttle behavior
    _, pend_id = _seed_pix_intent(
        engine,
        turno_id=cur_shift.id,
        suffix="throttle",
        order_number=903,
        amount=Decimal("10.00"),
        status="pending",
        external_payment_id="ORDE_THROTTLE_903",
        qr_code="000201pixthrottle",
    )

    provider_calls = 0

    def fake_get(self, pid):
        nonlocal provider_calls
        provider_calls += 1
        return ProviderPayment(
            external_id=pid,
            status="pending",
            amount=Decimal("10.00"),
            external_reference=pend_id,
        )

    monkeypatch.setattr(PagBankProvider, "get_payment", fake_get)

    first_rec = client.post(f"/payments/pending-review/{pend_id}/reconcile", headers=_auth_headers(RID_A))
    assert first_rec.status_code == 200
    assert first_rec.json()["queried"] is True
    second_rec = client.post(f"/payments/pending-review/{pend_id}/reconcile", headers=_auth_headers(RID_A))
    assert second_rec.status_code == 200
    assert second_rec.json()["queried"] is False
    assert provider_calls == 1

    # Cash close blocks with 409 while current shift intents are unresolved; never cancels cur_intent_id
    session = SessionLocal(bind=engine)
    token = current_restaurante_id.set(RID_A)
    try:
        user_row = session.query(Usuario).filter(Usuario.id == f"user-{RID_A}-admin").one()
        close_req = ReconciledCloseRequest(
            modo_conferencia="rapida",
            declarado_dinheiro=100.0,
            declarado_cartao=0.0,
            declarado_pix=0.0,
            observacao="Fechamento teste",
        )
        with pytest.raises(HTTPException) as blocked:
            fechar_turno_reconciliado(close_req, BackgroundTasks(), db=session, current_user=user_row)
        assert blocked.value.status_code == 409
        assert "Pix online aguardando confirmação ou cancelamento" in str(blocked.value.detail)
        session.expire_all()
        assert session.query(OnlinePaymentIntent).filter(OnlinePaymentIntent.id == cur_intent_id).one().status == "error"
    finally:
        current_restaurante_id.reset(token)
        session.close()

    # Resolve cur_intent via audited closure and cancel pend_id cleanly
    assert (
        client.post(
            f"/payments/pending-review/{cur_intent_id}/close-creation-failure",
            headers=_auth_headers(RID_A),
            json={"reason": "Falha comprovada antes de gerar Pix", "confirmed_no_charge": True},
        ).status_code
        == 200
    )
    monkeypatch.setattr(
        PagBankProvider,
        "get_payment",
        lambda self, pid: ProviderPayment(
            external_id=pid,
            status="cancelled",
            amount=Decimal("10.00"),
            external_reference=pend_id,
        ),
    )
    session = SessionLocal(bind=engine)
    token = current_restaurante_id.set(RID_A)
    try:
        p_row = session.query(OnlinePaymentIntent).filter(OnlinePaymentIntent.id == pend_id).one()
        p_row.reconciliation_attempted_at = None
        session.commit()
    finally:
        current_restaurante_id.reset(token)
        session.close()
    assert client.post(f"/payments/pending-review/{pend_id}/reconcile", headers=_auth_headers(RID_A)).status_code == 200

    # Now close shift: previous-shift unpaid failed Pix does NOT block or enter totals!
    session = SessionLocal(bind=engine)
    token = current_restaurante_id.set(RID_A)
    try:
        user_row = session.query(Usuario).filter(Usuario.id == f"user-{RID_A}-admin").one()
        closed = fechar_turno_reconciliado(
            ReconciledCloseRequest(
                modo_conferencia="rapida",
                declarado_dinheiro=100.0,
                declarado_cartao=0.0,
                declarado_pix=0.0,
                observacao="Turno sem vendas pagas",
            ),
            BackgroundTasks(),
            db=session,
            current_user=user_row,
        )
        assert closed["status"] == "fechado"
        assert closed["esperado_pix"] == 0.0
        assert closed["esperado_cartao"] == 0.0
        assert closed["esperado_dinheiro"] == 100.0
        assert closed["vendas_brutas"] == 0.0
        assert closed["vendas_liquidas"] == 0.0
        assert session.query(Pagamento).filter(Pagamento.restaurante_id == RID_A).count() == 0
    finally:
        current_restaurante_id.reset(token)
        session.close()
