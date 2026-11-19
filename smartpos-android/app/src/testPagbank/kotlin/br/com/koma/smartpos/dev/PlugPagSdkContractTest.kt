package br.com.koma.smartpos.dev

import br.com.koma.smartpos.bridge.*
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPag
import org.junit.Assert.assertEquals
import org.junit.Test

class PlugPagSdkContractTest {
    private class Client(var sdkResult: Int) : PlugPagClient {
        override fun isServiceAvailable() = true
        override fun isAuthenticated() = true
        override fun isServiceBusy() = false
        override fun activatePinpad(activationCode: String) = PlugPagRawResult(0)
        override fun doPayment(type: Int, amountMinor: Int, userReference: String, printReceipt: Boolean) = PlugPagRawResult(sdkResult)
        override fun getLastApprovedTransaction() = PlugPagRawResult(-1)
        override fun voidPayment(transactionCode: String, transactionId: String, voidType: Int, printReceipt: Boolean) = PlugPagRawResult(-1)
        override fun abort() = -1
    }

    @Test
    fun interpretsRealSdkCodesWithoutTreatingPrinterFailureAsDecline() {
        val client = Client(PlugPag.TRANSACTION_DENIED)
        val bridge = PlugPagTerminalPaymentBridge(client)
        val command = TerminalCommand("pi", 8, "pagbank", "operation-123", "POS-1", 4250L, "credito", CommandMode.CHARGE, true)
        assertEquals(PaymentOutcome.DECLINED, bridge.charge(command).outcome)
        client.sdkResult = PlugPag.OPERATION_ABORTED
        assertEquals(PaymentOutcome.DECLINED, bridge.charge(command).outcome)
        client.sdkResult = PlugPag.TIMEOUT_REACHED
        assertEquals(PaymentOutcome.TIMEOUT, bridge.charge(command).outcome)
        client.sdkResult = PlugPag.DOING_TRANSACTION
        assertEquals(PaymentOutcome.PENDING, bridge.charge(command).outcome)
        client.sdkResult = PlugPag.NO_PRINTER_DEVICE
        assertEquals(PaymentOutcome.ERROR, bridge.charge(command).outcome)
    }
}
