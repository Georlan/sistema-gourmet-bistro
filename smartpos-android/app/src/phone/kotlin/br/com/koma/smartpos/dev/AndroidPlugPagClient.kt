package br.com.koma.smartpos.dev

import android.content.Context
import br.com.koma.smartpos.bridge.PlugPagClient
import br.com.koma.smartpos.bridge.PlugPagRawResult

/** A phone never pretends to contain a PagBank service or execute a physical payment. */
internal class AndroidPlugPagClient(@Suppress("UNUSED_PARAMETER") context: Context) : PlugPagClient {
    override fun isServiceAvailable() = false
    override fun isAuthenticated() = false
    override fun isServiceBusy() = false
    override fun activatePinpad(activationCode: String) = unavailable()
    override fun doPayment(type: Int, amountMinor: Int, userReference: String, printReceipt: Boolean) = unavailable()
    override fun getLastApprovedTransaction() = unavailable()
    override fun voidPayment(transactionCode: String, transactionId: String, voidType: Int, printReceipt: Boolean) = unavailable()
    override fun abort() = -1
    fun statusDescription() = "Cobrança PagBank exige o APK PagBank e um terminal autorizado."
    private fun unavailable() = PlugPagRawResult(-1, message = statusDescription())
}
