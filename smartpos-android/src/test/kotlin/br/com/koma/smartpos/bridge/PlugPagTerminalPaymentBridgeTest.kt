package br.com.koma.smartpos.bridge

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PlugPagTerminalPaymentBridgeTest {
    private class FakePlugPagClient(
        var serviceAvailable: Boolean = true,
        var authenticated: Boolean = true,
        var busy: Boolean = false,
        var paymentResult: PlugPagRawResult = PlugPagRawResult(
            result = PlugPagConstants.RET_OK,
            errorCode = "0000",
            transactionCode = "TXN-100",
            transactionId = "ID-100",
        ),
        var lastApprovedResult: PlugPagRawResult = PlugPagRawResult(
            result = PlugPagConstants.RET_OK,
            errorCode = "0000",
        ),
    ) : PlugPagClient {
        var doPaymentCalls = 0
        var lastPaymentType: Int? = null
        var lastAmountMinor: Int? = null
        var lastUserReference: String? = null
        var getLastApprovedCalls = 0

        override fun isServiceAvailable(): Boolean = serviceAvailable
        override fun isAuthenticated(): Boolean = authenticated
        override fun isServiceBusy(): Boolean = busy
        override fun activatePinpad(activationCode: String): PlugPagRawResult =
            PlugPagRawResult(result = PlugPagConstants.RET_OK)

        override fun doPayment(
            type: Int,
            amountMinor: Int,
            userReference: String,
            printReceipt: Boolean,
        ): PlugPagRawResult {
            doPaymentCalls += 1
            lastPaymentType = type
            lastAmountMinor = amountMinor
            lastUserReference = userReference
            return paymentResult
        }

        override fun getLastApprovedTransaction(): PlugPagRawResult {
            getLastApprovedCalls += 1
            return lastApprovedResult
        }

        override fun voidPayment(
            transactionCode: String,
            transactionId: String,
            voidType: Int,
            printReceipt: Boolean,
        ): PlugPagRawResult = PlugPagRawResult(result = PlugPagConstants.RET_OK)

        override fun abort(): Int = PlugPagConstants.RET_OK
    }

    private fun command(method: String = "credito", amountMinor: Long = 4250L) = TerminalCommand(
        intentId = "intent-pb-1",
        restauranteId = 8,
        provider = "pagbank",
        operationKey = "smartpos-abcdef0123456789",
        terminalId = "POS-PB-01",
        amountMinor = amountMinor,
        method = method,
        mode = CommandMode.CHARGE,
        shouldExecute = true,
    )

    @Test
    fun userReference10IsDeterministicAlphanumeric10Chars() {
        val ref1 = StableOperationKey.userReference10("smartpos-abcdef0123456789")
        val ref2 = StableOperationKey.userReference10("smartpos-abcdef0123456789")
        assertEquals(ref1, ref2)
        assertEquals(10, ref1.length)
        assertTrue(ref1.all { it in 'A'..'Z' || it in '0'..'9' })
    }

    @Test
    fun approvesPaymentAndMapsMethodsAndReference() {
        val client = FakePlugPagClient()
        val bridge = PlugPagTerminalPaymentBridge(client)

        val result = bridge.charge(command(method = "pix", amountMinor = 2990L))
        assertEquals(PaymentOutcome.APPROVED, result.outcome)
        assertEquals("TXN-100", result.reference)
        assertEquals(PlugPagConstants.TYPE_PIX, client.lastPaymentType)
        assertEquals(2990, client.lastAmountMinor)
        assertEquals(10, client.lastUserReference?.length)
    }

    @Test
    fun mapsDeclinedTimeoutAndErrorOutcomesProperly() {
        val client = FakePlugPagClient(
            paymentResult = PlugPagRawResult(
                result = PlugPagConstants.TRANSACTION_DENIED,
                message = "Cartão recusado",
            )
        )
        val bridge = PlugPagTerminalPaymentBridge(client)
        assertEquals(PaymentOutcome.DECLINED, bridge.charge(command()).outcome)

        client.paymentResult = PlugPagRawResult(result = PlugPagConstants.TIMEOUT_REACHED)
        assertEquals(PaymentOutcome.TIMEOUT, bridge.charge(command()).outcome)

        client.paymentResult = PlugPagRawResult(result = PlugPagConstants.COMMUNICATION_ERROR)
        assertEquals(PaymentOutcome.ERROR, bridge.charge(command()).outcome)
    }

    @Test
    fun reconcileRecoversApprovedTransactionFromTerminalWhenReferenceAndAmountMatch() {
        val cmd = command(amountMinor = 4250L)
        val expectedRef = StableOperationKey.userReference10(cmd.operationKey)
        val client = FakePlugPagClient(
            lastApprovedResult = PlugPagRawResult(
                result = PlugPagConstants.RET_OK,
                transactionCode = "TXN-RECOVERED",
                userReference = expectedRef,
                amountMinor = 4250L,
            )
        )
        val bridge = PlugPagTerminalPaymentBridge(client)

        val reconciled = bridge.reconcile(cmd.copy(mode = CommandMode.RECONCILE, shouldExecute = false))
        assertEquals(PaymentOutcome.APPROVED, reconciled.outcome)
        assertEquals("TXN-RECOVERED", reconciled.reference)
        assertEquals(0, client.doPaymentCalls)
        assertEquals(1, client.getLastApprovedCalls)
    }

    @Test
    fun reconcileRefusesMismatchedReferenceOrAmountAndNeverChargesAgain() {
        val cmd = command(amountMinor = 4250L)
        val client = FakePlugPagClient(
            lastApprovedResult = PlugPagRawResult(
                result = PlugPagConstants.RET_OK,
                transactionCode = "TXN-OTHER",
                userReference = "OTHERREF12",
                amountMinor = 4250L,
            )
        )
        val bridge = PlugPagTerminalPaymentBridge(client)

        val reconciled = bridge.reconcile(cmd.copy(mode = CommandMode.RECONCILE, shouldExecute = false))
        assertEquals(PaymentOutcome.ERROR, reconciled.outcome)
        assertEquals(0, client.doPaymentCalls)
    }
}
