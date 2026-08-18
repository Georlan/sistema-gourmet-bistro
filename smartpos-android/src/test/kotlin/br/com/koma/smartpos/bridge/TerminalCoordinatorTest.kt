package br.com.koma.smartpos.bridge

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class TerminalCoordinatorTest {
    private fun command(mode: CommandMode = CommandMode.CHARGE, shouldExecute: Boolean = true, terminal: String = "POS-01") = TerminalCommand(
        intentId = "intent-1",
        restauranteId = 1,
        provider = "pagbank",
        operationKey = "operation-123",
        terminalId = terminal,
        amountMinor = 4200,
        method = "credito",
        mode = mode,
        shouldExecute = shouldExecute,
    )

    @Test
    fun duplicateChargeCommandNeverChargesTwice() {
        val bridge = FakeTerminalPaymentBridge()
        val coordinator = TerminalCoordinator(bridge, InMemoryOperationStore())

        assertEquals(PaymentOutcome.APPROVED, coordinator.handle(command()).outcome)
        assertEquals(PaymentOutcome.APPROVED, coordinator.handle(command()).outcome)
        assertEquals(1, bridge.chargeCalls)
        assertEquals(1, bridge.reconcileCalls)
    }

    @Test
    fun restartPathReconcilesWithoutStartingCharge() {
        val bridge = FakeTerminalPaymentBridge(nextReconcileResult = TerminalPaymentResult(PaymentOutcome.PENDING))
        val store = InMemoryOperationStore()
        store.put(LocalOperation("pagbank", "operation-123", "POS-01"))
        val coordinator = TerminalCoordinator(bridge, store)

        assertEquals(PaymentOutcome.PENDING, coordinator.handle(command(CommandMode.RECONCILE, false)).outcome)
        assertEquals(0, bridge.chargeCalls)
        assertEquals(1, bridge.reconcileCalls)
    }

    @Test
    fun missingLocalOperationCannotTurnReconcileIntoCharge() {
        val bridge = FakeTerminalPaymentBridge()
        val coordinator = TerminalCoordinator(bridge, InMemoryOperationStore())

        assertEquals(PaymentOutcome.ERROR, coordinator.handle(command(CommandMode.RECONCILE, false)).outcome)
        assertEquals(0, bridge.chargeCalls)
    }

    @Test
    fun differentTerminalCannotTakeOverOperation() {
        val bridge = FakeTerminalPaymentBridge()
        val store = InMemoryOperationStore()
        store.put(LocalOperation("pagbank", "operation-123", "POS-01"))
        val coordinator = TerminalCoordinator(bridge, store)

        assertFailsWith<IllegalArgumentException> { coordinator.handle(command(terminal = "POS-02")) }
        assertEquals(0, bridge.chargeCalls)
    }
}
