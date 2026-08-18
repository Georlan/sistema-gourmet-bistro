# Kôma SmartPOS Android Bridge

Núcleo Kotlin isolado para o futuro app Android da SmartPOS.

## Regra de segurança

`charge` só pode executar uma vez por `operationKey`. Antes de chamar o SDK, a operação é reservada no armazenamento local. Se o processo reiniciar, a mesma operação entra obrigatoriamente em `reconcile`; nunca em nova cobrança.

Hoje usamos `FakeTerminalPaymentBridge`. Quando houver terminal DEBUG/SDK PagBank, a implementação real entrará atrás da mesma interface `TerminalPaymentBridge`.

O módulo não conhece `Pagamento`, ledger, comanda ou mesa e não produz efeito financeiro.
