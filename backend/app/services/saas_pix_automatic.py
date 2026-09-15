from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from .saas_mercadopago import SaasMercadoPagoError


@dataclass(frozen=True)
class PixAutomaticCapability:
    enabled: bool
    mode: str
    provider: str
    receiver: str
    interoperability: str
    qr_authorization_required: bool
    copy_paste_authorization_required: bool
    reason: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "mode": self.mode,
            "provider": self.provider,
            "receiver": self.receiver,
            "interoperability": self.interoperability,
            "qrAuthorizationRequired": self.qr_authorization_required,
            "copyPasteAuthorizationRequired": self.copy_paste_authorization_required,
            "reason": self.reason,
        }


UNIVERSAL_PIX_AUTOMATIC_CAPABILITY = PixAutomaticCapability(
    enabled=False,
    mode="universal_pix_automatic",
    provider="mercado_pago",
    receiver="koma_mercado_pago_account",
    interoperability="spi_any_compatible_payer_psp",
    qr_authorization_required=True,
    copy_paste_authorization_required=True,
    reason="provider_receiver_api_not_configured",
)


class UniversalPixAutomaticService:
    """Fronteira do Pix Automático oficial/interoperável do KÔMA.

    Regra de produto:
    - o recebedor é a conta Mercado Pago do KÔMA;
    - o pagador deve conseguir autorizar em qualquer PSP/banco compatível com
      Pix Automático, sem login obrigatório no Mercado Pago;
    - a jornada precisa expor QR Code e/ou Pix Copia e Cola de autorização da
      recorrência, não um Pix avulso e não um checkout hospedado de assinatura;
    - nenhuma implementação pode se anunciar como disponível antes de cumprir
      estes requisitos e de receber confirmação assíncrona da autorização.

    A API pública atualmente integrada no repositório não expõe esse contrato.
    Por isso este adapter é deliberadamente fail-closed. Quando o Mercado Pago
    habilitar/fornecer a API recebedora de Pix Automático, a implementação entra
    aqui sem reabrir o fluxo legado de `/preapproval_plan`.
    """

    capability = UNIVERSAL_PIX_AUTOMATIC_CAPABILITY

    def create_authorization(
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
        del protocol, plan, billing_cycle, amount, payer_email, back_url, trial_days
        raise SaasMercadoPagoError(
            "Pix Automático universal ainda não está habilitado pelo PSP recebedor. "
            "O KÔMA só liberará este método quando houver autorização interoperável por QR Code/Copia e Cola em qualquer banco compatível.",
            status_code=503,
        )


universal_pix_automatic_service = UniversalPixAutomaticService()
