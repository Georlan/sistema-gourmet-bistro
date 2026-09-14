from __future__ import annotations

from decimal import Decimal
from typing import Any

import httpx

from ..config import settings
from .saas_mercadopago import SaasMercadoPagoError, SaasMercadoPagoService


_PLAN_PREFIX = "plan:"
_HOSTED_METHOD_IDS = {
    "pix_automatic": "pix",
    "account_money": "account_money",
}


class HostedPlanSaasMercadoPagoService(SaasMercadoPagoService):
    """Mercado Pago SaaS gateway with hosted subscription-plan checkout.

    Cartão continua no fluxo `/preapproval` já homologado. Pix e saldo usam um
    plano exclusivo por protocolo e o `init_point` de `/preapproval_plan`, pois o
    checkout hospedado de planos é o produto do Mercado Pago que documenta Pix e
    dinheiro em conta como meios de assinatura.

    Enquanto o comprador não conclui o checkout, `provider_subscription_id`
    recebe `plan:<id>`. Assim que o Mercado Pago cria a assinatura real, a rota
    reconcilia o `subscription_preapproval` e substitui o identificador do plano
    pelo ID real do preapproval.
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
    def _plan_payload(
        *,
        protocol: str,
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
            "external_reference": protocol,
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
        resolved_back_url = back_url or f"{settings.KOMA_PUBLIC_APP_URL}/legal/contrato/confirmacao"
        payload = self._plan_payload(
            protocol=protocol,
            plan=plan,
            billing_cycle=billing_cycle,
            amount=amount,
            trial_days=trial_days,
            back_url=resolved_back_url,
            provider_payment_method=provider_payment_method,
        )

        # Mocks continuam exercitando o fluxo antigo, que já possui regressões
        # determinísticas e não depende do checkout hospedado externo.
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
                plan_id = str(result.get("id") or "").strip()
                init_point = str(result.get("init_point") or "").strip()
                if not plan_id or not init_point:
                    raise SaasMercadoPagoError(
                        "O Mercado Pago não retornou o link do plano de assinatura.",
                        status_code=502,
                    )
                self._validate_merchant_identity(result)
                return {
                    **result,
                    "id": self._plan_storage_id(plan_id),
                    "provider_plan_id": plan_id,
                    "status": "pending",
                    "external_reference": protocol,
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
                self._validate_merchant_identity(result)
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

    @staticmethod
    def _enrich_mandate_from_plan(mandate: dict[str, Any], plan: dict[str, Any]) -> dict[str, Any]:
        result = dict(mandate)
        if not result.get("external_reference"):
            result["external_reference"] = plan.get("external_reference")
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
            "external_reference": plan.get("external_reference"),
            "auto_recurring": plan.get("auto_recurring") or {},
            "init_point": plan.get("init_point"),
            "preapproval_plan_id": plan_id,
        }

    def get_preapproval(self, preapproval_id: str) -> dict[str, Any]:
        plan_id = self._raw_plan_id(preapproval_id)
        if plan_id:
            return self._resolve_plan_checkout(plan_id)

        try:
            mandate = super().get_preapproval(preapproval_id)
        except SaasMercadoPagoError as exc:
            # Compatibilidade defensiva: se algum registro tiver armazenado um
            # plan ID sem prefixo durante uma tentativa parcial, ainda conseguimos
            # recuperá-lo sem criar outro plano.
            if exc.status_code != 404 or self.is_mock:
                raise
            try:
                return self._resolve_plan_checkout(preapproval_id)
            except SaasMercadoPagoError as plan_exc:
                if plan_exc.status_code == 404:
                    raise exc
                raise

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
                    if str(row.get("external_reference") or "").strip().upper() == protocol.strip().upper()
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
