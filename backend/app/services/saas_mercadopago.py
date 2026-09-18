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

SAAS_MERCADO_PAGO_WEBHOOK_PREFIX = "/api/integrations/saas-billing/mercado-pago"
SAAS_MERCADO_PAGO_WEBHOOK_SUBPATH = "/webhook"
SAAS_MERCADO_PAGO_WEBHOOK_PATH = "/api/integrations/saas-billing/mercado-pago/webhook"
SAAS_MERCADO_PAGO_REQUIRED_WEBHOOK_EVENTS = (
    "payment",
    "subscription_preapproval",
    "subscription_authorized_payment",
)


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


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
        is_homolog = self.environment in {"staging", "homologation", "homolog", "development", "test"}
        self.is_mock = not self.access_token or self.access_token.startswith("mock") or self.access_token == "test"
        self.mock_allowed = self.environment in {"test", "development"}

        if is_homolog:
            self.is_test_credentials = not self.is_mock
            self.is_production_credentials = False
        else:
            self.is_test_credentials = self.access_token.startswith("TEST-")
            self.is_production_credentials = bool(self.access_token and not self.is_test_credentials and not self.is_mock)

        if self.environment == "production" and self.is_test_credentials:
            raise SaasMercadoPagoError(
                "Credenciais de teste do Mercado Pago (TEST-) são estritamente proibidas em ambiente de produção.",
                status_code=500,
            )

    def checkout_capabilities(self):
        enabled = self.mock_allowed or _env_flag("KOMA_SAAS_CHECKOUT_ENABLED")
        ready = enabled and (
            self.mock_allowed
            or (not self.is_mock and bool(settings.KOMA_SAAS_MERCADO_PAGO_WEBHOOK_SECRET))
        )
        is_homolog = self.environment in {"staging", "homologation", "homolog", "development", "test"}
        pix_automatic_enabled = self.mock_allowed or _env_flag("KOMA_SAAS_PIX_AUTOMATIC_ENABLED")
        account_money_enabled = self.mock_allowed or _env_flag("KOMA_SAAS_ACCOUNT_MONEY_ENABLED")
        return {
            "pix": False,
            "pix_automatic": bool(ready and pix_automatic_enabled),
            "account_money": bool(ready and account_money_enabled),
            "credit_card": bool(ready and (self.mock_allowed or settings.KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY)),
            "publicKey": settings.KOMA_SAAS_MERCADO_PAGO_PUBLIC_KEY if ready else "",
            "environment": "homologation" if is_homolog else "production",
            "isTestMode": bool(self.is_test_credentials or self.is_mock),
            "trialDays": 7,
            "upfrontPaymentAllowed": False,
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

    def _validate_merchant_identity(self, payload: dict[str, Any]) -> None:
        if self.is_mock:
            return
        expected_collector = os.getenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_COLLECTOR_ID", "").strip()
        expected_application = os.getenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_APPLICATION_ID", "").strip()
        if not expected_collector and not expected_application:
            return

        collector_id = str(payload.get("collector_id") or "").strip()
        application_id = str(payload.get("application_id") or "").strip()
        if expected_collector and collector_id != expected_collector:
            raise SaasMercadoPagoError(
                "O Mercado Pago retornou uma conta recebedora diferente da conta KÔMA configurada.",
                status_code=409,
            )
        if expected_application and application_id != expected_application:
            raise SaasMercadoPagoError(
                "O Mercado Pago retornou uma aplicação diferente da aplicação KomaBilling configurada.",
                status_code=409,
            )

    def _ensure_no_environment_mismatch(self, payer_email: str) -> None:
        email_clean = (payer_email or "").strip().lower()
        is_test_payer = email_clean.startswith("test_user_") or email_clean.endswith("@testuser.com")
        if self.is_production_credentials and is_test_payer:
            raise SaasMercadoPagoError(
                "Não é permitido utilizar compradores de teste do Mercado Pago com credenciais de produção.",
                status_code=422,
            )

    def _resolve_gateway_payer_email(self, payer_email: str) -> str:
        clean = (payer_email or "").strip()
        clean_lower = clean.lower()
        is_test_payer = clean_lower.startswith("test_user_") or clean_lower.endswith("@testuser.com")
        if self.is_test_credentials and not is_test_payer:
            test_payer = os.getenv(
                "KOMA_SAAS_MERCADO_PAGO_TEST_PAYER_EMAIL",
                "test_user_5734251429071523815@testuser.com",
            ).strip()
            if test_payer:
                return test_payer
        return clean

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
    def _recurring_idempotency_key(protocol: str, method: str) -> str:
        normalized_protocol = protocol.strip().upper()
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"https://komafood.com.br/saas-billing/{method}/{normalized_protocol}"))

    @staticmethod
    def _recurring_payload(
        *,
        protocol: str,
        plan: str,
        billing_cycle: str,
        amount: Decimal,
        payer_email: str,
        trial_days: int,
        back_url: str,
        status: str,
    ) -> dict[str, Any]:
        cycle_normalized = billing_cycle.strip().lower()
        is_annual = cycle_normalized in ("anual", "annual")
        frequency = 12 if is_annual else 1
        return {
            "reason": f"KÔMA - Plano {plan.capitalize()} ({'Anual' if is_annual else 'Mensal'})",
            "external_reference": protocol,
            "payer_email": payer_email,
            "auto_recurring": {
                "frequency": frequency,
                "frequency_type": "months",
                "transaction_amount": float(amount),
                "currency_id": "BRL",
                "free_trial": {"frequency": trial_days, "frequency_type": "days"},
            },
            "back_url": back_url,
            "status": status,
        }

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
        """Cria assinatura recorrente de cartão com 7 dias grátis antes da primeira cobrança."""
        self._ensure_provider_ready()
        self._ensure_no_environment_mismatch(payer_email)
        resolved_back_url = back_url or f"{settings.KOMA_PUBLIC_APP_URL}/legal/contrato/confirmacao"
        gateway_payer_email = self._resolve_gateway_payer_email(payer_email)
        payload = self._recurring_payload(
            protocol=protocol,
            plan=plan,
            billing_cycle=billing_cycle,
            amount=amount,
            payer_email=gateway_payer_email,
            trial_days=trial_days,
            back_url=resolved_back_url,
            status="authorized",
        )
        payload["card_token_id"] = card_token_id

        if self.is_mock:
            mock_sub_id = f"mock-sub-{uuid.uuid4().hex[:12]}"
            return {
                "id": mock_sub_id,
                "status": "authorized",
                "payer_id": f"payer-{uuid.uuid4().hex[:8]}",
                "payment_method_id": "visa",
                **payload,
                "date_created": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            }

        try:
            with self._client() as client:
                resp = client.post(
                    "/preapproval",
                    json=payload,
                    headers={"X-Idempotency-Key": self._recurring_idempotency_key(protocol, "credit-card")},
                )
                if resp.status_code >= 400:
                    data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
                    detail = data.get("message") or data.get("error") or resp.text
                    raise SaasMercadoPagoError(
                        f"Falha na autorização do cartão junto ao gateway: {detail}",
                        status_code=resp.status_code,
                    )
                result = resp.json()
                self._validate_merchant_identity(result)
                return result
        except httpx.RequestError as exc:
            raise SaasMercadoPagoError("Erro de comunicação com o gateway de pagamento.") from exc

    def create_pix_automatic_preapproval(
        self,
        *,
        protocol: str,
        plan: str,
        billing_cycle: str,
        amount: Decimal,
        payer_email: str,
        back_url: str | None = None,
        trial_days: int = 7,
    ) -> dict[str, Any]:
        """
        Cria assinatura pendente no checkout hospedado do Mercado Pago.

        O cliente conclui a autorização recorrente no `init_point`. O KÔMA só
        considera o setup pronto depois que o preapproval retornar `authorized`
        e `payment_method_id=pix`, preservando R$ 0 hoje e a primeira cobrança
        somente depois dos 7 dias grátis.
        """
        self._ensure_provider_ready()
        self._ensure_no_environment_mismatch(payer_email)
        resolved_back_url = back_url or f"{settings.KOMA_PUBLIC_APP_URL}/legal/contrato/confirmacao"
        gateway_payer_email = self._resolve_gateway_payer_email(payer_email)
        payload = self._recurring_payload(
            protocol=protocol,
            plan=plan,
            billing_cycle=billing_cycle,
            amount=amount,
            payer_email=gateway_payer_email,
            trial_days=trial_days,
            back_url=resolved_back_url,
            status="pending",
        )

        if self.is_mock:
            mock_sub_id = f"mock-pix-auto-{uuid.uuid4().hex[:12]}"
            return {
                "id": mock_sub_id,
                "status": "pending",
                "external_reference": protocol,
                "payer_email": payer_email,
                "auto_recurring": payload["auto_recurring"],
                "init_point": f"https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id={mock_sub_id}",
                "date_created": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            }

        try:
            with self._client() as client:
                resp = client.post(
                    "/preapproval",
                    json=payload,
                    headers={"X-Idempotency-Key": self._recurring_idempotency_key(protocol, "pix-automatic")},
                )
                if resp.status_code >= 400:
                    data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
                    detail = data.get("message") or data.get("error") or resp.text
                    raise SaasMercadoPagoError(
                        f"Falha ao iniciar a autorização do Pix Automático: {detail}",
                        status_code=resp.status_code,
                    )
                result = resp.json()
                if not result.get("id") or not result.get("init_point"):
                    raise SaasMercadoPagoError(
                        "O gateway não retornou o link de autorização do Pix Automático.",
                        status_code=502,
                    )
                self._validate_merchant_identity(result)
                return result
        except httpx.RequestError as exc:
            raise SaasMercadoPagoError("Erro de comunicação ao iniciar o Pix Automático.") from exc

    def create_account_money_preapproval(
        self,
        *,
        protocol: str,
        plan: str,
        billing_cycle: str,
        amount: Decimal,
        payer_email: str,
        back_url: str | None = None,
        trial_days: int = 7,
    ) -> dict[str, Any]:
        """
        Cria assinatura pendente no checkout hospedado do Mercado Pago para Saldo Mercado Pago.

        O cliente conclui a autorização recorrente no `init_point`. O KÔMA só
        considera o setup pronto depois que o preapproval retornar `authorized`
        e `payment_method_id=account_money`, preservando R$ 0 hoje e a primeira cobrança
        somente depois dos 7 dias grátis.
        """
        self._ensure_provider_ready()
        self._ensure_no_environment_mismatch(payer_email)
        resolved_back_url = back_url or f"{settings.KOMA_PUBLIC_APP_URL}/legal/contrato/confirmacao"
        gateway_payer_email = self._resolve_gateway_payer_email(payer_email)
        payload = self._recurring_payload(
            protocol=protocol,
            plan=plan,
            billing_cycle=billing_cycle,
            amount=amount,
            payer_email=gateway_payer_email,
            trial_days=trial_days,
            back_url=resolved_back_url,
            status="pending",
        )

        if self.is_mock:
            mock_sub_id = f"mock-acc-money-{uuid.uuid4().hex[:12]}"
            return {
                "id": mock_sub_id,
                "status": "pending",
                "external_reference": protocol,
                "payer_email": payer_email,
                "auto_recurring": payload["auto_recurring"],
                "init_point": f"https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id={mock_sub_id}",
                "date_created": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            }

        try:
            with self._client() as client:
                resp = client.post(
                    "/preapproval",
                    json=payload,
                    headers={"X-Idempotency-Key": self._recurring_idempotency_key(protocol, "account-money")},
                )
                if resp.status_code >= 400:
                    data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
                    detail = data.get("message") or data.get("error") or resp.text
                    raise SaasMercadoPagoError(
                        f"Falha ao iniciar a autorização com Saldo Mercado Pago: {detail}",
                        status_code=resp.status_code,
                    )
                result = resp.json()
                if not result.get("id") or not result.get("init_point"):
                    raise SaasMercadoPagoError(
                        "O gateway não retornou o link de autorização do Saldo Mercado Pago.",
                        status_code=502,
                    )
                self._validate_merchant_identity(result)
                return result
        except httpx.RequestError as exc:
            raise SaasMercadoPagoError("Erro de comunicação ao iniciar o Saldo Mercado Pago.") from exc

    def find_preapproval(self, protocol: str, payer_email: str) -> dict[str, Any] | None:
        self._ensure_provider_ready()
        try:
            with self._client() as client:
                response = client.get("/preapproval/search", params={"payer_email": payer_email})
                if response.status_code >= 400:
                    raise SaasMercadoPagoError(
                        "Não foi possível recuperar a autorização.",
                        status_code=response.status_code,
                    )
                matches = [row for row in response.json().get("results", []) if str(row.get("external_reference")) == protocol]
                if len(matches) > 1:
                    raise SaasMercadoPagoError("Mais de uma autorização encontrada; revisão necessária.")
                if not matches:
                    return None
                match = matches[0]
                if os.getenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_COLLECTOR_ID") or os.getenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_APPLICATION_ID"):
                    preapproval_id = str(match.get("id") or "").strip()
                    if not preapproval_id:
                        raise SaasMercadoPagoError("Autorização recuperada sem identificador do provedor.")
                    return self.get_preapproval(preapproval_id)
                return match
        except httpx.RequestError as exc:
            raise SaasMercadoPagoError("Não foi possível recuperar a autorização.") from exc

    def get_authorized_payment(self, invoice_id: str) -> dict[str, Any]:
        self._ensure_provider_ready()
        try:
            with self._client() as client:
                response = client.get(f"/authorized_payments/{invoice_id}")
                if response.status_code >= 400:
                    raise SaasMercadoPagoError(
                        "Não foi possível consultar a cobrança.",
                        status_code=response.status_code,
                    )
                return response.json()
        except httpx.RequestError as exc:
            raise SaasMercadoPagoError("Falha ao consultar a cobrança.") from exc

    def get_preapproval(self, preapproval_id: str) -> dict[str, Any]:
        self._ensure_provider_ready()
        if self.is_mock:
            if preapproval_id.startswith("mock-acc-money-"):
                mock_method = "account_money"
            elif preapproval_id.startswith("mock-pix-auto-"):
                mock_method = "pix"
            else:
                mock_method = "visa"
            return {
                "id": preapproval_id,
                "status": "authorized",
                "payment_method_id": mock_method,
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
                result = resp.json()
                self._validate_merchant_identity(result)
                return result
        except httpx.RequestError as exc:
            raise SaasMercadoPagoError("Erro de comunicação ao consultar assinatura.") from exc

    def update_preapproval_amount(
        self,
        preapproval_id: str,
        *,
        amount: Decimal,
        plan: str,
    ) -> dict[str, Any]:
        """Atualiza somente o valor da recorrência existente, sem trocar ciclo ou meio."""
        self._ensure_provider_ready()
        clean_id = preapproval_id.strip()
        if not clean_id:
            raise SaasMercadoPagoError(
                "ID de preapproval inválido para atualização de plano.",
                status_code=400,
            )
        normalized_amount = Decimal(str(amount)).quantize(Decimal("0.01"))
        if normalized_amount <= 0:
            raise SaasMercadoPagoError(
                "Uma recorrência existente não pode ser atualizada para valor zero.",
                status_code=422,
            )
        payload = {
            "reason": f"KÔMA - Plano {plan.strip().capitalize()}",
            "auto_recurring": {
                "transaction_amount": float(normalized_amount),
                "currency_id": "BRL",
            },
        }
        if self.is_mock:
            return {
                "id": clean_id,
                "status": "authorized",
                "reason": payload["reason"],
                "auto_recurring": payload["auto_recurring"],
            }
        try:
            with self._client() as client:
                resp = client.put(f"/preapproval/{clean_id}", json=payload)
                if resp.status_code >= 400:
                    data = (
                        resp.json()
                        if resp.headers.get("content-type", "").startswith("application/json")
                        else {}
                    )
                    detail = data.get("message") or data.get("error") or resp.text
                    raise SaasMercadoPagoError(
                        f"Atualização de valor da assinatura falhou: {detail}",
                        status_code=resp.status_code,
                    )
                result = resp.json()
                self._validate_merchant_identity(result)
                return result
        except httpx.RequestError as exc:
            raise SaasMercadoPagoError(
                "Erro de comunicação ao atualizar o valor da assinatura."
            ) from exc

    def cancel_preapproval(self, preapproval_id: str) -> dict[str, Any]:
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
                result = resp.json()
                self._validate_merchant_identity(result)
                return result
        except httpx.RequestError as exc:
            raise SaasMercadoPagoError("Erro de comunicação ao cancelar assinatura.") from exc

    def update_preapproval_next_payment_date(
        self,
        preapproval_id: str,
        next_payment_date: datetime.datetime,
    ) -> dict[str, Any]:
        self._ensure_provider_ready()
        clean_id = preapproval_id.strip()
        if not clean_id:
            raise SaasMercadoPagoError("ID de preapproval inválido para sincronização.", status_code=400)
        iso_date = next_payment_date.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        if self.is_mock:
            return {"id": clean_id, "next_payment_date": iso_date, "status": "authorized"}
        try:
            with self._client() as client:
                resp = client.put(f"/preapproval/{clean_id}", json={"next_payment_date": iso_date})
                if resp.status_code >= 400:
                    data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
                    detail = data.get("message") or data.get("error") or resp.text
                    raise SaasMercadoPagoError(
                        f"Falha ao sincronizar início de cobrança com o gateway: {detail}",
                        status_code=resp.status_code,
                    )
                result = resp.json()
                self._validate_merchant_identity(result)
                return result
        except httpx.RequestError as exc:
            raise SaasMercadoPagoError("Erro de comunicação ao sincronizar início de cobrança com o gateway.") from exc

    def get_payment(self, payment_id: str) -> dict[str, Any]:
        """Consulta pagamentos legados somente para reconciliação; novas assinaturas não criam Pix avulso."""
        self._ensure_provider_ready()
        if self.is_mock:
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
            environment = os.getenv("ENVIRONMENT", "production").strip().lower()
            return environment in {"test", "development"}
        return verify_mercado_pago_signature(
            signature_header=signature_header,
            request_id=request_id,
            data_id=data_id,
            secret=secret,
        )


default_saas_mp_service = SaasMercadoPagoService()
