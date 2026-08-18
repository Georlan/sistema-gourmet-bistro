from dataclasses import dataclass

from sqlalchemy.orm import Session

from .payment_providers.base import (
    PaymentProvider,
    PaymentProviderRequest,
    PaymentProviderResult,
    ProviderOutcome,
)
from .smartpos_payment_state import InvalidSmartPosTransition, transition_intent
from ..smartpos_models import SmartPosPaymentIntent


class SmartPosProviderError(RuntimeError):
    pass


@dataclass(frozen=True)
class ProviderExecution:
    intent: SmartPosPaymentIntent
    result: PaymentProviderResult | None
    replayed: bool = False


def execute_provider_payment(
    db: Session,
    *,
    intent: SmartPosPaymentIntent,
    provider: PaymentProvider,
    operation_key: str,
    terminal_id: str,
    actor_id: str,
) -> ProviderExecution:
    key = operation_key.strip()
    terminal = terminal_id.strip()
    if len(key) < 8:
        raise SmartPosProviderError("A chave da operação do provider deve possuir ao menos 8 caracteres úteis.")
    if not terminal:
        raise SmartPosProviderError("O terminal_id é obrigatório para processar no provider.")
    if intent.captura != "provider_integrado":
        raise SmartPosProviderError("Este PaymentIntent não usa captura por provider integrado.")

    capabilities = provider.capabilities()
    if intent.metodo not in capabilities.methods:
        raise SmartPosProviderError("O provider selecionado não suporta este método de pagamento.")

    if intent.provider_operation_key is not None and intent.provider_operation_key != key:
        raise SmartPosProviderError("Este PaymentIntent já está vinculado a outra operação do provider.")
    if intent.provider_name is not None and intent.provider_name != provider.name:
        raise SmartPosProviderError("Este PaymentIntent já está vinculado a outro provider.")

    if intent.status in {"aprovada", "recusada", "cancelada", "expirada"}:
        return ProviderExecution(intent=intent, result=None, replayed=True)

    if intent.provider_operation_key is None:
        if intent.status != "criada":
            raise SmartPosProviderError("Só uma intenção criada pode iniciar uma nova operação de provider.")
        intent.provider_name = provider.name
        intent.provider_operation_key = key
        transition_intent(
            db,
            intent=intent,
            target_status="pendente",
            transition_key=f"provider:{key}:queued",
            actor_id=actor_id,
            motivo=f"Operação preparada para o provider {provider.name}.",
        )
        transition_intent(
            db,
            intent=intent,
            target_status="processando",
            transition_key=f"provider:{key}:processing",
            actor_id=actor_id,
            motivo=f"Operação enviada ao provider {provider.name}.",
        )
        db.commit()
        db.refresh(intent)
    elif intent.status not in {"processando"}:
        raise SmartPosProviderError(
            "A operação do provider só pode ser reconciliada enquanto estiver processando."
        )

    result = provider.execute(
        PaymentProviderRequest(
            intent_id=intent.id,
            restaurante_id=intent.restaurante_id,
            terminal_id=terminal,
            operation_key=key,
            amount=intent.valor,
            method=intent.metodo,
        )
    )

    intent.provider_reference = result.reference or intent.provider_reference
    intent.provider_last_error = result.message if result.outcome in {ProviderOutcome.TIMEOUT, ProviderOutcome.ERROR} else None

    try:
        if result.outcome == ProviderOutcome.APPROVED:
            transition_intent(
                db,
                intent=intent,
                target_status="aprovada",
                transition_key=f"provider:{key}:approved",
                actor_id=actor_id,
                motivo=result.message,
            )
        elif result.outcome == ProviderOutcome.DECLINED:
            transition_intent(
                db,
                intent=intent,
                target_status="recusada",
                transition_key=f"provider:{key}:declined",
                actor_id=actor_id,
                motivo=result.message,
            )
        elif result.outcome in {ProviderOutcome.PENDING, ProviderOutcome.TIMEOUT, ProviderOutcome.ERROR}:
            # Estado permanece processando. O mesmo operation_key deve ser
            # reconciliado novamente; nunca se inicia uma segunda cobrança.
            pass
        else:
            raise SmartPosProviderError("Resultado desconhecido retornado pelo provider.")
        db.commit()
    except InvalidSmartPosTransition as exc:
        db.rollback()
        raise SmartPosProviderError(str(exc)) from exc

    db.refresh(intent)
    return ProviderExecution(intent=intent, result=result, replayed=False)
