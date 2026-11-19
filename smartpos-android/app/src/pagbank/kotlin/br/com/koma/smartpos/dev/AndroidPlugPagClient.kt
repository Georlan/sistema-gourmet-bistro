package br.com.koma.smartpos.dev

import android.content.Context
import br.com.koma.smartpos.bridge.PlugPagClient
import br.com.koma.smartpos.bridge.PlugPagRawResult
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPag
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagActivationData
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagPaymentData
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagTransactionResult
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagVoidData

/** Typed adapter; compilation of this variant requires the real official SDK. */
internal class AndroidPlugPagClient(context: Context) : PlugPagClient {
    private val appContext = context.applicationContext
    private val sdk by lazy { PlugPag(appContext) }

    override fun isServiceAvailable(): Boolean = runCatching {
        @Suppress("DEPRECATION")
        appContext.packageManager.getPackageInfo("br.com.uol.pagseguro.plugpagservice", 0)
        true
    }.getOrDefault(false)

    override fun isAuthenticated() = isServiceAvailable() && runCatching { sdk.isAuthenticated() }.getOrDefault(false)
    // Failure to inspect a busy service must not authorize another operation.
    override fun isServiceBusy() = runCatching { sdk.isServiceBusy() }.getOrDefault(true)

    override fun activatePinpad(activationCode: String): PlugPagRawResult {
        val result = sdk.initializeAndActivatePinpad(PlugPagActivationData(activationCode.trim()))
        return PlugPagRawResult(result.result, result.errorCode, result.errorMessage)
    }

    override fun doPayment(type: Int, amountMinor: Int, userReference: String, printReceipt: Boolean): PlugPagRawResult =
        raw(sdk.doPayment(PlugPagPaymentData(type, amountMinor, PlugPag.INSTALLMENT_TYPE_A_VISTA,
            1, userReference, printReceipt)))

    override fun getLastApprovedTransaction() = raw(sdk.getLastApprovedTransaction())

    override fun voidPayment(transactionCode: String, transactionId: String, voidType: Int, printReceipt: Boolean) =
        raw(sdk.voidPayment(PlugPagVoidData(transactionCode = transactionCode,
            transactionId = transactionId, voidType = voidType, printReceipt = printReceipt)))

    override fun abort() = sdk.abort().result

    fun statusDescription(): String = when {
        !isServiceAvailable() -> "Serviço PagBank ausente. Use um terminal de desenvolvimento autorizado."
        !isAuthenticated() -> "Terminal PagBank aguardando ativação."
        else -> "SDK PagBank disponível; validação física e recebedor devem ser conferidos."
    }

    private fun raw(result: PlugPagTransactionResult) = PlugPagRawResult(
        result = result.result ?: -1,
        errorCode = result.errorCode,
        message = result.message,
        transactionCode = result.transactionCode,
        transactionId = result.transactionId,
        hostNsu = result.hostNsu,
        nsu = result.nsu,
        userReference = result.userReference,
        // The official SmartCoffee example interprets this string as integer cents.
        amountMinor = result.amount?.trim()?.toLongOrNull(),
    )
}
