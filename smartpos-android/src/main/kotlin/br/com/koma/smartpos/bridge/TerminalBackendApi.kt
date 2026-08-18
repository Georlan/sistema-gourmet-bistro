package br.com.koma.smartpos.bridge

import java.math.BigDecimal
import java.net.HttpURLConnection
import java.net.URL

interface TerminalBackendApi {
    fun prepare(intentId: String, provider: String, operationKey: String, terminalId: String): TerminalCommand
    fun submitResult(command: TerminalCommand, result: TerminalPaymentResult): TerminalResultAck
}

data class TerminalResultAck(
    val intentId: String,
    val status: String,
    val replayed: Boolean,
)

interface HttpTransport {
    fun post(path: String, body: String): HttpResponsePayload
}

data class HttpResponsePayload(val statusCode: Int, val body: String)

class JdkHttpTransport(
    private val baseUrl: String,
    private val bearerToken: () -> String,
    private val connectTimeoutMs: Int = 10_000,
    private val readTimeoutMs: Int = 30_000,
) : HttpTransport {
    override fun post(path: String, body: String): HttpResponsePayload {
        val connection = URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.connectTimeout = connectTimeoutMs
            connection.readTimeout = readTimeoutMs
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer ${bearerToken()}")

            connection.outputStream.use { output ->
                output.write(body.toByteArray(Charsets.UTF_8))
            }

            val status = connection.responseCode
            val stream = if (status in 200..399) connection.inputStream else connection.errorStream
            val responseBody = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            HttpResponsePayload(status, responseBody)
        } finally {
            connection.disconnect()
        }
    }
}

class KomaTerminalBackendApi(private val transport: HttpTransport) : TerminalBackendApi {
    override fun prepare(
        intentId: String,
        provider: String,
        operationKey: String,
        terminalId: String,
    ): TerminalCommand {
        val response = transport.post(
            "/smartpos/payment-intents/${encodePath(intentId)}/preparar-terminal",
            "{\"provider\":${json(provider)},\"operation_key\":${json(operationKey)},\"terminal_id\":${json(terminalId)}}",
        )
        requireSuccess(response)
        return TerminalCommand(
            intentId = JsonField.string(response.body, "intent_id"),
            restauranteId = JsonField.int(response.body, "restaurante_id"),
            provider = JsonField.string(response.body, "provider"),
            operationKey = JsonField.string(response.body, "operation_key"),
            terminalId = JsonField.string(response.body, "terminal_id"),
            amountMinor = BigDecimal(JsonField.string(response.body, "amount"))
                .movePointRight(2)
                .longValueExact(),
            method = JsonField.string(response.body, "method"),
            mode = CommandMode.valueOf(JsonField.string(response.body, "mode").uppercase()),
            shouldExecute = JsonField.boolean(response.body, "should_execute"),
        )
    }

    override fun submitResult(command: TerminalCommand, result: TerminalPaymentResult): TerminalResultAck {
        val response = transport.post(
            "/smartpos/payment-intents/${encodePath(command.intentId)}/resultado-terminal",
            buildString {
                append("{\"provider\":").append(json(command.provider))
                append(",\"operation_key\":").append(json(command.operationKey))
                append(",\"terminal_id\":").append(json(command.terminalId))
                append(",\"outcome\":").append(json(result.outcome.name.lowercase()))
                result.reference?.let { append(",\"reference\":").append(json(it)) }
                result.message?.let { append(",\"message\":").append(json(it)) }
                append('}')
            },
        )
        requireSuccess(response)
        return TerminalResultAck(
            intentId = JsonField.string(response.body, "intent_id"),
            status = JsonField.string(response.body, "status"),
            replayed = JsonField.boolean(response.body, "replayed"),
        )
    }

    private fun requireSuccess(response: HttpResponsePayload) {
        if (response.statusCode !in 200..299) {
            error("Backend Kôma respondeu HTTP ${response.statusCode}: ${response.body.take(240)}")
        }
    }

    private fun encodePath(value: String): String = java.net.URLEncoder.encode(value, Charsets.UTF_8)
        .replace("+", "%20")

    private fun json(value: String): String = "\"" + value
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
        .replace("\n", "\\n") + "\""
}

private object JsonField {
    fun string(json: String, name: String): String {
        val pattern = Regex("\\\"${Regex.escape(name)}\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"])*)\\\"")
        val raw = pattern.find(json)?.groupValues?.get(1)
            ?: error("Campo JSON ausente: $name")
        return raw
            .replace("\\\"", "\"")
            .replace("\\n", "\n")
            .replace("\\\\", "\\")
    }

    fun int(json: String, name: String): Int {
        val pattern = Regex("\\\"${Regex.escape(name)}\\\"\\s*:\\s*(-?\\d+)")
        return pattern.find(json)?.groupValues?.get(1)?.toInt()
            ?: error("Campo JSON inteiro ausente: $name")
    }

    fun boolean(json: String, name: String): Boolean {
        val pattern = Regex("\\\"${Regex.escape(name)}\\\"\\s*:\\s*(true|false)")
        return pattern.find(json)?.groupValues?.get(1)?.toBooleanStrict()
            ?: error("Campo JSON booleano ausente: $name")
    }
}
