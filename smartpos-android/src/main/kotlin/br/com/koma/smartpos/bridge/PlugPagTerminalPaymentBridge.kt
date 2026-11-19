package br.com.koma.smartpos.bridge

data class PlugPagRawResult(
    val result: Int,
    val errorCode: String? = null,
    val message: String? = null,
    val transactionCode: String? = null,
    val transactionId: String? = null,
    val hostNsu: String? = null,
    val nsu: String? = null,
    val userReference: String? = null,
    val amountMinor: Long? = null,
)

interface PlugPagClient {
    fun isServiceAvailable(): Boolean
    fun isAuthenticated(): Boolean
    fun isServiceBusy(): Boolean
    fun activatePinpad(activationCode: String): PlugPagRawResult
    fun doPayment(
        type: Int,
        amountMinor: Int,
        userReference: String,
        printReceipt: Boolean = true,
    ): PlugPagRawResult

    fun getLastApprovedTransaction(): PlugPagRawResult
    fun voidPayment(
        transactionCode: String,
        transactionId: String,
        voidType: Int = PlugPagConstants.VOID_PAYMENT,
        printReceipt: Boolean = true,
    ): PlugPagRawResult

    fun abort(): Int
}

object PlugPagConstants {
    const val RET_OK = 0
    const val TYPE_CREDITO = 1
    const val TYPE_DEBITO = 2
    const val TYPE_VOUCHER = 3
    const val TYPE_QRCODE = 4
    const val TYPE_PIX = 5
    const val INSTALLMENT_TYPE_A_VISTA = 1
    const val A_VISTA_INSTALLMENT_QUANTITY = 1
    const val VOID_PAYMENT = 1
    const val VOID_QRCODE = 2

    const val OPERATION_ABORTED = -1001
    const val DOING_TRANSACTION = -1012
    const val PINPAD_NOT_INITIALIZED = -1015
    const val AUTHENTICATION_FAILED = -1020
    const val TRANSACTION_DENIED = -1023
    const val TIMEOUT_REACHED = -1024
    const val COMMUNICATION_ERROR = -1026
    const val INVALID_AMOUNT = -1033
    const val INVALID_CARD = -1036
    const val INVALID_CVV = -1037
    const val INVALID_EXPIRATION_DATE = -1038
    const val INVALID_PAN = -1040
    const val QR_CODE_EXPIRED = -1048
    const val MIN_AMOUNT_CENTS = 100L
}

class PlugPagTerminalPaymentBridge(
    private val client: PlugPagClient,
    private val printReceipt: Boolean = true,
) : TerminalPaymentBridge {

    override fun charge(command: TerminalCommand): TerminalPaymentResult {
        if (!client.isServiceAvailable()) {
            return TerminalPaymentResult(
                outcome = PaymentOutcome.ERROR,
                message = "Serviço PlugPag do PagBank não encontrado neste dispositivo.",
            )
        }
        if (!client.isAuthenticated()) {
            return TerminalPaymentResult(
                outcome = PaymentOutcome.ERROR,
                message = "Terminal PagBank ainda não ativado neste aparelho.",
            )
        }
        if (client.isServiceBusy()) {
            return TerminalPaymentResult(PaymentOutcome.PENDING, message = "O terminal PagBank está ocupado.")
        }
        if (command.amountMinor < PlugPagConstants.MIN_AMOUNT_CENTS) {
            return TerminalPaymentResult(
                outcome = PaymentOutcome.DECLINED,
                message = "O valor mínimo para cobrança no terminal PagBank é R$ 1,00.",
            )
        }
        if (command.amountMinor > Int.MAX_VALUE) {
            return TerminalPaymentResult(
                outcome = PaymentOutcome.DECLINED,
                message = "Valor excede o limite suportado pelo terminal.",
            )
        }

        val paymentType = mapPaymentType(command.method) ?: return TerminalPaymentResult(
            outcome = PaymentOutcome.ERROR,
            message = "Método ${command.method} não suportado pelo terminal PagBank.",
        )

        val userRef = StableOperationKey.userReference10(command.operationKey)
        val raw = client.doPayment(
            type = paymentType,
            amountMinor = command.amountMinor.toInt(),
            userReference = userRef,
            printReceipt = printReceipt,
        )
        if (raw.result == PlugPagConstants.RET_OK &&
            ((!raw.userReference.isNullOrBlank() && raw.userReference != userRef) ||
             (raw.amountMinor != null && raw.amountMinor != command.amountMinor))) {
            return TerminalPaymentResult(PaymentOutcome.ERROR,
                message = "Resultado divergente da cobrança. Conciliação necessária; não cobrar novamente.")
        }
        return mapRawResult(raw, fallbackRef = userRef)
    }

    override fun reconcile(command: TerminalCommand): TerminalPaymentResult {
        if (!client.isServiceAvailable()) {
            return TerminalPaymentResult(
                outcome = PaymentOutcome.ERROR,
                message = "Serviço PlugPag indisponível para reconciliação.",
            )
        }
        if (client.isServiceBusy()) {
            return TerminalPaymentResult(
                outcome = PaymentOutcome.PENDING,
                message = "O terminal PagBank ainda está processando uma operação.",
            )
        }

        val expectedRef = StableOperationKey.userReference10(command.operationKey)
        val last = client.getLastApprovedTransaction()
        if (last.result == PlugPagConstants.RET_OK && last.userReference == expectedRef) {
            if (last.amountMinor != command.amountMinor) {
                return TerminalPaymentResult(
                    outcome = PaymentOutcome.ERROR,
                    message = "Divergência de valor ao reconciliar última transação aprovada ($expectedRef).",
                )
            }
            val ref = listOfNotNull(last.transactionCode, last.transactionId).firstOrNull { it.isNotBlank() }
                ?: return TerminalPaymentResult(PaymentOutcome.ERROR,
                    message = "Última transação sem identificador da adquirente; conciliação necessária.")
            return TerminalPaymentResult(
                outcome = PaymentOutcome.APPROVED,
                reference = ref,
                message = last.message ?: "Transação aprovada recuperada do terminal.",
            )
        }

        return TerminalPaymentResult(
            outcome = PaymentOutcome.ERROR,
            message = "Aprovação não localizada no terminal em getLastApprovedTransaction() para $expectedRef.",
        )
    }

    private fun mapPaymentType(method: String): Int? = when (method.trim().lowercase()) {
        "credito" -> PlugPagConstants.TYPE_CREDITO
        "debito" -> PlugPagConstants.TYPE_DEBITO
        "voucher" -> PlugPagConstants.TYPE_VOUCHER
        "pix" -> PlugPagConstants.TYPE_PIX
        else -> null
    }

    private fun mapRawResult(raw: PlugPagRawResult, fallbackRef: String): TerminalPaymentResult {
        val ref = extractReference(raw, fallback = null)
        if (raw.result == PlugPagConstants.RET_OK &&
            (raw.errorCode.isNullOrBlank() || raw.errorCode == "0000") &&
            (!raw.transactionCode.isNullOrBlank() || !raw.transactionId.isNullOrBlank())) {
            return TerminalPaymentResult(
                outcome = PaymentOutcome.APPROVED,
                reference = ref ?: fallbackRef,
                message = raw.message ?: "Pagamento aprovado no terminal PagBank.",
            )
        }

        val codeStr = raw.errorCode?.trim().orEmpty()
        val msg = raw.message?.takeIf { it.isNotBlank() }

        return when (raw.result) {
            PlugPagConstants.OPERATION_ABORTED,
            PlugPagConstants.TRANSACTION_DENIED,
            PlugPagConstants.QR_CODE_EXPIRED,
            PlugPagConstants.INVALID_CARD,
            PlugPagConstants.INVALID_CVV,
            PlugPagConstants.INVALID_EXPIRATION_DATE,
            PlugPagConstants.INVALID_PAN,
            PlugPagConstants.INVALID_AMOUNT -> TerminalPaymentResult(
                outcome = PaymentOutcome.DECLINED,
                reference = ref,
                message = msg ?: "Pagamento não autorizado ou cancelado no terminal (${raw.result}).",
            )
            PlugPagConstants.TIMEOUT_REACHED -> TerminalPaymentResult(
                outcome = PaymentOutcome.TIMEOUT,
                reference = ref,
                message = msg ?: "Tempo esgotado aguardando resposta do terminal.",
            )
            PlugPagConstants.DOING_TRANSACTION -> TerminalPaymentResult(
                outcome = PaymentOutcome.PENDING,
                reference = ref,
                message = msg ?: "Terminal PagBank ocupado com operação em andamento.",
            )
            else -> TerminalPaymentResult(
                outcome = PaymentOutcome.ERROR,
                reference = ref,
                message = msg ?: buildString {
                    append("Falha de comunicação ou estado incerto no terminal (${raw.result})")
                    if (codeStr.isNotEmpty()) append(" [$codeStr]")
                    append('.')
                },
            )
        }
    }

    private fun extractReference(raw: PlugPagRawResult, fallback: String?): String? =
        listOfNotNull(raw.transactionCode, raw.transactionId, raw.hostNsu, raw.nsu)
            .firstOrNull { it.isNotBlank() }
            ?: fallback
}
