package br.com.koma.smartpos.dev

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import br.com.koma.smartpos.bridge.PlugPagClient
import br.com.koma.smartpos.bridge.PlugPagConstants
import br.com.koma.smartpos.bridge.PlugPagRawResult
import java.math.BigDecimal

/**
 * Adapter for PagBank PlugPagServiceWrapper when installed/bundled on a physical SmartPOS terminal.
 *
 * Uses reflection against `br.com.uol.pagseguro.plugpagservice.wrapper.PlugPag` and checks for
 * the `br.com.uol.pagseguro.plugpagservice` system service package so standard Android phones
 * without PlugPagServiceWrapper AAR or PagBank OS degrade cleanly without runtime linkage errors.
 */
internal class AndroidPlugPagClient(context: Context) : PlugPagClient {
    private val appContext = context.applicationContext

    @Volatile
    private var cachedPlugPag: Any? = null

    private fun wrapperClass(): Class<*>? = runCatching {
        Class.forName("br.com.uol.pagseguro.plugpagservice.wrapper.PlugPag")
    }.getOrNull()

    private fun plugPagInstance(): Any? {
        cachedPlugPag?.let { return it }
        val clazz = wrapperClass() ?: return null
        return runCatching {
            clazz.getConstructor(Context::class.java).newInstance(appContext)
        }.getOrNull()?.also { cachedPlugPag = it }
    }

    override fun isServiceAvailable(): Boolean {
        val packagePresent = runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                appContext.packageManager.getPackageInfo(
                    PLUGPAG_SERVICE_PACKAGE,
                    PackageManager.PackageInfoFlags.of(0),
                )
            } else {
                @Suppress("DEPRECATION")
                appContext.packageManager.getPackageInfo(PLUGPAG_SERVICE_PACKAGE, 0)
            }
            true
        }.getOrDefault(false)
        return packagePresent && plugPagInstance() != null
    }

    override fun isAuthenticated(): Boolean {
        val instance = plugPagInstance() ?: return false
        return runCatching {
            instance.javaClass.getMethod("isAuthenticated").invoke(instance) as? Boolean ?: false
        }.getOrDefault(false)
    }

    override fun isServiceBusy(): Boolean {
        val instance = plugPagInstance() ?: return false
        return runCatching {
            instance.javaClass.getMethod("isServiceBusy").invoke(instance) as? Boolean ?: false
        }.getOrDefault(false)
    }

    override fun activatePinpad(activationCode: String): PlugPagRawResult {
        val instance = plugPagInstance() ?: return unavailableResult()
        return runCatching {
            val activationClass = Class.forName(
                "br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagActivationData"
            )
            val activationData = activationClass.getConstructor(String::class.java)
                .newInstance(activationCode.trim())
            val resultObj = instance.javaClass
                .getMethod("initializeAndActivatePinpad", activationClass)
                .invoke(instance, activationData)
            val resultCode = readIntField(resultObj, "getResult") ?: -1
            val errorCode = readStringField(resultObj, "getErrorCode")
            val message = readStringField(resultObj, "getErrorMessage")
            PlugPagRawResult(result = resultCode, errorCode = errorCode, message = message)
        }.getOrElse { exc ->
            PlugPagRawResult(result = -1, message = exc.message ?: "Falha ao ativar terminal PagBank.")
        }
    }

    override fun doPayment(
        type: Int,
        amountMinor: Int,
        userReference: String,
        printReceipt: Boolean,
    ): PlugPagRawResult {
        val instance = plugPagInstance() ?: return unavailableResult()
        return runCatching {
            val paymentDataClass = Class.forName(
                "br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagPaymentData"
            )
            val paymentData = paymentDataClass.getConstructor(
                Int::class.javaPrimitiveType,
                Int::class.javaPrimitiveType,
                Int::class.javaPrimitiveType,
                Int::class.javaPrimitiveType,
                String::class.java,
                Boolean::class.javaPrimitiveType,
            ).newInstance(
                type,
                amountMinor,
                PlugPagConstants.INSTALLMENT_TYPE_A_VISTA,
                PlugPagConstants.A_VISTA_INSTALLMENT_QUANTITY,
                userReference,
                printReceipt,
            )
            val txResult = instance.javaClass
                .getMethod("doPayment", paymentDataClass)
                .invoke(instance, paymentData)
            toRawResult(txResult)
        }.getOrElse { exc ->
            PlugPagRawResult(result = -1, message = exc.message ?: "Erro ao executar pagamento no PlugPag.")
        }
    }

    override fun getLastApprovedTransaction(): PlugPagRawResult {
        val instance = plugPagInstance() ?: return unavailableResult()
        return runCatching {
            val txResult = instance.javaClass
                .getMethod("getLastApprovedTransaction")
                .invoke(instance)
            toRawResult(txResult)
        }.getOrElse { exc ->
            PlugPagRawResult(result = -1, message = exc.message ?: "Erro ao consultar última transação PlugPag.")
        }
    }

    override fun voidPayment(
        transactionCode: String,
        transactionId: String,
        voidType: Int,
        printReceipt: Boolean,
    ): PlugPagRawResult {
        val instance = plugPagInstance() ?: return unavailableResult()
        return runCatching {
            val voidDataClass = Class.forName(
                "br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagVoidData"
            )
            val voidData = voidDataClass.getConstructor(
                String::class.java,
                String::class.java,
                Boolean::class.javaPrimitiveType,
                Int::class.javaPrimitiveType,
            ).newInstance(transactionCode, transactionId, printReceipt, voidType)
            val txResult = instance.javaClass
                .getMethod("voidPayment", voidDataClass)
                .invoke(instance, voidData)
            toRawResult(txResult)
        }.getOrElse { exc ->
            PlugPagRawResult(result = -1, message = exc.message ?: "Erro ao estornar transação PlugPag.")
        }
    }

    override fun abort(): Int {
        val instance = plugPagInstance() ?: return -1
        return runCatching {
            val abortObj = instance.javaClass.getMethod("abort").invoke(instance)
            readIntField(abortObj, "getResult") ?: -1
        }.getOrDefault(-1)
    }

    fun statusDescription(): String = when {
        wrapperClass() == null -> "SDK PlugPagServiceWrapper ausente neste build (uso em celular padrão / simulador)."
        !isServiceAvailable() -> "Serviço PlugPag do PagBank não instalado neste aparelho."
        !isAuthenticated() -> "Terminal PagBank detectado, aguardando ativação."
        else -> "Terminal PagBank autenticado e pronto."
    }

    private fun unavailableResult() = PlugPagRawResult(
        result = -1,
        message = "Terminal físico PagBank indisponível neste dispositivo.",
    )

    private fun toRawResult(txResult: Any?): PlugPagRawResult {
        if (txResult == null) return unavailableResult()
        val amountText = readStringField(txResult, "getAmount")
        val amountMinor = amountText?.trim()?.takeIf { it.isNotEmpty() }?.let { raw ->
            runCatching {
                if (raw.contains('.')) {
                    BigDecimal(raw).movePointRight(2).longValueExact()
                } else {
                    raw.toLong()
                }
            }.getOrNull()
        }
        return PlugPagRawResult(
            result = readIntField(txResult, "getResult") ?: -1,
            errorCode = readStringField(txResult, "getErrorCode"),
            message = readStringField(txResult, "getMessage"),
            transactionCode = readStringField(txResult, "getTransactionCode"),
            transactionId = readStringField(txResult, "getTransactionId"),
            hostNsu = readStringField(txResult, "getHostNsu"),
            nsu = readStringField(txResult, "getNsu"),
            userReference = readStringField(txResult, "getUserReference"),
            amountMinor = amountMinor,
        )
    }

    private fun readStringField(target: Any?, getter: String): String? =
        if (target == null) null else runCatching {
            target.javaClass.getMethod(getter).invoke(target) as? String
        }.getOrNull()

    private fun readIntField(target: Any?, getter: String): Int? =
        if (target == null) null else runCatching {
            target.javaClass.getMethod(getter).invoke(target) as? Int
        }.getOrNull()

    private companion object {
        const val PLUGPAG_SERVICE_PACKAGE = "br.com.uol.pagseguro.plugpagservice"
    }
}
