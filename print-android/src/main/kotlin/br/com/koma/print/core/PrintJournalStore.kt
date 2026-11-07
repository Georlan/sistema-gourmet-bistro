package br.com.koma.print.core

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.util.Properties

interface PrintJournal {
    fun get(jobId: String): JournalEntry?
    fun hasReachedTransport(jobId: String, idempotencyKey: String? = null): Boolean
    fun isBackendConfirmed(jobId: String): Boolean
    fun recordReceivedLocal(jobId: String, idempotencyKey: String, printerName: String): JournalEntry
    fun recordSentToTransport(jobId: String, idempotencyKey: String, printerName: String): JournalEntry
    fun markBackendConfirmed(jobId: String): JournalEntry?
    fun markPhysicallyVerified(jobId: String): JournalEntry?
    fun unconfirmedPrintedJobs(): List<JournalEntry>
}

/**
 * Diário local durável (persistido em disco com escrita atômica) para idempotência
 * e prevenção de duplicidade entre o socket Bluetooth SPP e o backend KÔMA.
 *
 * Nunca reenvia ao Bluetooth um job que já atingiu `ENVIADO_TRANSPORTE`, mesmo se
 * a rede cair antes do retorno de `/api/print-agents/jobs/complete-batch`.
 */
class FilePrintJournal(
    private val storageFile: Path,
    private val clockEpochMs: () -> Long = { System.currentTimeMillis() },
    private val retentionMs: Long = 7L * 24L * 60L * 60L * 1000L,
    private val maxConfirmedEntries: Int = 2000,
) : PrintJournal {
    private val entriesByJobId = LinkedHashMap<String, JournalEntry>()

    init {
        storageFile.parent?.let { Files.createDirectories(it) }
        loadFromDisk()
    }

    @Synchronized
    override fun get(jobId: String): JournalEntry? = entriesByJobId[jobId]

    @Synchronized
    override fun hasReachedTransport(jobId: String, idempotencyKey: String?): Boolean {
        val byId = entriesByJobId[jobId]
        if (byId != null && byId.stage.hasReachedTransport()) {
            return true
        }
        val cleanKey = idempotencyKey?.trim().orEmpty()
        if (cleanKey.isNotEmpty()) {
            return entriesByJobId.values.any {
                it.idempotencyKey == cleanKey && it.stage.hasReachedTransport()
            }
        }
        return false
    }

    @Synchronized
    override fun isBackendConfirmed(jobId: String): Boolean =
        entriesByJobId[jobId]?.stage?.isConfirmedOnBackend() == true

    @Synchronized
    override fun recordReceivedLocal(
        jobId: String,
        idempotencyKey: String,
        printerName: String,
    ): JournalEntry {
        val existing = entriesByJobId[jobId]
        if (existing != null && existing.stage.ordinal >= PrintReceiptStage.RECEBIDO_LOCAL.ordinal) {
            return existing
        }
        val entry = JournalEntry(
            jobId = jobId,
            idempotencyKey = idempotencyKey.ifBlank { jobId },
            printerName = printerName,
            stage = PrintReceiptStage.RECEBIDO_LOCAL,
            updatedAtEpochMs = clockEpochMs(),
        )
        entriesByJobId[jobId] = entry
        persistToDisk()
        return entry
    }

    @Synchronized
    override fun recordSentToTransport(
        jobId: String,
        idempotencyKey: String,
        printerName: String,
    ): JournalEntry {
        val existing = entriesByJobId[jobId]
        val resolvedStage = if (existing != null && existing.stage.isConfirmedOnBackend()) {
            existing.stage
        } else {
            PrintReceiptStage.ENVIADO_TRANSPORTE
        }
        val entry = JournalEntry(
            jobId = jobId,
            idempotencyKey = idempotencyKey.ifBlank { existing?.idempotencyKey ?: jobId },
            printerName = printerName.ifBlank { existing?.printerName ?: "Padrão" },
            stage = resolvedStage,
            updatedAtEpochMs = clockEpochMs(),
        )
        entriesByJobId[jobId] = entry
        persistToDisk()
        return entry
    }

    @Synchronized
    override fun markBackendConfirmed(jobId: String): JournalEntry? {
        val existing = entriesByJobId[jobId] ?: return null
        val nextStage = if (existing.stage == PrintReceiptStage.IMPRESSO_FISICAMENTE_VERIFICADO) {
            PrintReceiptStage.IMPRESSO_FISICAMENTE_VERIFICADO
        } else {
            PrintReceiptStage.CONFIRMADO_BACKEND
        }
        val updated = existing.copy(
            stage = nextStage,
            updatedAtEpochMs = clockEpochMs(),
        )
        entriesByJobId[jobId] = updated
        pruneConfirmedLocked()
        persistToDisk()
        return updated
    }

    @Synchronized
    override fun markPhysicallyVerified(jobId: String): JournalEntry? {
        val existing = entriesByJobId[jobId] ?: return null
        val updated = existing.copy(
            stage = PrintReceiptStage.IMPRESSO_FISICAMENTE_VERIFICADO,
            updatedAtEpochMs = clockEpochMs(),
        )
        entriesByJobId[jobId] = updated
        persistToDisk()
        return updated
    }

    @Synchronized
    override fun unconfirmedPrintedJobs(): List<JournalEntry> =
        entriesByJobId.values.filter { it.stage == PrintReceiptStage.ENVIADO_TRANSPORTE }

    private fun pruneConfirmedLocked() {
        val now = clockEpochMs()
        val cutoff = now - retentionMs
        val expiredIds = entriesByJobId.values
            .filter { it.stage.isConfirmedOnBackend() && it.updatedAtEpochMs < cutoff }
            .map { it.jobId }
        for (id in expiredIds) {
            entriesByJobId.remove(id)
        }

        val confirmedSorted = entriesByJobId.values
            .filter { it.stage.isConfirmedOnBackend() }
            .sortedByDescending { it.updatedAtEpochMs }
        if (confirmedSorted.size > maxConfirmedEntries) {
            for (overflow in confirmedSorted.drop(maxConfirmedEntries)) {
                entriesByJobId.remove(overflow.jobId)
            }
        }
    }

    private fun loadFromDisk() {
        if (!Files.exists(storageFile)) return
        val props = Properties()
        BufferedInputStream(Files.newInputStream(storageFile)).use(props::load)
        val count = props.getProperty("count", "0").toIntOrNull() ?: 0
        for (i in 0 until count) {
            val jobId = props.getProperty("entry.$i.jobId")?.takeIf { it.isNotBlank() } ?: continue
            val ikey = props.getProperty("entry.$i.idempotencyKey").orEmpty().ifBlank { jobId }
            val printerName = props.getProperty("entry.$i.printerName").orEmpty().ifBlank { "Padrão" }
            val stageRaw = props.getProperty("entry.$i.stage").orEmpty()
            val stage = runCatching { PrintReceiptStage.valueOf(stageRaw) }
                .getOrDefault(PrintReceiptStage.RECEBIDO_LOCAL)
            val updatedAt = props.getProperty("entry.$i.updatedAt", "0").toLongOrNull() ?: 0L
            entriesByJobId[jobId] = JournalEntry(
                jobId = jobId,
                idempotencyKey = ikey,
                printerName = printerName,
                stage = stage,
                updatedAtEpochMs = updatedAt,
            )
        }
    }

    private fun persistToDisk() {
        val parentDir = storageFile.parent ?: storageFile.toAbsolutePath().parent
        val tempFile = Files.createTempFile(parentDir, "print-journal-", ".tmp")
        val props = Properties()
        val entries = entriesByJobId.values.toList()
        props.setProperty("count", entries.size.toString())
        entries.forEachIndexed { index, entry ->
            props.setProperty("entry.$index.jobId", entry.jobId)
            props.setProperty("entry.$index.idempotencyKey", entry.idempotencyKey)
            props.setProperty("entry.$index.printerName", entry.printerName)
            props.setProperty("entry.$index.stage", entry.stage.name)
            props.setProperty("entry.$index.updatedAt", entry.updatedAtEpochMs.toString())
        }
        try {
            BufferedOutputStream(Files.newOutputStream(tempFile)).use { props.store(it, null) }
            try {
                Files.move(
                    tempFile,
                    storageFile,
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE,
                )
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(tempFile, storageFile, StandardCopyOption.REPLACE_EXISTING)
            }
        } finally {
            Files.deleteIfExists(tempFile)
        }
    }
}
