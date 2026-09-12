from __future__ import annotations

import datetime
import logging
import os
import uuid
from decimal import Decimal
from typing import Any

import httpx

from ..config import settings
from .online_payments.signature import verify_mercado_pago_signature

logger = logging.getLogger("koma.saas_mercadopago")


class SaasMercadoPagoError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class SaasMercadoPagoService:
    API_URL = "https://api.mercadopago.com"

    def __init__(self, access_token: str | None = None):
        configured_token = settings.KOMA_SAAS_MERCADO_PAGO_ACCESS_TOKEN if access_token is None else access_token
        self.access_token = configured_token.strip()
        self.environment = os.getenv("ENVIRONMENT", "production").strip().lower()
        self.is_test_credentials = self.access_token.startswith("TEST-")
        self.is_production_credentials = self.access_token.startswith("APP_USR-")
        self.is_mock = not self.access_token or self.access_token.startswith("mock") or self.access_token == "test"
        self.mock_allowed = self.environment in {"test", "development"}

        if self.environment == "production" and self.is_test_credentials:
            raise SaasMercadoPagoError(
                "Credenciais de teste do Mercado Pago (TEST-) são estritamente proibidas em ambiente de produção.",
                status_code=500,
            )

    def checkout_capabilities(self):
        enabled = self.mock_allowed or os.getenv("KOMA_SAAS_CHECKOUT_ENABLED", "false").lower() == "true"
        ready = enabled and (self.mock_allowed or (not self.is_mock and bool(settings.KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET)))
        is_homolog = self.environment in {"staging", "homologation", "homolog", "development", "test"}
        return {
            "pix": bool(ready),
            "credit_card": bool(ready and (self.mock_allowed or settings.KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY)),
            "publicKey": settings.KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY if ready else "",
            "environment": "homologation" if is_homolog else "production",
            "isTestMode": bool(self.is_test_credentials or self.is_mock),
        }

    def _ensure_provider_ready(self) -> None:
        if self.environment == "production" and self.is_test_credentials:
            raise SaasMercadoPagoError(
                "Credenciais de teste do Mercado Pago (TEST-) são estritamente proibidas em ambiente de produção.",
                status_code=500,
            )
        if self.is_mock and not self.mock_allowed:
            raise SaasMercadoPagoError(
                "Integração de cobrança SaaS do Mercado Pago não configurada para este ambiente.",
                status_code=503,
            )

    def _ensure_no_environment_mismatch(self, payer_email: str) -> None:
        """
        Garante que nunca haja mistura entre comprador de teste e recebedor real.
        Compradores de teste do Mercado Pago usam domínio @testuser.com ou prefixo test_user_.
        """
        email_clean = (payer_email or "").strip().lower()
        is_test_payer = email_clean.startswith("test_user_") or email_clean.endswith("@testuser.com")

        if self.is_production_credentials and is_test_payer:
            raise SaasMercadoPagoError(
                "Não é permitido utilizar compradores de teste do Mercado Pago com credenciais de produção.",
                status_code=422,
            )

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self.API_URL,
            headers={
                "Authorization": f"Bearer {self.access_token}",
                "Content-Type": "application/json",
            },
            timeout=15.0,
        )

    @staticmethod
    def _annual_pix_idempotency_key(protocol: str) -> str:
        """Stable provider key for the single annual Pix setup of a contract."""
        normalized_protocol = protocol.strip().upper()
        return str(
            uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"https://komafood.com.br/saas-billing/annual-pix/{normalized_protocol}",
            )
        )

    def create_preapproval(
        self,
        *,
        protocol: str,
        plan: str,
        billing_cycle: str,
        amount: Decimal,
        card_token_id: str,
        payer_email: str,
        back_url: str | None = None,
        trial_days: int = 7,
    ) -> dict[str, Any]:
        """
        Cria uma assinatura recorrente (preapproval) no Mercado Pago com período de trial gratuito.
        O trial inicia imediatamente na autorização do gateway (Arquitetura B).
        """
        self._ensure_provider_ready()
        self._ensure_no_environment_mismatch(payer_email)
        cycle_normalized = billing_cycle.strip().lower()
        is_annual = cycle_normalized in ("anual", "annual")
        frequency = 12 if is_annual else 1
        reason = f"KÔMA - Plano {plan.capitalize()} ({'Anual' if is_annual else 'Mensal'})"
        resolved_back_url = back_url or f"{settings.KOMA_PUBLIC_APP_URL}/legal/contrato/confirmacao"

        if self.is_mock:
            mock_sub_id = f"mock-sub-{uuid.uuid4().hex[:12]}"
            mock_payer_id = f"payer-{uuid.uuid4().hex[:8]}"
            logger.info(
                "[MOCK] Mercado Pago preapproval created for protocol %s (plan=%s, cycle=%s, amount=%s)",
                protocol, plan, billing_cycle, amount
            )
            return {
                "id": mock_sub_id,
                "status": "authorized",
                "payer_id": mock_payer_id,
                "payer_email": payer_email,
                "external_reference": protocol,
                "reason": reason,
                "date_created": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "auto_recurring": {
                    "frequency": frequency,
                    "frequency_type": "months",
                    "transaction_amount": float(amount),
                    "currency_id": "BRL",
                    "free_trial": {
                        "frequency": trial_days,
                        "frequency_type": "days",
                    },
                },
            }

        payload = {
            "reason": reason,
            "external_reference": protocol,
            "payer_email": payer_email,
            "card_token_id": card_token_id,
            "auto_recurring": {
                "frequency": frequency,
                "frequency_type": "months",
                "transaction_amount": float(amount),
                "currency_id": "BRL",
                "free_trial": {
                    "frequency": trial_days,
                    "frequency_type": "days",
                },
            },
            "back_url": resolved_back_url,
            "status": "authorized",
        }

        try:
            with self._client() as client:
                resp = client.post("/preapproval", json=payload, headers={"X-Idempotency-Key": str(uuid.uuid5(uuid.NAMESPACE_URL, f"koma:subscription:{protocol}"))})
                if resp.status_code >= 400:
                    data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
                    detail = data.get("message") or data.get("error") or resp.text
                    logger.error("Mercado Pago preapproval creation failed (%s): %s", resp.status_code, detail)
                    raise SaasMercadoPagoError(
                        f"Falha na autorização do cartão junto ao gateway: {detail}",
                        status_code=resp.status_code,
                    )
                return resp.json()
        except httpx.RequestError as exc:
            logger.error("Network error connecting to Mercado Pago preapproval API: %s", exc)
            raise SaasMercadoPagoError("Erro de comunicação com o gateway de pagamento.") from exc

    def find_preapproval(self, protocol: str, payer_email: str) -> dict[str, Any] | None:
        self._ensure_provider_ready()
        try:
            with self._client() as client:
                response = client.get("/preapproval/search", params={"payer_email": payer_email})
                if response.status_code >= 400:
                    raise SaasMercadoPagoError("Não foi possível recuperar a autorização.")
                matches = [row for row in response.json().get("results", []) if str(row.get("external_reference")) == protocol]
                if len(matches) > 1:
                    raise SaasMercadoPagoError("Mais de uma autorização encontrada; revisão necessária.")
                return matches[0] if matches else None
        except httpx.RequestError as exc:
            raise SaasMercadoPagoError("Não foi possível recuperar a autorização.") from exc

    def get_authorized_payment(self, invoice_id: str) -> dict[str, Any]:
        self._ensure_provider_ready()
        try:
            with self._client() as client:
                response = client.get(f"/authorized_payments/{invoice_id}")
                if response.status_code >= 400:
                    raise SaasMercadoPagoError("Não foi possível consultar a cobrança.")
                return response.json()
        except httpx.RequestError as exc:
            raise SaasMercadoPagoError("Falha ao consultar a cobrança.") from exc

    def get_preapproval(self, preapproval_id: str) -> dict[str, Any]:
        """Consulta dados e status de um preapproval no Mercado Pago."""
        self._ensure_provider_ready()
        if self.is_mock:
            return {
                "id": preapproval_id,
                "status": "authorized",
                "date_created": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            }

        try:
            with self._client() as client:
                resp = client.get(f"/preapproval/{preapproval_id}")
                if resp.status_code >= 400:
                    raise SaasMercadoPagoError(
                        f"Consulta de assinatura falhou ({resp.status_code}).",
                        status_code=resp.status_code,
                    )
                return resp.json()
        except httpx.RequestError as exc:
            raise SaasMercadoPagoError("Erro de comunicação ao consultar assinatura.") from exc

    def cancel_preapproval(self, preapproval_id: str) -> dict[str, Any]:
        """Cancela uma assinatura preapproval no Mercado Pago."""
        self._ensure_provider_ready()
        if self.is_mock:
            return {"id": preapproval_id, "status": "cancelled"}

        try:
            with self._client() as client:
                resp = client.put(f"/preapproval/{preapproval_id}", json={"status": "cancelled"})
                if resp.status_code >= 400:
                    raise SaasMercadoPagoError(
                        f"Cancelamento de assinatura falhou ({resp.status_code}).",
                        status_code=resp.status_code,
                    )
                return resp.json()
        except httpx.RequestError as exc:
            raise SaasMercadoPagoError("Erro de comunicação ao cancelar assinatura.") from exc

    def update_preapproval_next_payment_date(
        self,
        preapproval_id: str,
        next_payment_date: datetime.datetime,
    ) -> dict[str, Any]:
        """
        Reprograma a data da primeira cobrança recorrente (término dos 7 dias grátis)
        no Mercado Pago quando a contratação é liberada manualmente pelo SuperAdmin.
        """
        self._ensure_provider_ready()
        clean_id = preapproval_id.strip()
        if not clean_id:
            raise SaasMercadoPagoError("ID de preapproval inválido para sincronização.", status_code=400)

        iso_date = next_payment_date.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        if self.is_mock:
            logger.info(
                "[MOCK] Preapproval %s next_payment_date sincronizado para %s",
                clean_id,
                iso_date,
            )
            return {"id": clean_id, "next_payment_date": iso_date, "status": "authorized"}

        payload = {"next_payment_date": iso_date}
        try:
            with self._client() as client:
                resp = client.put(f"/preapproval/{clean_id}", json=payload)
                if resp.status_code >= 400:
                    data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
                    detail = data.get("message") or data.get("error") or resp.text
                    logger.error(
                        "Falha ao sincronizar next_payment_date para preapproval %s (%s): %s",
                        clean_id,
                        resp.status_code,
                        detail,
                    )
                    raise SaasMercadoPagoError(
                        f"Falha ao sincronizar início de cobrança com o gateway: {detail}",
                        status_code=resp.status_code,
                    )
                return resp.json()
        except httpx.RequestError as exc:
            logger.error("Erro de rede ao sincronizar next_payment_date do preapproval %s: %s", clean_id, exc)
            raise SaasMercadoPagoError("Erro de comunicação ao sincronizar início de cobrança com o gateway.") from exc

    def create_annual_pix(
        self,
        *,
        protocol: str,
        plan: str,
        amount: Decimal,
        payer_email: str,
        payer_name: str,
        payer_tax_id: str,
        attempt_reference: str | None = None,
    ) -> dict[str, Any]:
        """
        Cria um pagamento Pix antecipado para contratação do plano anual.
        Retorna id do pagamento, QR code e payload copia-e-cola.
        """
        self._ensure_provider_ready()
        self._ensure_no_environment_mismatch(payer_email)
        if self.is_mock:
            mock_payment_id = f"mock-pix-{uuid.uuid4().hex[:10]}"
            qr_emv = f"00020126580014br.gov.bcb.pix0136{uuid.uuid4()}5204000053039865802BR5913KOMA PLATAFORMA6009FORTALEZA62070503***6304ABCD"
            return {
                "id": mock_payment_id,
                "status": "pending",
                "qr_code": qr_emv,
                "qr_code_base64": "",
                "ticket_url": f"https://www.mercadopago.com.br/payments/{mock_payment_id}/ticket",
                "expires_at": (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=24)).isoformat(),
            }

        first_name = payer_name.split()[0] if payer_name else "Cliente"
        last_name = " ".join(payer_name.split()[1:]) if len(payer_name.split()) > 1 else "Koma"
        doc_type = "CNPJ" if len(payer_tax_id) > 11 else "CPF"

        payload = {
            "transaction_amount": float(amount),
            "description": f"KÔMA - Plano {plan.capitalize()} Anual ({protocol})",
            "payment_method_id": "pix",
            "external_reference": protocol,
            "payer": {
                "email": payer_email,
                "first_name": first_name,
                "last_name": last_name,
                "identification": {
                    "type": doc_type,
                    "number": payer_tax_id,
                },
            },
        }
        idempotency_key = self._annual_pix_idempotency_key(f"{protocol}:{attempt_reference}" if attempt_reference else protocol)

        try:
            with self._client() as client:
                resp = client.post(
                    "/v1/payments",
                    json=payload,
                    headers={"X-Idempotency-Key": idempotency_key},
                )
                if resp.status_code >= 400:
                    data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
                    detail = data.get("message") or data.get("error") or resp.text
                    logger.error("Mercado Pago Pix creation failed (%s): %s", resp.status_code, detail)
                    raise SaasMercadoPagoError(
                        f"Falha na geração do Pix junto ao gateway: {detail}",
                        status_code=resp.status_code,
                    )
                res_data = resp.json()
                point_of_interaction = res_data.get("point_of_interaction") or {}
                tx_data = point_of_interaction.get("transaction_data") or {}
                return {
                    "id": str(res_data.get("id")),
                    "status": str(res_data.get("status") or "pending"),
                    "qr_code": tx_data.get("qr_code"),
                    "qr_code_base64": tx_data.get("qr_code_base64"),
                    "ticket_url": tx_data.get("ticket_url"),
                    "expires_at": res_data.get("date_of_expiration"),
                }
        except httpx.RequestError as exc:
            logger.error("Network error connecting to Mercado Pago payments API: %s", exc)
            raise SaasMercadoPagoError("Erro de comunicação ao gerar pagamento Pix.") from exc

    def get_payment(self, payment_id: str) -> dict[str, Any]:
        """Consulta o pagamento no gateway antes de qualquer ativação baseada em webhook."""
        self._ensure_provider_ready()
        if self.is_mock:
            # Em testes o estado aprovado precisa ser declarado explicitamente via monkeypatch.
            # O fallback seguro é pending para impedir ativação acidental por um evento sintético.
            return {
                "id": payment_id,
                "status": "pending",
                "payment_method_id": "pix",
                "external_reference": None,
                "transaction_amount": None,
            }

        try:
            with self._client() as client:
                resp = client.get(f"/v1/payments/{payment_id}")
                if resp.status_code >= 400:
                    raise SaasMercadoPagoError(
                        f"Consulta de pagamento falhou ({resp.status_code}).",
                        status_code=resp.status_code,
                    )
                return resp.json()
        except httpx.RequestError as exc:
            raise SaasMercadoPagoError("Erro de comunicação ao consultar pagamento.") from exc

    @staticmethod
    def verify_webhook_signature(
        *,
        signature_header: str,
        request_id: str,
        data_id: str,
    ) -> bool:
        secret = settings.KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET
        if not secret:
            # Mocks sem segredo são permitidos somente fora de produção.
            environment = os.getenv("ENVIRONMENT", "production").strip().lower()
            return environment in {"test", "development"}
        return verify_mercado_pago_signature(
            signature_header=signature_header,
            request_id=request_id,
            data_id=data_id,
            secret=secret,
        )


default_saas_mp_service = SaasMercadoPagoService()
