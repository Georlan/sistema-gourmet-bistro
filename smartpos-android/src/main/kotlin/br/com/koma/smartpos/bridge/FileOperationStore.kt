package br.com.koma.smartpos.bridge

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.util.Base64
import java.util.Properties

class FileOperationStore(private val directory: Path) : OperationStore {
    init {
        Files.createDirectories(directory)
    }

    @Synchronized
    override fun get(operationKey: String): LocalOperation? {
        val path = pathFor(operationKey)
        if (!Files.exists(path)) return null

        val properties = Properties()
        BufferedInputStream(Files.newInputStream(path)).use(properties::load)
        require(properties.getProperty("operationKey") == operationKey) { "Arquivo local de operação corrompido" }

        val lastOutcome = properties.getProperty("lastOutcome")?.takeIf { it.isNotBlank() }
        val lastResult = lastOutcome?.let {
            TerminalPaymentResult(
                outcome = PaymentOutcome.valueOf(it),
                reference = properties.getProperty("lastReference")?.takeIf(String::isNotBlank),
                message = properties.getProperty("lastMessage")?.takeIf(String::isNotBlank),
            )
        }

        return LocalOperation(
            intentId = properties.require("intentId"),
            provider = properties.require("provider"),
            operationKey = operationKey,
            terminalId = properties.require("terminalId"),
            started = properties.getProperty("started", "true").toBooleanStrict(),
            lastResult = lastResult,
        )
    }

    @Synchronized
    override fun put(operation: LocalOperation) {
        val target = pathFor(operation.operationKey)
        val temp = Files.createTempFile(directory, "operation-", ".tmp")
        val properties = Properties().apply {
            setProperty("intentId", operation.intentId)
            setProperty("provider", operation.provider)
            setProperty("operationKey", operation.operationKey)
            setProperty("terminalId", operation.terminalId)
            setProperty("started", operation.started.toString())
            operation.lastResult?.let { result ->
                setProperty("lastOutcome", result.outcome.name)
                setProperty("lastReference", result.reference.orEmpty())
                setProperty("lastMessage", result.message.orEmpty())
            }
        }

        try {
            BufferedOutputStream(Files.newOutputStream(temp)).use { properties.store(it, null) }
            try {
                Files.move(
                    temp,
                    target,
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE,
                )
            } catch (_: java.nio.file.AtomicMoveNotSupportedException) {
                Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING)
            }
        } finally {
            Files.deleteIfExists(temp)
        }
    }

    private fun pathFor(operationKey: String): Path {
        val encoded = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(operationKey.toByteArray(Charsets.UTF_8))
        return directory.resolve("$encoded.properties")
    }

    private fun Properties.require(key: String): String =
        getProperty(key)?.takeIf(String::isNotBlank)
            ?: error("Campo obrigatório ausente no armazenamento local: $key")
}
