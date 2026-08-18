package br.com.koma.smartpos.bridge

enum class CommandMode { CHARGE, RECONCILE, TERMINAL }
enum class PaymentOutcome { APPROVED, DECLINED, PENDING, TIMEOUT, ERROR }

data class TerminalCommand(
    val intentId: String,
    val restauranteId: Int,
    val provider: String,
    val operationKey: String,
    val terminalId: String,
    val amountMinor: Long,
    val method: String,
    val mode: CommandMode,
    val shouldExecute: Boolean,
)

data class TerminalPaymentResult(
    val outcome: PaymentOutcome,
    val reference: String? = null,
    val message: String? = null,
)

data class LocalOperation(
    val provider: String,
    val operationKey: String,
    val terminalId: String,
    val started: Boolean = true,
    val lastResult: TerminalPaymentResult? = null,
)
