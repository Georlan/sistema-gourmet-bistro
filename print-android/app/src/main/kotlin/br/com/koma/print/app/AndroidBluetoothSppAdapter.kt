package br.com.koma.print.app

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import br.com.koma.print.core.BluetoothPrinterDevice
import br.com.koma.print.core.BluetoothReconnectPolicy
import br.com.koma.print.core.BluetoothSppTransport
import br.com.koma.print.core.OemCompatibilityPolicy
import br.com.koma.print.core.PrinterPaperProfile
import br.com.koma.print.core.SppSocketStrategy
import br.com.koma.print.core.SppTransmissionResult

/**
 * Implementação Android real de `BluetoothSppTransport` para impressoras térmicas
 * 58 mm Bluetooth Classic SPP (como a Kapbom KA-1445).
 *
 * Trata diferenças entre marcas de celulares Android (Samsung, Xiaomi, Motorola, Realme):
 * - Cancela discovery ativo antes do `socket.connect()`.
 * - Tenta `createRfcommSocketToServiceRecord(SPP_UUID)` seguro, depois inseguro
 *   (`createInsecureRfcommSocketToServiceRecord`), e por último canal RFCOMM 1 direto
 *   via reflexão (necessário em controladoras térmicas chinesas KA-1445 / MPT-II em alguns chipsets MediaTek/Qualcomm).
 * - Envia os bytes fatiados em blocos de 256 bytes com `flush()` para evitar estouro do buffer serial de 58 mm.
 */
class AndroidBluetoothSppAdapter(
    private val context: Context,
    private val reconnectPolicy: BluetoothReconnectPolicy = BluetoothReconnectPolicy(),
) : BluetoothSppTransport {

    private fun bluetoothAdapter(): BluetoothAdapter? {
        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        return manager?.adapter
    }

    fun hasBluetoothPermission(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return context.checkSelfPermission(OemCompatibilityPolicy.PERMISSION_BLUETOOTH_CONNECT) ==
                PackageManager.PERMISSION_GRANTED
        }
        return true
    }

    @SuppressLint("MissingPermission")
    override fun listPairedSppPrinters(): List<BluetoothPrinterDevice> {
        val adapter = bluetoothAdapter() ?: return emptyList()
        val btEnabled = runCatching { adapter.isEnabled }.getOrDefault(false)
        val permGranted = hasBluetoothPermission()
        if (!permGranted) return emptyList()

        val bonded = runCatching { adapter.bondedDevices.orEmpty() }.getOrDefault(emptySet())
        val mapped = bonded
            .filter { isLikelyThermalPrinter(it) }
            .map { device ->
                val name = runCatching { device.name }.getOrNull()?.takeIf { it.isNotBlank() }
                    ?: "Bluetooth ${device.address}"
                val profile = PrinterPaperProfile.infer(name)
                BluetoothPrinterDevice(
                    name = name,
                    address = device.address,
                    paired = true,
                    connected = btEnabled,
                    sppSupported = true,
                    configured = true,
                    isDefault = false,
                    bluetoothEnabled = btEnabled,
                    permissionGranted = true,
                    profile = profile,
                )
            }
            .sortedWith(
                compareByDescending<BluetoothPrinterDevice> { it.profile.paperWidthMm <= 58 }
                    .thenBy { it.name.lowercase() },
            )

        if (mapped.isNotEmpty()) {
            return mapped.mapIndexed { idx, p -> p.copy(isDefault = idx == 0) }
        }

        // Caso o usuário tenha pareado uma impressora que não anuncia classe IMAGING, lista todos os pareados
        return bonded.mapIndexed { idx, device ->
            val name = runCatching { device.name }.getOrNull()?.takeIf { it.isNotBlank() }
                ?: "Bluetooth ${device.address}"
            BluetoothPrinterDevice(
                name = name,
                address = device.address,
                paired = true,
                connected = btEnabled,
                sppSupported = true,
                configured = true,
                isDefault = idx == 0,
                bluetoothEnabled = btEnabled,
                permissionGranted = true,
                profile = PrinterPaperProfile.infer(name),
            )
        }
    }

    @SuppressLint("MissingPermission")
    override fun sendRawPayload(
        device: BluetoothPrinterDevice,
        payload: ByteArray,
    ): SppTransmissionResult {
        if (!hasBluetoothPermission()) {
            return SppTransmissionResult(
                success = false,
                attempts = 0,
                errorCode = "bluetooth_permission_missing",
                errorMessage = "Permissão BLUETOOTH_CONNECT não concedida no Android.",
            )
        }
        val adapter = bluetoothAdapter()
            ?: return SppTransmissionResult(
                success = false,
                attempts = 0,
                errorCode = "bluetooth_not_supported",
                errorMessage = "Adaptador Bluetooth indisponível neste aparelho.",
            )
        if (!adapter.isEnabled) {
            return SppTransmissionResult(
                success = false,
                attempts = 0,
                errorCode = "bluetooth_disabled",
                errorMessage = "Bluetooth desligado no celular.",
            )
        }

        val remoteDevice = runCatching {
            adapter.getRemoteDevice(device.normalizedAddress)
        }.getOrElse { err ->
            return SppTransmissionResult(
                success = false,
                attempts = 0,
                errorCode = "invalid_bluetooth_address",
                errorMessage = "Endereço MAC Bluetooth inválido (${device.normalizedAddress}): ${err.message}",
            )
        }

        var lastError: Throwable? = null
        val totalAttempts = reconnectPolicy.maxAttempts.coerceAtLeast(1)

        for (attemptIdx in 0 until totalAttempts) {
            val strategy = reconnectPolicy.strategyForAttempt(attemptIdx)
            var socket: BluetoothSocket? = null
            try {
                runCatching {
                    if (adapter.isDiscovering) {
                        adapter.cancelDiscovery()
                    }
                }
                socket = openSocket(remoteDevice, strategy)
                socket.connect()
                val output = socket.outputStream
                val written = reconnectPolicy.writeChunked(output, payload)
                // Pausa curta antes de fechar o socket RFCOMM para a controladora térmica KA-1445 esvaziar o buffer UART
                Thread.sleep(180L)
                return SppTransmissionResult(
                    success = true,
                    bytesWritten = written,
                    strategyUsed = strategy,
                    attempts = attemptIdx + 1,
                )
            } catch (err: Throwable) {
                lastError = err
                if (attemptIdx + 1 < totalAttempts) {
                    val delayMs = reconnectPolicy.backoffDelayMs(attemptIdx)
                    runCatching { Thread.sleep(delayMs) }
                }
            } finally {
                runCatching { socket?.close() }
            }
        }

        return SppTransmissionResult(
            success = false,
            attempts = totalAttempts,
            errorCode = "bluetooth_socket_failed",
            errorMessage = "Falha Bluetooth SPP após $totalAttempts tentativas para ${device.name} (${device.normalizedAddress}): ${lastError?.message ?: "sem resposta"}",
        )
    }

    @SuppressLint("MissingPermission")
    private fun openSocket(
        remoteDevice: BluetoothDevice,
        strategy: SppSocketStrategy,
    ): BluetoothSocket = when (strategy) {
        SppSocketStrategy.SECURE_SPP_UUID ->
            remoteDevice.createRfcommSocketToServiceRecord(BluetoothPrinterDevice.SPP_UUID)
        SppSocketStrategy.INSECURE_SPP_UUID ->
            remoteDevice.createInsecureRfcommSocketToServiceRecord(BluetoothPrinterDevice.SPP_UUID)
        SppSocketStrategy.RFCOMM_CHANNEL_1_FALLBACK -> {
            val method = remoteDevice.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
            method.invoke(remoteDevice, 1) as BluetoothSocket
        }
    }

    @SuppressLint("MissingPermission")
    private fun isLikelyThermalPrinter(device: BluetoothDevice): Boolean {
        val name = runCatching { device.name.orEmpty() }.getOrDefault("")
        val inferred = PrinterPaperProfile.infer(name)
        if (inferred.paperWidthMm <= 58) return true
        val lower = name.lowercase()
        if (
            "printer" in lower ||
            "pos" in lower ||
            "mtp" in lower ||
            "mpt" in lower ||
            "kapbom" in lower ||
            "ka-1445" in lower ||
            "ka1445" in lower ||
            "bluetooth" in lower ||
            "58" in lower
        ) {
            return true
        }
        val majorClass = runCatching { device.bluetoothClass?.majorDeviceClass }.getOrNull()
        return majorClass == BluetoothClass.Device.Major.IMAGING ||
            majorClass == BluetoothClass.Device.Major.UNCATEGORIZED
    }
}
