package br.com.koma.smartpos.bridge

import kotlin.test.Test
import kotlin.test.assertEquals

class TerminalAdversarialOutcomesTest {
    private fun command() = TerminalCommand(
        intentId = "intent-adversarial",
        restauranteId = 1,
        provider = "pagbank",
        operationKey = "operation-adversarial",
        terminalId = "DEV-ANDROID-01",
        amountMinor = 4200,
        method = "credito",
        mode = CommandMode.CHARGE,
        shouldExecute = true,
    )

    @Test
    fun declinedResultIsFinalLocallyAndNeverChargesAgain() {
        val bridge = FakeTerminalPaymentBridge(
            nextChargeResult = TerminalPaymentResult(PaymentOutcome.DECLINED, reference = "fake-declined"),
        )
        val coordinator = TerminalCoordinator(bridge, InMemoryOperationStore())

        val first = coordinator.handle(command())
        val replay = coordinator.handle(command())

        assertEquals(PaymentOutcome.DECLINED, first.outcome)
        assertEquals(PaymentOutcome.DECLINED, replay.outcome)
        assertEquals(1, bridge.chargeCalls)
        assertEquals(0, bridge.reconcileCalls)
    }

    @Test
    fun timeoutIsReconciledInsteadOfStartingASecondCharge() {
        val bridge = FakeTerminalPaymentBridge(
            nextChargeResult = TerminalPaymentResult(PaymentOutcome.TIMEOUT, message = "timeout simulado"),
            nextReconcileResult = TerminalPaymentResult(PaymentOutcome.APPROVED, reference = "fake-approved-after-timeout"),
        )
        val coordinator = TerminalCoordinator(bridge, InMemoryOperationStore())

        assertEquals(PaymentOutcome.TIMEOUT, coordinator.handle(command()).outcome)
        assertEquals(PaymentOutcome.APPROVED, coordinator.handle(command()).outcome)
        assertEquals(1, bridge.chargeCalls)
        assertEquals(1, bridge.reconcileCalls)
    }

    @Test
    fun providerErrorIsReconciledInsteadOfStartingASecondCharge() {
        val bridge = FakeTerminalPaymentBridge(
            nextChargeResult = TerminalPaymentResult(PaymentOutcome.ERROR, message = "erro simulado"),
            nextReconcileResult = TerminalPaymentResult(PaymentOutcome.DECLINED, reference = "fake-declined-after-error"),
        )
        val coordinator = TerminalCoordinator(bridge, InMemoryOperationStore())

        assertEquals(PaymentOutcome.ERROR, coordinator.handle(command()).outcome)
        assertEquals(PaymentOutcome.DECLINED, coordinator.handle(command()).outcome)
        assertEquals(1, bridge.chargeCalls)
        assertEquals(1, bridge.reconcileCalls)
    }

    @Test
    fun pendingMayRemainPendingAcrossReconciliationWithoutDuplicateCharge() {
        val bridge = FakeTerminalPaymentBridge(
            nextChargeResult = TerminalPaymentResult(PaymentOutcome.PENDING),
            nextReconcileResult = TerminalPaymentResult(PaymentOutcome.PENDING),
        )
        val coordinator = TerminalCoordinator(bridge, InMemoryOperationStore())

        assertEquals(PaymentOutcome.PENDING, coordinator.handle(command()).outcome)
        assertEquals(PaymentOutcome.PENDING, coordinator.handle(command()).outcome)
        assertEquals(1, bridge.chargeCalls)
        assertEquals(1, bridge.reconcileCalls)
    }
}
