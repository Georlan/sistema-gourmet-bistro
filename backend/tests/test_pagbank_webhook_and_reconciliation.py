from __future__ import annotations

import datetime
from decimal import Decimal
import hashlib
import json
from unittest.mock import MagicMock

from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import Session

from app.main import app
from app.database import SessionLocal, current_restaurante_id, tenant_session_scope
from app.models import (
    CaixaTurno,
    Comanda,
    OnlinePaymentIntent,
    OnlinePaymentWebhookEvent,
    Restaurante,
    RestaurantPaymentAccount,
    Usuario,
)
from app.services.online_payments.base import ProviderPayment
from app.services.online_payments.pagbank.provider import PagBankProvider
from app.services.online_payments.pagbank.webhook import (
    extract_webhook_identifiers,
    verify_pagbank_signature,
)
from app.services.online_payments.reconciliation_worker import (
    discover_active_tenant_ids,
    reconcile_pending_intents,
)


def test_extract_webhook_identifiers():
    # 1. Top-level Order format
    p1 = {"id": "ORDE_12345", "reference_id": "intent-ref-1"}
    assert extract_webhook_identifiers(p1) == ("ORDE_12345", "intent-ref-1")

    # 2. Nested order envelope
    p2 = {"order": {"id": "ORDE_67890", "reference_id": "intent-ref-2"}}
    assert extract_webhook_identifiers(p2) == ("ORDE_67890", "intent-ref-2")

    # 3. Charges array
    p3 = {
        "id": "ORDE_MAIN",
        "charges": [{"id": "CHAR_ABC", "reference_id": "intent-ref-3"}],
    }
    assert extract_webhook_identifiers(p3) == ("ORDE_MAIN", "intent-ref-3")

    # 4. Charge-only event where order ID is absent at top level
    p4 = {
        "charges": [{"id": "CHAR_SOLO", "reference_id": "intent-ref-4"}],
    }
    assert extract_webhook_identifiers(p4) == ("CHAR_SOLO", "intent-ref-4")

    # 5. Envelope with data field
    p5 = {"data": {"id": "ORDE_ENVELOPE", "reference_id": "intent-ref-5"}}
    assert extract_webhook_identifiers(p5) == ("ORDE_ENVELOPE", "intent-ref-5")

    # 6. List format
    p6 = [{"id": "ORDE_IN_LIST", "reference_id": "intent-ref-6"}]
    assert extract_webhook_identifiers(p6) == ("ORDE_IN_LIST", "intent-ref-6")

    # 7. Malformed / empty payloads
    assert extract_webhook_identifiers({}) == (None, None)
    assert extract_webhook_identifiers([]) == (None, None)
    assert extract_webhook_identifiers("not a dict") == (None, None)
    assert extract_webhook_identifiers(None) == (None, None)


def test_verify_pagbank_signature():
    token = "secret-app-token-12345"
    candidate_tokens = ["wrong-token", token, "another-token"]
    body = b'{"id":"ORDE_123","reference_id":"ref-1"}'

    # 1. Official format: sha256(token + "-" + raw)
    valid_sig = hashlib.sha256(token.encode() + b"-" + body).hexdigest()
    assert verify_pagbank_signature(
        raw_body=body,
        authenticity_token=valid_sig,
        candidate_tokens=candidate_tokens,
    ) is True

    # 2. Whitespace / CRLF normalization
    body_with_crlf = body + b"\r\n"
    assert verify_pagbank_signature(
        raw_body=body_with_crlf,
        authenticity_token=valid_sig,
        candidate_tokens=candidate_tokens,
    ) is True

    # 3. Format without hyphen: sha256(token + raw)
    no_hyphen_sig = hashlib.sha256(token.encode() + body).hexdigest()
    assert verify_pagbank_signature(
        raw_body=body,
        authenticity_token=no_hyphen_sig,
        candidate_tokens=candidate_tokens,
    ) is True

    # 4. Tampered body or invalid signature -> False
    assert verify_pagbank_signature(
        raw_body=b'{"id":"ORDE_TAMPERED"}',
        authenticity_token=valid_sig,
        candidate_tokens=candidate_tokens,
    ) is False
    assert verify_pagbank_signature(
        raw_body=body,
        authenticity_token="invalid-hex-digest",
        candidate_tokens=candidate_tokens,
    ) is False

    # 5. Missing / empty tokens or signature -> False
    assert verify_pagbank_signature(
        raw_body=body,
        authenticity_token="",
        candidate_tokens=candidate_tokens,
    ) is False
    assert verify_pagbank_signature(
        raw_body=body,
        authenticity_token=valid_sig,
        candidate_tokens=[],
    ) is False


def test_webhook_resolves_by_reference_id_when_charge_received(monkeypatch):
    """Testa que o webhook com id de cobrança e reference_id consegue encontrar o intent pela chave de referência."""
    rid = 9971
    current_restaurante_id.set(rid)
    db = SessionLocal()
    try:
        db.add(Restaurante(id=rid, nome="RefID Webhook Test", plano="pro"))
        db.flush()
        user = Usuario(
            id="admin-9971",
            restaurante_id=rid,
            nome="Admin",
            email="admin-9971@test.com",
            senha_hash="x",
            role="admin",
            cargo="admin",
            status="ativo",
        )
        db.add(user)
        db.flush()
        shift = CaixaTurno(
            restaurante_id=rid,
            aberto_por_id=user.id,
            status="aberto",
            saldo_inicial=0.0,
        )
        db.add(shift)
        db.flush()
        comanda = Comanda(
            id="comanda-9971",
            restaurante_id=rid,
            garcom_id=user.id,
            numero_pedido=201,
            identificador="Delivery 201",
            status_comanda=None,
            tipo="Delivery",
            delivery_status="pendente",
            online_payment_status="pending",
        )
        db.add(comanda)
        db.flush()

        intent = OnlinePaymentIntent(
            id="intent-refid-test",
            restaurante_id=rid,
            comanda_id=comanda.id,
            turno_id=shift.id,
            provider="pagbank",
            method="pix",
            status="pending",
            amount=45.00,
            marketplace_fee=0.00,
            fee_settlement="none",
            idempotency_key="idem-refid-test",
            external_payment_id="ORDE_INITIAL_45",
        )
        db.add(intent)

        account = RestaurantPaymentAccount(
            id="acc-refid-9971",
            restaurante_id=rid,
            provider="pagbank",
            provider_environment="production",
            provider_user_id="ACCO_REFID_SELLER",
            status="active",
            access_token="tok-refid-seller",
            webhook_secret="tok-refid-seller",
        )
        db.add(account)
        db.commit()

        client = TestClient(app, base_url="https://testserver")

        # Payload sends charge ID instead of order ID, but reference_id points to intent.id
        raw_body = json.dumps({
            "charges": [{
                "id": "CHAR_CHARGE_ONLY_999",
                "reference_id": "intent-refid-test",
                "status": "PAID",
            }]
        }).encode("utf-8")

        fake_payment = ProviderPayment(
            external_id="ORDE_INITIAL_45",
            status="approved",
            amount=Decimal("45.00"),
            external_reference="intent-refid-test",
            qr_code="pix-qr",
        )
        monkeypatch.setattr(PagBankProvider, "get_payment", lambda self, pid: fake_payment)

        sig = hashlib.sha256(b"tok-refid-seller-" + raw_body).hexdigest()
        res = client.post(
            f"/payments/webhooks/pagbank/{account.id}",
            content=raw_body,
            headers={"Content-Type": "application/json", "x-authenticity-token": sig},
        )
        assert res.status_code == 200
        assert res.json()["status"] == "processed"

        # Verify comanda and intent approved and payment record created
        db.refresh(intent)
        db.refresh(comanda)
        assert intent.status == "approved"
        assert comanda.online_payment_status == "approved"

    finally:
        db.close()


def test_webhook_tenant_isolation():
    """Garante que notificações recebidas para uma conta de tenant não afetam outro tenant."""
    client = TestClient(app, base_url="https://testserver")

    # Inexistente retorna 404
    res = client.post(
        "/payments/webhooks/pagbank/acc-inexistente-12345",
        content=b'{"id":"ORDE_NONEXISTENT"}',
        headers={"Content-Type": "application/json", "x-authenticity-token": "any"},
    )
    assert res.status_code == 404


def test_webhook_returns_503_for_uncommitted_intent(monkeypatch):
    """Quando o webhook chega antes do intent ser persistido no banco, retorna 503 para retry seguro."""
    rid = 9972
    current_restaurante_id.set(rid)
    db = SessionLocal()
    try:
        db.add(Restaurante(id=rid, nome="Early Webhook Test", plano="pro"))
        db.flush()
        account = RestaurantPaymentAccount(
            id="acc-early-9972",
            restaurante_id=rid,
            provider="pagbank",
            provider_environment="production",
            provider_user_id="ACCO_EARLY",
            status="active",
            access_token="tok-early",
            webhook_secret="tok-early",
        )
        db.add(account)
        db.commit()

        client = TestClient(app, base_url="https://testserver")
        raw_body = b'{"id": "ORDE_EARLY_NOT_YET_IN_DB", "reference_id": "intent-early-unknown"}'
        sig = hashlib.sha256(b"tok-early-" + raw_body).hexdigest()

        res = client.post(
            f"/payments/webhooks/pagbank/{account.id}",
            content=raw_body,
            headers={"Content-Type": "application/json", "x-authenticity-token": sig},
        )
        assert res.status_code == 503
        assert "ainda não registrado" in res.json()["detail"]
    finally:
        db.close()


def test_autonomous_reconciliation_worker_sweep(monkeypatch):
    """Testa que o worker de reconciliação varre intents pendentes de tenants ativos com segurança."""
    rid = 9973
    current_restaurante_id.set(rid)
    db = SessionLocal()
    try:
        db.add(Restaurante(id=rid, nome="Worker Sweep Test", plano="pro"))
        db.flush()
        user = Usuario(
            id="admin-9973",
            restaurante_id=rid,
            nome="Admin",
            email="admin-9973@test.com",
            senha_hash="x",
            role="admin",
            cargo="admin",
            status="ativo",
        )
        db.add(user)
        db.flush()
        shift = CaixaTurno(
            restaurante_id=rid,
            aberto_por_id=user.id,
            status="aberto",
            saldo_inicial=0.0,
        )
        db.add(shift)
        db.flush()
        comanda = Comanda(
            id="comanda-9973",
            restaurante_id=rid,
            garcom_id=user.id,
            numero_pedido=301,
            identificador="Mesa 301",
            status_comanda=None,
            tipo="Consumo no Local",
            delivery_status="pendente",
            online_payment_status="pending",
        )
        db.add(comanda)
        db.flush()

        intent = OnlinePaymentIntent(
            id="intent-worker-sweep",
            restaurante_id=rid,
            comanda_id=comanda.id,
            turno_id=shift.id,
            provider="pagbank",
            method="pix",
            status="pending",
            amount=50.00,
            marketplace_fee=0.00,
            fee_settlement="none",
            idempotency_key="idem-worker-sweep",
            external_payment_id="ORDE_WORKER_SWEEP_50",
        )
        db.add(intent)

        account = RestaurantPaymentAccount(
            id="acc-worker-9973",
            restaurante_id=rid,
            provider="pagbank",
            provider_environment="production",
            provider_user_id="ACCO_WORKER",
            status="active",
            access_token="tok-worker",
            webhook_secret="tok-worker",
        )
        db.add(account)
        db.commit()

        # Mock PagBank get_payment
        fake_payment = ProviderPayment(
            external_id="ORDE_WORKER_SWEEP_50",
            status="approved",
            amount=Decimal("50.00"),
            external_reference="intent-worker-sweep",
            qr_code="pix-qr",
        )
        monkeypatch.setattr(PagBankProvider, "get_payment", lambda self, pid: fake_payment)

        # Mock discover_active_tenant_ids to return our test tenant
        monkeypatch.setattr(
            "app.services.online_payments.reconciliation_worker.discover_active_tenant_ids",
            lambda session: [rid],
        )

        reconciled_count = reconcile_pending_intents(max_per_tenant=5)
        assert reconciled_count == 1

        db.refresh(intent)
        db.refresh(comanda)
        assert intent.status == "approved"
        assert comanda.online_payment_status == "approved"

    finally:
        db.close()
