from __future__ import annotations

import os
from decimal import Decimal
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import httpx

from ..config import settings
from .saas_mercadopago import SaasMercadoPagoError, SaasMercadoPagoService


_PLAN_PREFIX = "plan:"
_HOSTED_METHOD_IDS = {
    "pix_automatic": "pix",
    "account_money": "account_money",
}
_PROTOCOL_QUERY_KEY = "koma_protocol"


class HostedPlanSaasMercadoPagoService(SaasMercadoPagoService):
    """Gateway alternativo para meios recorrentes do checkout hospedado.

    O cartão permanece no `/preapproval` já homologado. Pix e Saldo Mercado
    Pago usam o `init_point` de `/preapproval_plan`, que é o checkout hospedado
    onde o provedor documenta `payment_methods_allowed`, teste grátis e os meios
    de assinatura disponíveis no Brasil.

    Antes da autorização real, o identificador local é `plan:<id>`. A camada de
    billing persiste esse marcador separadamente do ID da assinatura; quando o
    Mercado Pago cria o preapproval real, o webhook reconcilia pelo
    `preapproval_plan_id` e passa a armazenar o ID definitivo da assinatura.
    """

    @staticmethod
    def _plan_storage_id(plan_id: str) -> str:
        return f"{_PLAN_PREFIX}{plan_id.strip()}"

    @staticmethod
    def _raw_plan_id(provider_id: str) -> str | None:
        clean = (provider_id or "").strip()
        if not clean.startswith(_PLAN_PREFIX):
            return None
        raw = clean[len(_PLAN_PREFIX):].strip()
        return raw or None

    @staticmethod
    def _back_url_for_protocol(base_url: str, protocol: str) -> str:
        parts = urlsplit(base_url)
        query = parse_qs(parts.query, keep_blank_values=True)
        query[_PROTOCOL_QUERY_KEY] = [protocol.strip().upper()]
        encoded = urlencode(query, doseq=True)
        return urlunsplit((parts.scheme, parts.netloc, parts.path, encoded, parts.fragment))

    @staticmethod
    def _protocol_from_plan(plan: dict[str, Any]) -> str:
        direct = str(plan.get("external_reference") or "").strip().upper()
        if direct:
            return direct
        back_url = str(plan.get("back_url") or "").strip()
        if not back_url:
            return ""
        values = parse_qs(urlsplit(back_url).query).get(_PROTOCOL_QUERY_KEY) or []
        return str(values[0] if values else "").strip().upper()

    @staticmethod
    def _expected_application_id() -> str:
        """Retorna a identidade efetiva da aplicação usada para emitir o token.

        Em produção o token runtime é criado com `MERCADO_PAGO_CLIENT_ID`; por
        isso esse Client ID é a fonte de verdade para `application_id` retornado
        pela API. A variável EXPECTED_APPLICATION_ID fica apenas como fallback
        legado para ambientes que não tenham Client ID configurado.
        """
        return (
            os.getenv("MERCADO_PAGO_CLIENT_ID", "").strip()
            or os.getenv("KOMA_SAAS_MERCADO_PAGO_EXPECTED_APPLICATION_ID", "").strip()
        )

    def _validate_merchant_identity(self, payload: dict[str, Any]) -> None:
        """Valida assinaturas usando a mesma aplicação que emitiu o token runtime.

        A classe base compara `application_id` com um valor auxiliar legado.
        Como esse valor pode ficar desatualizado enquanto o OAuth runtime usa um
        Client ID diferente, o gateway hospedado canoniza a identidade pelo
        `MERCADO_PAGO_CLIENT_ID`. Isso também cobre consultas e webhooks da
        assinatura real após o checkout.
        """
        if self.is_mock:
            return

        expected_collector = os.getenv(
            "KOMA_SAAS_MERCADO_PAGO_EXPECTED_COLLECTOR_ID", ""
        ).strip()
        expected_application = self._expected_application_id()
        collector_id = str(payload.get("collector_id") or "").strip()
        application_id = str(payload.get("application_id") or "").strip()

        if expected_collector and collector_id != expected_collector:
            raise SaasMercadoPagoError(
                "O Mercado Pago retornou uma conta recebedora diferente da conta KÔMA configurada.",
                status_code=409,
            )
        if expected_application and application_id != expected_application:
            raise SaasMercadoPagoError(
                "O Mercado Pago retornou uma aplicação diferente da aplicação usada pelas credenciais KÔMA.",
                status_code=409,
            )

    def _validate_hosted_plan_identity(self, payload: dict[str, Any]) -> None:
        """Valida IDs somente quando `/preapproval_plan` realmente os retorna.

        O endpoint de planos hospedados pode omitir `application_id` e/ou
        `collector_id`. Quando vierem, são comparados com a identidade efetiva:
        Client ID que emitiu o token runtime e collector esperado já configurado.
        """
        if self.is_mock:
            return

        expected_collector = os.getenv(
            "KOMA_SAAS_MERCADO_PAGO_EXPECTED_COLLECTOR_ID", ""
        ).strip()
        expected_application = self._expected_application_id()
        collector_id = str(payload.get("collector_id") or "").strip()
        application_id = str(payload.get("application_id") or "").strip()

        if expected_collector and collector_id and collector_id != expected_collector:
            raise SaasMercadoPagoError(
                "O Mercado Pago retornou uma conta recebedora diferente da conta KÔMA configurada.",
                status_code=409,
            )
        if expected_application and application_id and application_id != expected_application:
            raise SaasMercadoPagoError(
                "O Mercado Pago retornou uma aplicação diferente da aplicação usada pelas credenciais KÔMA.",
                status_code=409,
            )

    @staticmethod
    def _plan_payload(
        *,
        plan: str,
        billing_cycle: str,
        amount: Decimal,
        trial_days: int,
        back_url: str,
        provider_payment_method: str,
    ) -> dict[str, Any]:
        cycle_normalized = billing_cycle.strip().lower()
        is_annual = cycle_normalized in {"anual", "annual"}
        return {
            "reason": f"KÔMA - Plano {plan.capitalize()} ({'Anual' if is_annual else 'Mensal'})",
            "auto_recurring": {
                "frequency": 12 if is_annual else 1,
                "frequency_type": "months",
                "transaction_amount": float(amount),
                "currency_id": "BRL",
                "free_trial": {"frequency": trial_days, "frequency_type": "days"},
            },
            "payment_methods_allowed": {
                "payment_methods": [{"id": provider_payment_method}],
            },
            "back_url": back_url,
        }

    @staticmethod
    def _validate_hosted_plan_terms(
        payload: dict[str, Any],
        *,
        expected_amount: Decimal,
        billing_cycle: str,
    ) -> None:
        """Falha fechado se o provider devolver um plano com termos diferentes."""
        recurring = payload.get("auto_recurring")
        if not isinstance(recurring, dict) or not recurring:
            return

        expected = Decimal(str(expected_amount)).quantize(Decimal("0.01"))
        try:
            actual = Decimal(str(recurring.get("transaction_amount"))).quantize(
                Decimal("0.01")
            )
        except Exception as exc:
            raise SaasMercadoPagoError(
                "O Mercado Pago devolveu um plano sem valor financeiro válido.",
                status_code=409,
            ) from exc

        if actual != expected:
            raise SaasMercadoPagoError(
                "O Mercado Pago devolveu um plano com valor diferente do contrato.",
                status_code=409,
            )
        if str(recurring.get("currency_id") or "").upper() != "BRL":
            raise SaasMercadoPagoError(
                "O Mercado Pago devolveu um plano com moeda diferente do contrato.",
                status_code=409,
            )

        is_annual = billing_cycle.strip().lower() in {"anual", "annual"}
        expected_frequency = 12 if is_annual else 1
        if (
            int(recurring.get("frequency") or 0) != expected_frequency
            or str(recurring.get("frequency_type") or "").lower() != "months"
        ):
            raise SaasMercadoPagoError(
                "O Mercado Pago devolveu um plano com ciclo diferente do contrato.",
                status_code=409,
            )

    def _create_hosted_plan(
        self,
        *,
        protocol: str,
        plan: str,
        billing_cycle: str,
        amount: Decimal,
        payer_email: str,
        payment_method_type: str,
        back_url: str | None = None,
        trial_days: int = 7,
    ) -> dict[str, Any]:
        self._ensure_provider_ready()
        self._ensure_no_environment_mismatch(payer_email)
        provider_payment_method = _HOSTED_METHOD_IDS[payment_method_type]
        base_back_url = back_url or f"{settings.KOMA_PUBLIC_APP_URL}/legal/contrato/confirmacao"
        resolved_back_url = self._back_url_for_protocol(base_back_url, protocol)
        payload = self._plan_payload(
            plan=plan,
            billing_cycle=billing_cycle,
            amount=amount,
            trial_days=trial_days,
            back_url=resolved_back_url,
            provider_payment_method=provider_payment_method,
        )

        # Os mocks continuam no fluxo determinístico já coberto pela suíte.
        if self.is_mock:
            if payment_method_type == "pix_automatic":
                return super().create_pix_automatic_preapproval(
                    protocol=protocol,
                    plan=plan,
                    billing_cycle=billing_cycle,
                    amount=amount,
                    payer_email=payer_email,
                    back_url=back_url,
                    trial_days=trial_days,
                )
            return super().create_account_money_preapproval(
                protocol=protocol,
                plan=plan,
                billing_cycle=billing_cycle,
                amount=amount,
                payer_email=payer_email,
                back_url=back_url,
                trial_days=trial_days,
            )

        try:
            with self._client() as client:
                response = client.post(
                    "/preapproval_plan",
                    json=payload,
                    headers={
                        "X-Idempotency-Key": self._recurring_idempotency_key(
                            protocol,
                            f"hosted-plan-{payment_method_type}",
                        )
                    },
                )
                if response.status_code >= 400:
                    data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
                    detail = data.get("message") or data.get("error") or response.text
                    method_label = "Pix Automático" if payment_method_type == "pix_automatic" else "Saldo Mercado Pago"
                    raise SaasMercadoPagoError(
                        f"Falha ao criar o checkout recorrente de {method_label}: {detail}",
                        status_code=response.status_code,
                    )
                result = response.json()
                self._validate_hosted_plan_terms(
                    result,
                    expected_amount=amount,
                    billing_cycle=billing_cycle,
                )
                plan_id = str(result.get("id") or "").strip()
                init_point = str(result.get("init_point") or "").strip()
                if not plan_id or not init_point:
                    raise SaasMercadoPagoError(
                        "O Mercado Pago não retornou o link do plano de assinatura.",
                        status_code=502,
                    )
                self._validate_hosted_plan_identity(result)
                return {
                    **result,
                    "id": self._plan_storage_id(plan_id),
                    "provider_plan_id": plan_id,
                    "status": "pending",
                    "external_reference": protocol.strip().upper(),
                    "auto_recurring": result.get("auto_recurring") or payload["auto_recurring"],
                    "payment_methods_allowed": result.get("payment_methods_allowed") or payload["payment_methods_allowed"],
                    "init_point": init_point,
                }
        except httpx.RequestError as exc:
            raise SaasMercadoPagoError("Erro de comunicação ao criar o plano de assinatura no Mercado Pago.") from exc

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
        return self._create_hosted_plan(
            protocol=protocol,
            plan=plan,
            billing_cycle=billing_cycle,
            amount=amount,
            payer_email=payer_email,
            payment_method_type="pix_automatic",
            back_url=back_url,
            trial_days=trial_days,
        )

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
        return self._create_hosted_plan(
            protocol=protocol,
            plan=plan,
            billing_cycle=billing_cycle,
            amount=amount,
            payer_email=payer_email,
            payment_method_type="account_money",
            back_url=back_url,
            trial_days=trial_days,
        )

    def _get_plan(self, plan_id: str) -> dict[str, Any]:
        self._ensure_provider_ready()
        try:
            with self._client() as client:
                response = client.get(f"/preapproval_plan/{plan_id}")
                if response.status_code >= 400:
                    raise SaasMercadoPagoError(
                        f"Consulta de plano de assinatura falhou ({response.status_code}).",
                        status_code=response.status_code,
                    )
                result = response.json()
                self._validate_hosted_plan_identity(result)
                return result
        except httpx.RequestError as exc:
            raise SaasMercadoPagoError("Erro de comunicação ao consultar plano de assinatura.") from exc

    def _find_subscription_for_plan(self, plan_id: str) -> dict[str, Any] | None:
        self._ensure_provider_ready()
        try:
            with self._client() as client:
                response = client.get(
                    "/preapproval/search",
                    params={"preapproval_plan_id": plan_id, "limit": 20},
                )
                if response.status_code >= 400:
                    raise SaasMercadoPagoError(
                        "Não foi possível procurar a assinatura criada pelo checkout hospedado.",
                        status_code=response.status_code,
                    )
                rows = list(response.json().get("results", []) or [])
        except httpx.RequestError as exc:
            raise SaasMercadoPagoError("Erro de comunicação ao procurar assinatura do plano.") from exc

        active_rows = [
            row
            for row in rows
            if str(row.get("status") or "").strip().lower() not in {"cancelled", "canceled"}
        ]
        if len(active_rows) > 1:
            raise SaasMercadoPagoError(
                "Mais de uma assinatura ativa foi criada para a mesma contratação; revisão manual necessária.",
                status_code=409,
            )
        return active_rows[0] if active_rows else None

    def _enrich_mandate_from_plan(self, mandate: dict[str, Any], plan: dict[str, Any]) -> dict[str, Any]:
        result = dict(mandate)
        if not result.get("external_reference"):
            result["external_reference"] = self._protocol_from_plan(plan)
        plan_recurring = dict(plan.get("auto_recurring") or {})
        mandate_recurring = dict(result.get("auto_recurring") or {})
        merged_recurring = {**plan_recurring, **mandate_recurring}
        if not mandate_recurring.get("free_trial") and plan_recurring.get("free_trial"):
            merged_recurring["free_trial"] = plan_recurring["free_trial"]
        result["auto_recurring"] = merged_recurring
        result["preapproval_plan_id"] = result.get("preapproval_plan_id") or plan.get("id")
        return result

    def _resolve_plan_checkout(self, plan_id: str) -> dict[str, Any]:
        plan = self._get_plan(plan_id)
        subscription = self._find_subscription_for_plan(plan_id)
        if subscription:
            subscription_id = str(subscription.get("id") or "").strip()
            if subscription_id:
                subscription = super().get_preapproval(subscription_id)
            return self._enrich_mandate_from_plan(subscription, plan)

        return {
            "id": self._plan_storage_id(plan_id),
            "status": "pending",
            "external_reference": self._protocol_from_plan(plan),
            "auto_recurring": plan.get("auto_recurring") or {},
            "init_point": plan.get("init_point"),
            "preapproval_plan_id": plan_id,
        }

    def get_preapproval(self, preapproval_id: str) -> dict[str, Any]:
        plan_id = self._raw_plan_id(preapproval_id)
        if plan_id:
            return self._resolve_plan_checkout(plan_id)

        # IDs sem prefixo são SEMPRE tratados como IDs reais de assinatura.
        # Isso evita confundir eventos `subscription_preapproval_plan` com
        # `subscription_preapproval` no webhook existente.
        mandate = super().get_preapproval(preapproval_id)
        plan_id_from_mandate = str(mandate.get("preapproval_plan_id") or "").strip()
        if not plan_id_from_mandate:
            return mandate
        plan = self._get_plan(plan_id_from_mandate)
        return self._enrich_mandate_from_plan(mandate, plan)

    def find_preapproval(self, protocol: str, payer_email: str) -> dict[str, Any] | None:
        direct = super().find_preapproval(protocol, payer_email)
        if direct is not None:
            return direct
        if self.is_mock:
            return None

        wanted_protocol = protocol.strip().upper()
        try:
            with self._client() as client:
                response = client.get("/preapproval_plan/search", params={"limit": 100})
                if response.status_code >= 400:
                    raise SaasMercadoPagoError(
                        "Não foi possível recuperar o plano de assinatura da contratação.",
                        status_code=response.status_code,
                    )
                matches = [
                    row
                    for row in (response.json().get("results", []) or [])
                    if self._protocol_from_plan(row) == wanted_protocol
                    and str(row.get("status") or "active").strip().lower() == "active"
                ]
        except httpx.RequestError as exc:
            raise SaasMercadoPagoError("Erro de comunicação ao recuperar plano de assinatura.") from exc

        if len(matches) > 1:
            raise SaasMercadoPagoError(
                "Mais de um plano ativo foi encontrado para a mesma contratação; revisão manual necessária.",
                status_code=409,
            )
        if not matches:
            return None
        plan_id = str(matches[0].get("id") or "").strip()
        return self._resolve_plan_checkout(plan_id) if plan_id else None


def is_hosted_plan_provider_id(provider_id: str | None) -> bool:
    return bool(provider_id and str(provider_id).strip().startswith(_PLAN_PREFIX))


default_saas_mp_service = HostedPlanSaasMercadoPagoService()
