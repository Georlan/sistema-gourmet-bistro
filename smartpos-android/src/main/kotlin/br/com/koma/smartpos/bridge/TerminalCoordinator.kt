package br.com.koma.smartpos.bridge

class TerminalCoordinator(
    private val bridge: TerminalPaymentBridge,
    private val store: OperationStore,
) {
    fun handle(command: TerminalCommand): TerminalPaymentResult {
        require(command.operationKey.length >= 8) { "operationKey inválida" }
        require(command.terminalId.isNotBlank()) { "terminalId obrigatório" }

        val existing = store.get(command.operationKey)
        if (existing != null) {
            require(existing.intentId == command.intentId) { "intent divergente" }
            require(existing.provider == command.provider) { "provider divergente" }
            require(existing.terminalId == command.terminalId) { "terminal divergente" }

            existing.lastResult?.let { cached ->
                if (cached.outcome == PaymentOutcome.APPROVED || cached.outcome == PaymentOutcome.DECLINED) {
                    return cached
                }
            }

            val result = try {
                bridge.reconcile(command.copy(mode = CommandMode.RECONCILE, shouldExecute = false))
            } catch (exc: Exception) {
                TerminalPaymentResult(
                    outcome = PaymentOutcome.ERROR,
                    message = exc.message ?: "Falha ao reconciliar operação no bridge.",
                )
            }
            store.put(existing.copy(lastResult = result))
            return result
        }

        if (command.mode != CommandMode.CHARGE || !command.shouldExecute) {
            return TerminalPaymentResult(
                outcome = PaymentOutcome.ERROR,
                message = "Operação local inexistente; reconciliação não pode iniciar nova cobrança.",
            )
        }

        // Reserva localmente antes de chamar o SDK. Se o processo morrer depois
        // daqui, o próximo boot entra em reconcile e nunca dispara charge outra vez.
        val reserved = LocalOperation(
            intentId = command.intentId,
            provider = command.provider,
            operationKey = command.operationKey,
            terminalId = command.terminalId,
        )
        store.put(reserved)

        val result = try {
            bridge.charge(command)
        } catch (exc: Exception) {
            TerminalPaymentResult(
                outcome = PaymentOutcome.ERROR,
                message = exc.message ?: "Falha ao executar cobrança no bridge.",
            )
        }
        store.put(reserved.copy(lastResult = result))
        return result
    }
}
