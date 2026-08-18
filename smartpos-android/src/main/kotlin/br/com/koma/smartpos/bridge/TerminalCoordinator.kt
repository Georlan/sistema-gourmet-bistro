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
            require(existing.provider == command.provider) { "provider divergente" }
            require(existing.terminalId == command.terminalId) { "terminal divergente" }
            val result = bridge.reconcile(command.copy(mode = CommandMode.RECONCILE, shouldExecute = false))
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
        store.put(LocalOperation(command.provider, command.operationKey, command.terminalId))
        val result = bridge.charge(command)
        store.put(LocalOperation(command.provider, command.operationKey, command.terminalId, lastResult = result))
        return result
    }
}
