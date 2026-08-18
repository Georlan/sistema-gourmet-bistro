package br.com.koma.smartpos.bridge

import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class TerminalRuntimeTest {
    private class FakeBackendApi : TerminalBackendApi {
        var prepareCalls = 0
        var submitCalls = 0
        var failFirstSubmit = false
        var nextMode = CommandMode.CHARGE
        var nextShouldExecute = true
        val submitted = mutableListOf<TerminalPaymentResult>()

        override fun prepare(intentId: String, provider: String, operationKey: String, terminalId: String): TerminalCommand {
            prepareCalls += 1
            return TerminalCommand(
                intentId = intentId,
                restauranteId = 1,
                provider = provider,
                operationKey = operationKey,
                terminalId = terminalId,
                amountMinor = 4200,
                method = "credito",
                mode = nextMode,
                shouldExecute = nextShouldExecute,
            )
        }

        override fun submitResult(command: TerminalCommand, result: TerminalPaymentResult): TerminalResultAck {
            submitCalls += 1
            submitted += result
            if (failFirstSubmit && submitCalls == 1) error("rede indisponível")
            return TerminalResultAck(command.intentId, "aprovada", replayed = submitCalls > 1)
        }
    }

    @Test
    fun approvedLocalResultSurvivesBackendFailureAndIsResentAfterRestartWithoutSdkCall() {
        val dir = Files.createTempDirectory("koma-runtime-restart")
        try {
            val backend = FakeBackendApi().apply { failFirstSubmit = true }
            val firstBridge = FakeTerminalPaymentBridge()
            val firstRuntime = TerminalRuntime(
                backend,
                TerminalCoordinator(firstBridge, FileOperationStore(dir)),
                provider = "pagbank",
                terminalId = "POS-01",
            )

            assertFailsWith<IllegalStateException> {
                firstRuntime.runOnce("intent-restart", "operation-restart")
            }
            assertEquals(1, firstBridge.chargeCalls)

            backend.nextMode = CommandMode.RECONCILE
            backend.nextShouldExecute = false
            val secondBridge = FakeTerminalPaymentBridge(
                nextReconcileResult = TerminalPaymentResult(PaymentOutcome.ERROR, message = "não deveria chamar")
            )
            val secondRuntime = TerminalRuntime(
                backend,
                TerminalCoordinator(secondBridge, FileOperationStore(dir)),
                provider = "pagbank",
                terminalId = "POS-01",
            )

            val ack = secondRuntime.runOnce("intent-restart", "operation-restart")
            assertEquals("aprovada", ack.status)
            assertEquals(0, secondBridge.chargeCalls)
            assertEquals(0, secondBridge.reconcileCalls)
            assertEquals(PaymentOutcome.APPROVED, backend.submitted.last().outcome)
        } finally {
            dir.toFile().deleteRecursively()
        }
    }
}
