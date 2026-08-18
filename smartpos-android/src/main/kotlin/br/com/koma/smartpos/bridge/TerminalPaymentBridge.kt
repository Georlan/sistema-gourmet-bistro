package br.com.koma.smartpos.bridge

interface TerminalPaymentBridge {
    fun charge(command: TerminalCommand): TerminalPaymentResult
    fun reconcile(command: TerminalCommand): TerminalPaymentResult
}

interface OperationStore {
    fun get(operationKey: String): LocalOperation?
    fun put(operation: LocalOperation)
}

class InMemoryOperationStore : OperationStore {
    private val operations = mutableMapOf<String, LocalOperation>()
    override fun get(operationKey: String): LocalOperation? = operations[operationKey]
    override fun put(operation: LocalOperation) { operations[operation.operationKey] = operation }
}
