package br.com.koma.smartpos.bridge

import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class FileOperationStoreTest {
    @Test
    fun operationSurvivesStoreRecreation() {
        val dir = Files.createTempDirectory("koma-smartpos-store")
        try {
            val first = FileOperationStore(dir)
            first.put(
                LocalOperation(
                    intentId = "intent-persisted",
                    provider = "pagbank",
                    operationKey = "operation-persisted",
                    terminalId = "POS-01",
                    lastResult = TerminalPaymentResult(
                        outcome = PaymentOutcome.APPROVED,
                        reference = "pb-123",
                        message = "Aprovado",
                    ),
                )
            )

            val second = FileOperationStore(dir)
            val restored = assertNotNull(second.get("operation-persisted"))
            assertEquals("intent-persisted", restored.intentId)
            assertEquals("pagbank", restored.provider)
            assertEquals("POS-01", restored.terminalId)
            assertEquals(PaymentOutcome.APPROVED, restored.lastResult?.outcome)
            assertEquals("pb-123", restored.lastResult?.reference)
        } finally {
            dir.toFile().deleteRecursively()
        }
    }
}
