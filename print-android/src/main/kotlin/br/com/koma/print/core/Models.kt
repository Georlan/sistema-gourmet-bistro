package br.com.koma.print.core

import java.util.UUID

/**
 * Estágios explícitos de entrega no diário local do KÔMA Print Android.
 *
 * Separa claramente o recebimento local, o envio ao socket Bluetooth SPP,
 * o ACK persistido no backend e a verificação física opcional pelo operador.
 */
enum class PrintReceiptStage {
    RECEBIDO_LOCAL,
    ENVIADO_TRANSPORTE,
    CONFIRMADO_BACKEND,
    IMPRESSO_FISICAMENTE_VERIFICADO,
    ;

    fun hasReachedTransport(): Boolean =
        this == ENVIADO_TRANSPORTE ||
            this == CONFIRMADO_BACKEND ||
            this == IMPRESSO_FISICAMENTE_VERIFICADO

    fun isConfirmedOnBackend(): Boolean =
        this == CONFIRMADO_BACKEND ||
            this == IMPRESSO_FISICAMENTE_VERIFICADO
}

/**
 * Perfil físico de bobina térmica, espelhando `print-agent/printer_profiles.py`.
 */
data class PrinterPaperProfile(
    val key: String,
    val paperWidthMm: Int,
    val columns: Int,
    val dotsPerLine: Int,
    val compactLayout: Boolean,
    val supportsCut: Boolean,
    val feedLines: Int,
    val allowDoubleHeight: Boolean,
    val charsetPolicy: String,
    val semanticLayout: String,
) {
    companion object {
        val KAPBOM_KA1445_58MM = PrinterPaperProfile(
            key = "thermal-58mm",
            paperWidthMm = 58,
            columns = 32,
            dotsPerLine = 384,
            compactLayout = true,
            supportsCut = false,
            feedLines = 2,
            allowDoubleHeight = false,
            charsetPolicy = "ascii_safe",
            semanticLayout = "compact_58",
        )

        val STANDARD_80MM = PrinterPaperProfile(
            key = "thermal-80mm",
            paperWidthMm = 80,
            columns = 48,
            dotsPerLine = 576,
            compactLayout = false,
            supportsCut = true,
            feedLines = 3,
            allowDoubleHeight = true,
            charsetPolicy = "native_cp860",
            semanticLayout = "standard",
        )

        private val KA1445_REGEX = Regex(
            "(?:^|\\b)(?:KA[-\\s]?1445|KA7|KAPBOM|MTP[-\\s]?(?:II|2)|MPT[-\\s]?II|58\\s*MM)(?:\\b|$)",
            RegexOption.IGNORE_CASE,
        )

        fun infer(
            name: String,
            displayName: String = "",
            explicitWidthMm: Int? = null,
            explicitColumns: Int? = null,
        ): PrinterPaperProfile {
            if (explicitWidthMm != null && explicitWidthMm > 0) {
                val base = if (explicitWidthMm <= 60) KAPBOM_KA1445_58MM else STANDARD_80MM
                return base.copy(
                    paperWidthMm = explicitWidthMm,
                    columns = explicitColumns?.takeIf { it > 0 } ?: base.columns,
                )
            }
            val identity = "$name $displayName".trim()
            if (KA1445_REGEX.containsMatchIn(identity)) {
                return KAPBOM_KA1445_58MM
            }
            return STANDARD_80MM
        }
    }
}

/**
 * Estado físico e de configuração de uma impressora Bluetooth Classic SPP pareada.
 */
data class BluetoothPrinterDevice(
    val name: String,
    val address: String,
    val paired: Boolean,
    val connected: Boolean,
    val sppSupported: Boolean = true,
    val configured: Boolean = true,
    val isDefault: Boolean = true,
    val bluetoothEnabled: Boolean = true,
    val permissionGranted: Boolean = true,
    val profile: PrinterPaperProfile = PrinterPaperProfile.infer(name),
) {
    val normalizedAddress: String = normalizeMacAddress(address)
    val uri: String = "bluetooth://$normalizedAddress"

    /**
     * Espelha `_is_printer_dispatchable_entry` do backend:
     * Bluetooth SPP pareada e configurada é despachável sob demanda (on-demand RFCOMM)
     * desde que o adaptador Bluetooth esteja ligado e com permissão concedida.
     */
    val dispatchable: Boolean
        get() = configured && paired && sppSupported && bluetoothEnabled && permissionGranted

    /**
     * Espelha `_is_printer_ready_entry` do backend.
     */
    val ready: Boolean
        get() = dispatchable && connected

    companion object {
        val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

        fun normalizeMacAddress(raw: String): String {
            val cleaned = raw.trim()
                .removePrefix("bluetooth://")
                .replace("-", ":")
                .uppercase()
            val hexOnly = cleaned.filter { it in '0'..'9' || it in 'A'..'F' }
            if (hexOnly.length == 12) {
                return hexOnly.chunked(2).joinToString(":")
            }
            return cleaned
        }
    }
}

data class ClaimedPrintJob(
    val id: String,
    val restauranteId: Int,
    val documentType: String,
    val destination: String,
    val sourceType: String,
    val sourceId: String,
    val payloadText: String,
    val idempotencyKey: String,
    val attempts: Int = 0,
)

data class JournalEntry(
    val jobId: String,
    val idempotencyKey: String,
    val printerName: String,
    val stage: PrintReceiptStage,
    val updatedAtEpochMs: Long,
    val errorMessage: String? = null,
)

data class AgentCommand(
    val id: String,
    val action: String,
    val printerName: String? = null,
    val printerUri: String? = null,
)

data class AgentCommandResult(
    val success: Boolean,
    val code: String,
    val message: String,
    val printerName: String? = null,
)

data class HeartbeatResponse(
    val status: String,
    val agentId: String,
    val restauranteId: Int,
    val command: AgentCommand? = null,
)

data class RegisteredAgentCredentials(
    val agentId: String,
    val restauranteId: Int,
    val agentToken: String,
)
