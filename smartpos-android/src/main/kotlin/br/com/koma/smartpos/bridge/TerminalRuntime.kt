package br.com.koma.smartpos.bridge

class TerminalRuntime(
    private val backend: TerminalBackendApi,
    private val coordinator: TerminalCoordinator,
    private val provider: String,
    private val terminalId: String,
) {
    fun runOnce(intentId: String, operationKey: String): TerminalResultAck {
        val command = backend.prepare(
            intentId = intentId,
            provider = provider,
            operationKey = operationKey,
            terminalId = terminalId,
        )
        require(command.intentId == intentId) { "Backend retornou intent divergente" }
        require(command.provider == provider) { "Backend retornou provider divergente" }
        require(command.operationKey == operationKey) { "Backend retornou operationKey divergente" }
        require(command.terminalId == terminalId) { "Backend retornou terminal divergente" }

        val result = coordinator.handle(command)
        return backend.submitResult(command, result)
    }
}
