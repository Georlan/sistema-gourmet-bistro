package br.com.koma.print.core

import java.io.OutputStream
import kotlin.math.min

enum class SppSocketStrategy {
    SECURE_SPP_UUID,
    INSECURE_SPP_UUID,
    RFCOMM_CHANNEL_1_FALLBACK,
}

data class SppTransmissionResult(
    val success: Boolean,
    val bytesWritten: Int = 0,
    val strategyUsed: SppSocketStrategy? = null,
    val attempts: Int = 1,
    val errorCode: String? = null,
    val errorMessage: String? = null,
)

interface BluetoothSppTransport {
    fun listPairedSppPrinters(): List<BluetoothPrinterDevice>
    fun sendRawPayload(device: BluetoothPrinterDevice, payload: ByteArray): SppTransmissionResult
}

/**
 * Política de reconexão e escrita fragmentada (chunked RFCOMM) para impressoras
 * térmicas 58 mm Bluetooth Classic SPP (Kapbom KA-1445).
 *
 * Controladoras térmicas 58 mm possuem buffer serial pequeno (tipicamente 1 KB a 4 KB);
 * fatiar em blocos de 256 bytes com flush explícito evita truncamento de comandas longas.
 */
class BluetoothReconnectPolicy(
    val maxAttempts: Int = 3,
    val baseBackoffMs: Long = 600L,
    val maxBackoffMs: Long = 8_000L,
    val chunkSizeBytes: Int = 256,
    val interChunkPauseMs: Long = 12L,
) {
    val strategyOrder: List<SppSocketStrategy> = listOf(
        SppSocketStrategy.SECURE_SPP_UUID,
        SppSocketStrategy.INSECURE_SPP_UUID,
        SppSocketStrategy.RFCOMM_CHANNEL_1_FALLBACK,
    )

    fun backoffDelayMs(attemptIndexZeroBased: Int): Long {
        if (attemptIndexZeroBased <= 0) return baseBackoffMs
        val shift =attemptIndexZeroBased.coerceAtMost(6)
        val raw = baseBackoffMs * (1L shl shift)
        return min(raw, maxBackoffMs)
    }

    fun strategyForAttempt(attemptIndexZeroBased: Int): SppSocketStrategy =
        strategyOrder[attemptIndexZeroBased.coerceAtLeast(0) % strategyOrder.size]

    fun writeChunked(
        output: OutputStream,
        payload: ByteArray,
        sleeper: (Long) -> Unit = { ms -> if (ms > 0) Thread.sleep(ms) },
    ): Int {
        var offset = 0
        val step = chunkSizeBytes.coerceAtLeast(32)
        while (offset < payload.size) {
            val length = min(step, payload.size - offset)
            output.write(payload, offset, length)
            output.flush()
            offset += length
            if (offset < payload.size && interChunkPauseMs > 0) {
                sleeper(interChunkPauseMs)
            }
        }
        return offset
    }
}

/**
 * Matriz de compatibilidade multi-marca para Android 8.0+ (API 26+).
 *
 * Trata diferenças de permissões Bluetooth (Android 8–11 vs Android 12+),
 * notificações (Android 13+) e restrições agressivas de segundo plano com tela bloqueada
 * (Samsung One UI, Xiaomi MIUI/HyperOS, Motorola, Realme/OPPO).
 */
object OemCompatibilityPolicy {
    const val PERMISSION_BLUETOOTH = "android.permission.BLUETOOTH"
    const val PERMISSION_BLUETOOTH_ADMIN = "android.permission.BLUETOOTH_ADMIN"
    const val PERMISSION_BLUETOOTH_CONNECT = "android.permission.BLUETOOTH_CONNECT"
    const val PERMISSION_BLUETOOTH_SCAN = "android.permission.BLUETOOTH_SCAN"
    const val PERMISSION_POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS"

    fun requiredRuntimePermissions(sdkInt: Int): List<String> {
        require(sdkInt >= 26) { "KÔMA Print Android exige Android 8.0+ (API 26+)." }
        val permissions = mutableListOf<String>()
        if (sdkInt >= 31) {
            permissions.add(PERMISSION_BLUETOOTH_CONNECT)
            permissions.add(PERMISSION_BLUETOOTH_SCAN)
        } else {
            permissions.add(PERMISSION_BLUETOOTH)
            permissions.add(PERMISSION_BLUETOOTH_ADMIN)
        }
        if (sdkInt >= 33) {
            permissions.add(PERMISSION_POST_NOTIFICATIONS)
        }
        return permissions
    }

    fun lockScreenGuidanceForManufacturer(manufacturerRaw: String): String {
        val brand = manufacturerRaw.trim().lowercase()
        return when {
            "xiaomi" in brand || "redmi" in brand || "poco" in brand ->
                "Xiaomi/MIUI/HyperOS: ative 'Início automático em segundo plano' e defina Economia de bateria como 'Sem restrições' para imprimir com a tela bloqueada."
            "samsung" in brand ->
                "Samsung One UI: em Bateria -> Limites de uso em segundo plano, adicione o KÔMA Print em 'Apps nunca suspensos' e marque Bateria como 'Não restrito'."
            "motorola" in brand || "moto" in brand ->
                "Motorola: desative a Otimização de bateria para o KÔMA Print e permita uso em segundo plano sem restrição."
            "realme" in brand || "oppo" in brand || "oneplus" in brand ->
                "Realme/OPPO/OnePlus: habilite 'Permitir atividade em segundo plano' e 'Início automático' nas configurações de bateria do aplicativo."
            else ->
                "Android (${manufacturerRaw.ifBlank { "Padrão" }}): desative a otimização de bateria ('Sem restrições') para manter o Bluetooth SPP ativo com o celular bloqueado."
        }
    }
}
