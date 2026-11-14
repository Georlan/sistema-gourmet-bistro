package br.com.koma.print.core

data class PrintCycleOutcome(
    val claimedCount: Int = 0,
    val printedAndSentCount: Int = 0,
    val deduplicatedSkipCount: Int = 0,
    val backendConfirmedCount: Int = 0,
    val releasedUntouchedCount: Int = 0,
    val failedJobId: String? = null,
    val failureReason: String? = null,
    val executedCommandId: String? = null,
    val printerDispatchable: Boolean = false,
)

/**
 * Orquestrador de ciclo do KÔMA Print Android.
 *
 * Responsabilidades:
 * 1. Sincronizar diagnósticos Bluetooth SPP via `/api/print-agents/heartbeat`.
 * 2. Executar comandos remotos (`test_bluetooth`) solicitados pelo painel KÔMA.
 * 3. Reconciliar ACKs pendentes (`ENVIADO_TRANSPORTE -> CONFIRMADO_BACKEND`) sem reimprimir.
 * 4. Reivindicar lotes (`claim-batch`), projetar para 58 mm (`EscPos58Renderer`), enviar via
 *    RFCOMM (`BluetoothSppTransport`), gravar no `PrintJournal` antes do ACK HTTP e liberar
 *    imediatamente jobs não tocados (`release-batch`) se a impressora desconectar no meio do lote.
 */
class AndroidPrintWorker(
    private val apiClient: KomaPrintAgentClient,
    private val bluetoothTransport: BluetoothSppTransport,
    private val journal: PrintJournal,
    private val restaurantDisplayName: String = "RESTAURANTE KÔMA",
) {
    fun resolvePrinters(preferredAddress: String? = null): List<BluetoothPrinterDevice> {
        val rawPrinters = bluetoothTransport.listPairedSppPrinters()
        if (rawPrinters.isEmpty()) return emptyList()

        val normalizedPreferred = preferredAddress
            ?.takeIf { it.isNotBlank() }
            ?.let { BluetoothPrinterDevice.normalizeMacAddress(it) }

        val defaultCandidate = if (normalizedPreferred != null) {
            // Se a escolhida sumiu, nunca desvie pedidos para outra.
            rawPrinters.firstOrNull { it.normalizedAddress == normalizedPreferred }
        } else {
            // Sem escolha prévia, seleção automática só quando for inequívoca.
            rawPrinters.singleOrNull()
        }

        return rawPrinters.map { printer ->
            printer.copy(
                isDefault = defaultCandidate != null && printer.normalizedAddress == defaultCandidate.normalizedAddress,
                configured = true,
            )
        }
    }

    fun selectTargetPrinter(
        printers: List<BluetoothPrinterDevice>,
        preferredAddress: String? = null,
    ): BluetoothPrinterDevice? {
        if (printers.isEmpty()) return null
        val normalizedPreferred = preferredAddress
            ?.takeIf { it.isNotBlank() }
            ?.let { BluetoothPrinterDevice.normalizeMacAddress(it) }

        if (normalizedPreferred != null) {
            return printers.firstOrNull { it.normalizedAddress == normalizedPreferred }
        }
        return printers.firstOrNull { it.isDefault }
    }

    fun reconcilePendingBackendAcks(): Int {
        val pendingEntries = journal.unconfirmedPrintedJobs()
        if (pendingEntries.isEmpty()) return 0

        val batchPairs = pendingEntries.map { it.jobId to it.printerName }
        val response = apiClient.completeBatch(batchPairs)
        val settledIds = (response.confirmedJobIds + response.rejectedJobIds).distinct()
        for (jobId in settledIds) {
            journal.markBackendConfirmed(jobId)
        }
        return response.confirmedJobIds.size
    }

    fun executeRemoteCommand(
        command: AgentCommand,
        printers: List<BluetoothPrinterDevice>,
        preferredAddress: String? = null,
    ): AgentCommandResult {
        if (command.action.trim().lowercase() != "test_bluetooth") {
            val unsupported = AgentCommandResult(
                success = false,
                code = "unsupported_action",
                message = "Ação remota '${command.action}' não suportada no KÔMA Print Android.",
            )
            apiClient.completeCommand(command.id, unsupported, printers)
            return unsupported
        }

        val target = findPrinterForCommand(command, printers, preferredAddress)
        if (target == null) {
            val noPrinter = AgentCommandResult(
                success = false,
                code = "bluetooth_not_paired",
                message = "Nenhuma impressora Bluetooth SPP pareada encontrada no celular.",
            )
            apiClient.completeCommand(command.id, noPrinter, printers)
            return noPrinter
        }

        if (!target.dispatchable) {
            val notReady = AgentCommandResult(
                success = false,
                code = "bluetooth_unavailable",
                message = "Impressora '${target.name}' (${target.normalizedAddress}) não está pronta para envio Bluetooth SPP.",
                printerName = target.name,
            )
            apiClient.completeCommand(command.id, notReady, printers)
            return notReady
        }

        val testPayload = EscPos58Renderer.buildKapbomSelfTestPayload(
            restaurantName = restaurantDisplayName,
            printerName = target.name,
            printerAddress = target.normalizedAddress,
        )
        val tx = bluetoothTransport.sendRawPayload(target, testPayload)
        val result = if (tx.success) {
            AgentCommandResult(
                success = true,
                code = "printed",
                message = "Teste 58mm enviado com sucesso para ${target.name} (${target.normalizedAddress}).",
                printerName = target.name,
            )
        } else {
            AgentCommandResult(
                success = false,
                code = tx.errorCode ?: "bluetooth_send_failed",
                message = tx.errorMessage ?: "Falha ao transmitir teste para ${target.name}.",
                printerName = target.name,
            )
        }
        apiClient.completeCommand(command.id, result, printers)
        return result
    }

    fun runCycle(
        preferredPrinterAddress: String? = null,
        batchLimit: Int = 5,
        includeHeartbeat: Boolean = true,
    ): PrintCycleOutcome {
        val printers = resolvePrinters(preferredPrinterAddress)
        var executedCommandId: String? = null

        if (includeHeartbeat) {
            val hb = apiClient.heartbeat(printers)
            if (hb.command != null) {
                executeRemoteCommand(hb.command, printers, preferredPrinterAddress)
                executedCommandId = hb.command.id
            }
        }

        val reconciledCount = reconcilePendingBackendAcks()
        val targetPrinter = selectTargetPrinter(printers, preferredPrinterAddress)
        if (targetPrinter == null || !targetPrinter.dispatchable) {
            return PrintCycleOutcome(
                backendConfirmedCount = reconciledCount,
                executedCommandId = executedCommandId,
                printerDispatchable = false,
            )
        }

        val claimedJobs = apiClient.claimBatch(limit = batchLimit)
        if (claimedJobs.isEmpty()) {
            return PrintCycleOutcome(
                claimedCount = 0,
                backendConfirmedCount = reconciledCount,
                executedCommandId = executedCommandId,
                printerDispatchable = true,
            )
        }

        val completedPairs = mutableListOf<Pair<String, String>>()
        val untouchedJobIds = mutableListOf<String>()
        var failedJob: Pair<String, String>? = null
        var printedCount = 0
        var deduplicatedSkipCount = 0

        for ((index, job) in claimedJobs.withIndex()) {
            if (journal.hasReachedTransport(job.id, job.idempotencyKey)) {
                // Prevenção de duplicidade: job já foi enviado ao Bluetooth anteriormente.
                // Apenas reconfirma no backend sem reimprimir fisicamente.
                deduplicatedSkipCount++
                completedPairs.add(job.id to targetPrinter.name)
                continue
            }

            journal.recordReceivedLocal(
                jobId = job.id,
                idempotencyKey = job.idempotencyKey,
                printerName = targetPrinter.name,
            )

            val escPosBytes = EscPos58Renderer.buildEscPosPayload(
                payloadText = job.payloadText,
                profile = targetPrinter.profile,
            )

            val txResult = bluetoothTransport.sendRawPayload(targetPrinter, escPosBytes)
            if (txResult.success) {
                journal.recordSentToTransport(
                    jobId = job.id,
                    idempotencyKey = job.idempotencyKey,
                    printerName = targetPrinter.name,
                )
                printedCount++
                completedPairs.add(job.id to targetPrinter.name)
            } else {
                val reason = txResult.errorMessage
                    ?: "Falha ao enviar comando ESC/POS via Bluetooth SPP para ${targetPrinter.name}"
                failedJob = job.id to reason
                for (remainingIdx in (index + 1) until claimedJobs.size) {
                    untouchedJobIds.add(claimedJobs[remainingIdx].id)
                }
                break
            }
        }

        var newlyConfirmedCount = reconciledCount
        if (completedPairs.isNotEmpty()) {
            val completeRes = apiClient.completeBatch(completedPairs)
            val settledIds = (completeRes.confirmedJobIds + completeRes.rejectedJobIds).distinct()
            for (jobId in settledIds) {
                journal.markBackendConfirmed(jobId)
            }
            newlyConfirmedCount += completeRes.confirmedJobIds.size
        }

        if (failedJob != null) {
            apiClient.failJob(failedJob.first, failedJob.second)
        }

        var releasedCount = 0
        if (untouchedJobIds.isNotEmpty()) {
            releasedCount = apiClient.releaseBatch(untouchedJobIds).size
        }

        return PrintCycleOutcome(
            claimedCount = claimedJobs.size,
            printedAndSentCount = printedCount,
            deduplicatedSkipCount = deduplicatedSkipCount,
            backendConfirmedCount = newlyConfirmedCount,
            releasedUntouchedCount = releasedCount,
            failedJobId = failedJob?.first,
            failureReason = failedJob?.second,
            executedCommandId = executedCommandId,
            printerDispatchable = true,
        )
    }

    private fun findPrinterForCommand(
        command: AgentCommand,
        printers: List<BluetoothPrinterDevice>,
        preferredAddress: String?,
    ): BluetoothPrinterDevice? {
        val requestedUri = command.printerUri?.trim()?.takeIf { it.isNotEmpty() }
        if (requestedUri != null) {
            val normalizedMac = BluetoothPrinterDevice.normalizeMacAddress(requestedUri)
            printers.firstOrNull {
                it.uri.equals(requestedUri, ignoreCase = true) ||
                    it.normalizedAddress.equals(normalizedMac, ignoreCase = true)
            }?.let { return it }
        }
        val requestedName = command.printerName?.trim()?.takeIf { it.isNotEmpty() }
        if (requestedName != null) {
            printers.firstOrNull { it.name.equals(requestedName, ignoreCase = true) }?.let { return it }
        }
        return selectTargetPrinter(printers, preferredAddress)
    }
}
