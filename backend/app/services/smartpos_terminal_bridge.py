from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy.orm import Session

from .payment_providers.base import ProviderOutcome
from .smartpos_payment_state import InvalidSmartPosTransition, transition_intent
from ..smartpos_models import SmartPosPaymentIntent


_TERMINAL_PROVIDER_METHODS = {
    "pagbank": frozenset({"pix", "debito", "credito", "voucher"}),
}
_TERMINAL_STATUSES = {"aprovada", "recusada", "cancelada", "expirada"}


class SmartPosTerminalBridgeError(RuntimeError):
    pass


@dataclass(frozen=True)
class TerminalPaymentCommand:
    intent_id: str
    restaurante_id: int
    provider: str
    operation_key: str
    terminal_id: str
    amount: Decimal
    method: str
    mode: str
    should_execute: bool


@dataclass(frozen=True)
class TerminalResultApplication:
    intent: SmartPosPaymentIntent
    replayed: bool = False


def _normalize_binding(*, provider: str, operation_key: str, terminal_id: str) -> tuple[str, str, str]:
    provider_name = provider.strip().lower()
    key = operation_key.strip()
    terminal = terminal_id.strip()
    if provider_name not in _TERMINAL_PROVIDER_METHODS:
        raise SmartPosTerminalBridgeError("Provider de terminal não suportado pelo bridge.")
    if len(key) < 8:
        raise SmartPosTerminalBridgeError("A chave da operação do provider deve possuir ao menos 8 caracteres úteis.")
    if not terminal:
        raise SmartPosTerminalBridgeError("O terminal_id é obrigatório.")
    return provider_name, key, terminal


def prepare_terminal_command(
    db: Session,
    *,
    intent: SmartPosPaymentIntent,
    provider: str,
    operation_key: str,
    terminal_id: str,
    actor_id: str,
) -> TerminalPaymentCommand:
    provider_name, key, terminal = _normalize_binding(
        provider=provider,
        operation_key=operation_key,
        terminal_id=terminal_id,
    )
    if intent.captura != "provider_integrado":
        raise SmartPosTerminalBridgeError("Este PaymentIntent não usa captura por provider integrado.")
    if intent.metodo not in _TERMINAL_PROVIDER_METHODS[provider_name]:
        raise SmartPosTerminalBridgeError("O provider selecionado não suporta este método de pagamento.")

    if intent.provider_name is not None and intent.provider_name != provider_name:
        raise SmartPosTerminalBridgeError("Este PaymentIntent já está vinculado a outro provider.")
    if intent.provider_operation_key is not None and intent.provider_operation_key != key:
        raise SmartPosTerminalBridgeError("Este PaymentIntent já está vinculado a outra operação do provider.")
    if intent.provider_terminal_id is not None and intent.provider_terminal_id != terminal:
        raise SmartPosTerminalBridgeError("Este PaymentIntent já está vinculado a outro terminal.")

    if intent.status in _TERMINAL_STATUSES:
        return TerminalPaymentCommand(
            intent_id=intent.id,
            restaurante_id=intent.restaurante_id,
            provider=provider_name,
            operation_key=key,
            terminal_id=terminal,
            amount=Decimal(str(intent.valor)),
            method=intent.metodo,
            mode="terminal",
            should_execute=False,
        )

    if intent.provider_operation_key is None:
        if intent.status != "criada":
            raise SmartPosTerminalBridgeError("Só uma intenção criada pode iniciar uma nova operação no terminal.")
        intent.provider_name = provider_name
        intent.provider_operation_key = key
        intent.provider_terminal_id = terminal
        try:
            transition_intent(
                db,
                intent=intent,
                target_status="pendente",
                transition_key=f"bridge:{key}:queued",
                actor_id=actor_id,
                motivo=f"Operação reservada para o terminal {terminal} ({provider_name}).",
            )
            transition_intent(
                db,
                intent=intent,
                target_status="processando",
                transition_key=f"bridge:{key}:processing",
                actor_id=actor_id,
                motivo=f"Comando liberado ao terminal {terminal} ({provider_name}).",
            )
            db.commit()
        except InvalidSmartPosTransition as exc:
            db.rollback()
            raise SmartPosTerminalBridgeError(str(exc)) from exc
        db.refresh(intent)
        return TerminalPaymentCommand(
            intent_id=intent.id,
            restaurante_id=intent.restaurante_id,
            provider=provider_name,
            operation_key=key,
            terminal_id=terminal,
            amount=Decimal(str(intent.valor)),
            method=intent.metodo,
            mode="charge",
            should_execute=True,
        )

    if intent.status != "processando":
        raise SmartPosTerminalBridgeError("A operação vinculada ao terminal não está em estado reconciliável.")

    # Depois que o terminal já recebeu o primeiro comando, nunca reenviamos
    # automaticamente uma nova cobrança. Em reinício/retry o bridge deve
    # reconciliar a operação local usando a mesma operation_key.
    return TerminalPaymentCommand(
        intent_id=intent.id,
        restaurante_id=intent.restaurante_id,
        provider=provider_name,
        operation_key=key,
        terminal_id=terminal,
        amount=Decimal(str(intent.valor)),
        method=intent.metodo,
        mode="reconcile",
        should_execute=False,
    )


def apply_terminal_result(
    db: Session,
    *,
    intent: SmartPosPaymentIntent,
    provider: str,
    operation_key: str,
    terminal_id: str,
    outcome: ProviderOutcome,
    reference: str | None,
    message: str | None,
    actor_id: str,
) -> TerminalResultApplication:
    provider_name, key, terminal = _normalize_binding(
        provider=provider,
        operation_key=operation_key,
        terminal_id=terminal_id,
    )
    if intent.provider_name != provider_name:
        raise SmartPosTerminalBridgeError("Resultado recebido de provider diferente do vinculado ao PaymentIntent.")
    if intent.provider_operation_key != key:
        raise SmartPosTerminalBridgeError("Resultado recebido para uma operation_key diferente da vinculada.")
    if intent.provider_terminal_id != terminal:
        raise SmartPosTerminalBridgeError("Resultado recebido de terminal diferente do vinculado.")

    target = None
    if outcome == ProviderOutcome.APPROVED:
        target = "aprovada"
    elif outcome == ProviderOutcome.DECLINED:
        target = "recusada"

    if intent.status in _TERMINAL_STATUSES:
        expected = {"aprovada": ProviderOutcome.APPROVED, "recusada": ProviderOutcome.DECLINED}.get(intent.status)
        if expected == outcome:
            return TerminalResultApplication(intent=intent, replayed=True)
        raise SmartPosTerminalBridgeError("O PaymentIntent já terminou com outro resultado.")

    if intent.status != "processando":
        raise SmartPosTerminalBridgeError("O PaymentIntent não está aguardando resultado do terminal.")

    intent.provider_reference = (reference or "").strip() or intent.provider_reference
    if outcome in {ProviderOutcome.TIMEOUT, ProviderOutcome.ERROR}:
        intent.provider_last_error = (message or "").strip() or outcome.value
    elif outcome in {ProviderOutcome.APPROVED, ProviderOutcome.DECLINED, ProviderOutcome.PENDING}:
        intent.provider_last_error = None

    if target is not None:
        try:
            transition_intent(
                db,
                intent=intent,
                target_status=target,
                transition_key=f"bridge:{key}:{outcome.value}",
                actor_id=actor_id,
                motivo=(message or "").strip() or f"Resultado {outcome.value} recebido do terminal.",
            )
        except InvalidSmartPosTransition as exc:
            db.rollback()
            raise SmartPosTerminalBridgeError(str(exc)) from exc

    db.commit()
    db.refresh(intent)
    return TerminalResultApplication(intent=intent, replayed=False)
