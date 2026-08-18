package br.com.koma.smartpos.bridge

class FakeTerminalPaymentBridge(
    private var nextChargeResult: TerminalPaymentResult = TerminalPaymentResult(PaymentOutcome.APPROVED, "fake-approved"),
    private var nextReconcileResult: TerminalPaymentResult = nextChargeResult,
) : TerminalPaymentBridge {
    var chargeCalls: Int = 0
        private set
    var reconcileCalls: Int = 0
        private set

    fun setChargeResult(result: TerminalPaymentResult) { nextChargeResult = result }
    fun setReconcileResult(result: TerminalPaymentResult) { nextReconcileResult = result }

    override fun charge(command: TerminalCommand): TerminalPaymentResult {
        chargeCalls += 1
        return nextChargeResult
    }

    override fun reconcile(command: TerminalCommand): TerminalPaymentResult {
        reconcileCalls += 1
        return nextReconcileResult
    }
}
