"""Acompanhamento nunca converte vencimento do QR em rejeição financeira do provedor."""

from __future__ import annotations

import datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.routes.order_tracking import _resolve_tracking_payment_state


@pytest.mark.parametrize("provider", ["mercado_pago", "pagbank"])
@pytest.mark.parametrize("initial_status", ["created", "pending"])
def test_tracking_expired_provider_pix_stays_pending_until_authoritative_settlement(
    provider: str, initial_status: str
):
    expired_at = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=40)
    intent = SimpleNamespace(
        provider=provider,
        status=initial_status,
        expires_at=expired_at,
        method="pix",
        qr_code="expired-qr-fixture",
        qr_code_base64=None,
        ticket_url=None,
    )
    db = Mock()
    db.query.return_value.filter.return_value.first.return_value = intent

    status, payment_pending, payment_failed, payment = _resolve_tracking_payment_state(
        db,
        restaurante_id=9941,
        comanda_id="fixture-order",
        delivery_status="pendente",
        fechada=False,
    )

    assert status == "aguardando_pagamento"
    assert payment_pending is True
    assert payment_failed is False
    assert payment is not None and payment["status"] == initial_status
    assert intent.status == initial_status
    db.query.assert_called_once()
    db.flush.assert_not_called()
    db.commit.assert_not_called()


@pytest.mark.parametrize("provider", ["mercado_pago", "pagbank"])
def test_tracking_only_reports_rejection_after_provider_status_is_terminal(provider: str):
    intent = SimpleNamespace(
        provider=provider,
        status="rejected",
        expires_at=datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=1),
        method="pix",
        qr_code=None,
        qr_code_base64=None,
        ticket_url=None,
    )
    db = Mock()
    db.query.return_value.filter.return_value.first.return_value = intent

    status, pending, failed, payment = _resolve_tracking_payment_state(
        db,
        restaurante_id=9941,
        comanda_id="fixture-order",
        delivery_status="pendente",
        fechada=False,
    )

    assert status == "falha_pagamento"
    assert pending is False
    assert failed is True
    assert payment is not None and payment["status"] == "rejected"
    db.flush.assert_not_called()
    db.commit.assert_not_called()
