package br.com.koma.print.core

import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder

data class HttpResponsePayload(val statusCode: Int, val body: String)

interface PrintAgentHttpTransport {
    fun post(path: String, body: String, headers: Map<String, String> = emptyMap()): HttpResponsePayload
    fun get(path: String, headers: Map<String, String> = emptyMap()): HttpResponsePayload
}

class JdkPrintAgentHttpTransport(
    private val baseUrl: String,
    private val connectTimeoutMs: Int = 10_000,
    private val readTimeoutMs: Int = 25_000,
) : PrintAgentHttpTransport {
    override fun post(path: String, body: String, headers: Map<String, String>): HttpResponsePayload =
        request("POST", path, body, headers)

    override fun get(path: String, headers: Map<String, String>): HttpResponsePayload =
        request("GET", path, null, headers)

    private fun request(
        method: String,
        path: String,
        body: String?,
        headers: Map<String, String>,
    ): HttpResponsePayload {
        val connection = URI.create(baseUrl.trimEnd('/') + path).toURL().openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = method
            connection.connectTimeout = connectTimeoutMs
            connection.readTimeout = readTimeoutMs
            connection.setRequestProperty("Accept", "application/json")
            for ((k, v) in headers) {
                connection.setRequestProperty(k, v)
            }
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { out ->
                    out.write(body.toByteArray(Charsets.UTF_8))
                }
            }
            val code = connection.responseCode
            val stream = if (code in 200..399) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            HttpResponsePayload(code, text)
        } finally {
            connection.disconnect()
        }
    }
}

data class CompleteBatchResponse(
    val confirmedJobIds: List<String>,
    val rejectedJobIds: List<String>,
)

class AgentRevokedException(message: String) : RuntimeException(message)

/**
 * Cliente HTTP oficial do KÔMA Print Android para as rotas `/api/print-agents`.
 * Reutiliza integralmente os endpoints existentes do backend sem criar contrato paralelo.
 */
class KomaPrintAgentClient(
    private val transport: PrintAgentHttpTransport,
    private val agentTokenProvider: () -> String,
    private val agentVersion: String = "1.0.0-android",
) {
    fun loginAndRegisterAgent(
        username: String,
        password: String,
        restauranteId: Int? = null,
        requestedAgentId: String,
    ): RegisteredAgentCredentials {
        val loginBody = buildString {
            append("{\"username\":").append(jsonString(username.trim()))
            append(",\"password\":").append(jsonString(password))
            restauranteId?.let { append(",\"restaurante_id\":").append(it) }
            append('}')
        }
        val loginRes = transport.post("/auth/login", loginBody)
        if (loginRes.statusCode !in 200..299) {
            error("Falha no login (${loginRes.statusCode}): ${loginRes.body.take(200)}")
        }
        val jwt = MinimalJson.string(loginRes.body, "access_token")

        val registerBody = "{\"agent_id\":${jsonString(requestedAgentId.trim())}}"
        val regRes = transport.post(
            "/api/print-agents/register",
            registerBody,
            headers = mapOf("Authorization" to "Bearer $jwt"),
        )
        if (regRes.statusCode !in 200..299) {
            error("Falha ao registrar agente Android (${regRes.statusCode}): ${regRes.body.take(200)}")
        }
        return RegisteredAgentCredentials(
            agentId = MinimalJson.string(regRes.body, "agent_id"),
            restauranteId = MinimalJson.int(regRes.body, "restaurante_id"),
            agentToken = MinimalJson.string(regRes.body, "agent_token"),
        )
    }

    fun heartbeat(printers: List<BluetoothPrinterDevice>): HeartbeatResponse {
        val body = "{\"diagnostics\":${buildDiagnosticsJson(printers)}}"
        val response = transport.post("/api/print-agents/heartbeat", body, agentHeaders())
        ensureAuthorizedAndSuccess(response, "heartbeat")

        val commandObj = MinimalJson.nullableObject(response.body, "command")
        val command = commandObj?.let { rawCmd ->
            val cmdId = MinimalJson.nullableString(rawCmd, "id")
            val action = MinimalJson.nullableString(rawCmd, "action")
            if (!cmdId.isNullOrBlank() && !action.isNullOrBlank()) {
                AgentCommand(
                    id = cmdId,
                    action = action,
                    printerName = MinimalJson.nullableString(rawCmd, "printer_name"),
                    printerUri = MinimalJson.nullableString(rawCmd, "printer_uri"),
                )
            } else {
                null
            }
        }

        return HeartbeatResponse(
            status = MinimalJson.string(response.body, "status"),
            agentId = MinimalJson.string(response.body, "agent_id"),
            restauranteId = MinimalJson.int(response.body, "restaurante_id"),
            command = command,
        )
    }

    fun completeCommand(
        commandId: String,
        result: AgentCommandResult,
        printers: List<BluetoothPrinterDevice>,
    ): Boolean {
        val body = buildString {
            append('{')
            append("\"success\":").append(result.success)
            append(",\"code\":").append(jsonString(result.code))
            append(",\"message\":").append(jsonString(result.message))
            result.printerName?.let { append(",\"printer_name\":").append(jsonString(it)) }
            append(",\"diagnostics\":").append(buildDiagnosticsJson(printers))
            append('}')
        }
        val encodedId = URLEncoder.encode(commandId, Charsets.UTF_8).replace("+", "%20")
        val res = transport.post("/api/print-agents/actions/$encodedId/complete", body, agentHeaders())
        if (res.statusCode == 409) return true // already completed or expired on server
        ensureAuthorizedAndSuccess(res, "completeCommand")
        return true
    }

    fun claimBatch(limit: Int = 5): List<ClaimedPrintJob> {
        val clamped = limit.coerceIn(1, 10)
        val res = transport.post("/api/print-agents/jobs/claim-batch?limit=$clamped", "", agentHeaders())
        ensureAuthorizedAndSuccess(res, "claimBatch")
        val trimmed = res.body.trim()
        if (trimmed.isEmpty() || trimmed == "null" || trimmed == "[]") return emptyList()
        return MinimalJson.objectArray(trimmed).map { obj ->
            val jobId = MinimalJson.string(obj, "id")
            ClaimedPrintJob(
                id = jobId,
                restauranteId = MinimalJson.int(obj, "restaurante_id"),
                documentType = MinimalJson.nullableString(obj, "document_type") ?: "producao",
                destination = MinimalJson.nullableString(obj, "destination") ?: "COZINHA",
                sourceType = MinimalJson.nullableString(obj, "source_type") ?: "pedido",
                sourceId = MinimalJson.nullableString(obj, "source_id") ?: "manual",
                payloadText = MinimalJson.string(obj, "payload_text"),
                idempotencyKey = MinimalJson.nullableString(obj, "idempotency_key") ?: jobId,
                attempts = MinimalJson.nullableInt(obj, "attempts") ?: 0,
            )
        }
    }

    fun completeBatch(jobs: List<Pair<String, String>>): CompleteBatchResponse {
        if (jobs.isEmpty()) return CompleteBatchResponse(emptyList(), emptyList())
        val itemsJson = jobs.joinToString(",") { (jobId, printerName) ->
            "{\"job_id\":${jsonString(jobId)},\"printer_name\":${jsonString(printerName.ifBlank { "Kapbom KA-1445" })}}"
        }
        val body = "{\"jobs\":[$itemsJson]}"
        val res = transport.post("/api/print-agents/jobs/complete-batch", body, agentHeaders())
        ensureAuthorizedAndSuccess(res, "completeBatch")
        return CompleteBatchResponse(
            confirmedJobIds = MinimalJson.stringArray(res.body, "confirmed_job_ids"),
            rejectedJobIds = MinimalJson.stringArray(res.body, "rejected_job_ids"),
        )
    }

    fun releaseBatch(jobIds: List<String>): List<String> {
        if (jobIds.isEmpty()) return emptyList()
        val idsJson = jobIds.distinct().joinToString(",") { jsonString(it) }
        val body = "{\"job_ids\":[$idsJson]}"
        val res = transport.post("/api/print-agents/jobs/release-batch", body, agentHeaders())
        ensureAuthorizedAndSuccess(res, "releaseBatch")
        return MinimalJson.stringArray(res.body, "released_job_ids")
    }

    fun failJob(jobId: String, errorMessage: String) {
        val encodedId = URLEncoder.encode(jobId, Charsets.UTF_8).replace("+", "%20")
        val body = "{\"error\":${jsonString(errorMessage.take(280))}}"
        val res = transport.post("/api/print-agents/jobs/$encodedId/fail", body, agentHeaders())
        if (res.statusCode == 409 || res.statusCode == 404) return
        ensureAuthorizedAndSuccess(res, "failJob")
    }

    fun buildDiagnosticsJson(printers: List<BluetoothPrinterDevice>): String {
        val defaultPrinter = printers.firstOrNull { it.isDefault } ?: printers.firstOrNull()
        val printersJson = printers.joinToString(",") { p ->
            buildString {
                append('{')
                append("\"name\":").append(jsonString(p.name))
                append(",\"connection\":\"bluetooth\"")
                append(",\"uri\":").append(jsonString(p.uri))
                append(",\"address\":").append(jsonString(p.normalizedAddress))
                append(",\"is_default\":").append(p.isDefault)
                append(",\"available\":").append(p.connected)
                append(",\"present\":").append(p.connected)
                append(",\"configured\":").append(p.configured)
                append(",\"paired\":").append(p.paired)
                append(",\"trusted\":").append(p.paired)
                append(",\"connected\":").append(p.connected)
                append(",\"spp\":").append(p.sppSupported)
                append(",\"dispatchable\":").append(p.dispatchable)
                append('}')
            }
        }
        val endpointsJson = printers.joinToString(",") { p ->
            val epId = "bt-${p.normalizedAddress.replace(":", "").lowercase()}"
            buildString {
                append('{')
                append("\"id\":").append(jsonString(epId))
                append(",\"name\":").append(jsonString(p.name))
                append(",\"display_name\":").append(jsonString(p.name))
                append(",\"transport\":\"bluetooth_rfcomm\"")
                append(",\"address\":").append(jsonString(p.normalizedAddress))
                append(",\"protocol\":\"escpos\"")
                append(",\"options\":{")
                append("\"paper_profile\":").append(jsonString(p.profile.key))
                append(",\"paper_width_mm\":").append(p.profile.paperWidthMm)
                append(",\"columns\":").append(p.profile.columns)
                append(",\"compact_layout\":").append(p.profile.compactLayout)
                append(",\"supports_cut\":").append(p.profile.supportsCut)
                append(",\"feed_lines\":").append(p.profile.feedLines)
                append(",\"allow_double_height\":").append(p.profile.allowDoubleHeight)
                append(",\"charset_policy\":").append(jsonString(p.profile.charsetPolicy))
                append(",\"semantic_layout\":").append(jsonString(p.profile.semanticLayout))
                append("}}")
            }
        }
        val destinationsJson = if (defaultPrinter != null) {
            val epId = "bt-${defaultPrinter.normalizedAddress.replace(":", "").lowercase()}"
            "{\"PADRAO\":${jsonString(epId)},\"COZINHA\":${jsonString(epId)},\"CAIXA\":${jsonString(epId)},\"BAR\":${jsonString(epId)}}"
        } else {
            "{}"
        }

        return buildString {
            append('{')
            append("\"agent_version\":").append(jsonString(agentVersion))
            append(",\"adapter\":\"android_bluetooth_spp\"")
            append(",\"platform\":\"android\"")
            append(",\"printers\":[").append(printersJson).append(']')
            append(",\"endpoints\":[").append(endpointsJson).append(']')
            append(",\"destinations\":").append(destinationsJson)
            if (defaultPrinter != null) {
                append(",\"default_printer\":").append(jsonString(defaultPrinter.name))
            } else {
                append(",\"default_printer\":null")
            }
            append(",\"capabilities\":[\"test_bluetooth\"]")
            append('}')
        }
    }

    private fun agentHeaders(): Map<String, String> {
        val token = agentTokenProvider().trim()
        require(token.isNotEmpty()) { "Token do agente de impressão não configurado." }
        return mapOf(
            "X-Agent-Token" to token,
        )
    }

    private fun ensureAuthorizedAndSuccess(res: HttpResponsePayload, operation: String) {
        if (res.statusCode == 401 || res.statusCode == 403) {
            throw AgentRevokedException("Credencial do agente recusada ($operation: HTTP ${res.statusCode})")
        }
        if (res.statusCode !in 200..299) {
            error("Erro HTTP ${res.statusCode} em $operation: ${res.body.take(240)}")
        }
    }

    companion object {
        fun jsonString(value: String): String = buildString(value.length + 8) {
            append('"')
            for (ch in value) {
                when (ch) {
                    '\\' -> append("\\\\")
                    '"' -> append("\\\"")
                    '\n' -> append("\\n")
                    '\r' -> append("\\r")
                    '\t' -> append("\\t")
                    else -> if (ch.code < 0x20) {
                        append("\\u%04x".format(ch.code))
                    } else {
                        append(ch)
                    }
                }
            }
            append('"')
        }
    }
}

internal object MinimalJson {
    fun string(json: String, field: String): String =
        nullableString(json, field) ?: error("Campo JSON obrigatório ausente: $field")

    fun nullableString(json: String, field: String): String? {
        val nullRegex = Regex("\"${Regex.escape(field)}\"\\s*:\\s*null")
        if (nullRegex.containsMatchIn(json)) return null
        val regex = Regex("\"${Regex.escape(field)}\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"")
        val raw = regex.find(json)?.groupValues?.get(1) ?: return null
        return unescapeJsonString(raw)
    }

    fun int(json: String, field: String): Int =
        nullableInt(json, field) ?: error("Campo JSON inteiro ausente: $field")

    fun nullableInt(json: String, field: String): Int? {
        val regex = Regex("\"${Regex.escape(field)}\"\\s*:\\s*(-?\\d+)")
        return regex.find(json)?.groupValues?.get(1)?.toIntOrNull()
    }

    fun nullableObject(json: String, field: String): String? {
        val nullRegex = Regex("\"${Regex.escape(field)}\"\\s*:\\s*null")
        if (nullRegex.containsMatchIn(json)) return null
        val keyMatch = Regex("\"${Regex.escape(field)}\"\\s*:\\s*\\{").find(json) ?: return null
        val start = json.indexOf('{', keyMatch.range.first)
        if (start < 0) return null
        return extractBalancedBraces(json, start)
    }

    fun stringArray(json: String, field: String): List<String> {
        val keyMatch = Regex("\"${Regex.escape(field)}\"\\s*:\\s*\\[").find(json) ?: return emptyList()
        val start = json.indexOf('[', keyMatch.range.first)
        if (start < 0) return emptyList()
        val arrayText = extractBalancedBrackets(json, start) ?: return emptyList()
        val itemRegex = Regex("\"((?:\\\\.|[^\"\\\\])*)\"")
        return itemRegex.findAll(arrayText).map { unescapeJsonString(it.groupValues[1]) }.toList()
    }

    fun objectArray(json: String): List<String> {
        val trimmed = json.trim()
        require(trimmed.startsWith('[') && trimmed.endsWith(']')) { "JSON array inválido" }
        val result = mutableListOf<String>()
        var depth = 0
        var start = -1
        var inString = false
        var escaped = false
        for (i in trimmed.indices) {
            val ch = trimmed[i]
            if (inString) {
                if (escaped) escaped = false
                else if (ch == '\\') escaped = true
                else if (ch == '"') inString = false
                continue
            }
            when (ch) {
                '"' -> inString = true
                '{' -> {
                    if (depth == 0) start = i
                    depth++
                }
                '}' -> {
                    depth--
                    if (depth == 0 && start >= 0) {
                        result.add(trimmed.substring(start, i + 1))
                        start = -1
                    }
                }
            }
        }
        return result
    }

    private fun extractBalancedBraces(text: String, startIdx: Int): String? {
        var depth = 0
        var inString = false
        var escaped = false
        for (i in startIdx until text.length) {
            val ch = text[i]
            if (inString) {
                if (escaped) escaped = false
                else if (ch == '\\') escaped = true
                else if (ch == '"') inString = false
                continue
            }
            when (ch) {
                '"' -> inString = true
                '{' -> depth++
                '}' -> {
                    depth--
                    if (depth == 0) return text.substring(startIdx, i + 1)
                }
            }
        }
        return null
    }

    private fun extractBalancedBrackets(text: String, startIdx: Int): String? {
        var depth = 0
        var inString = false
        var escaped = false
        for (i in startIdx until text.length) {
            val ch = text[i]
            if (inString) {
                if (escaped) escaped = false
                else if (ch == '\\') escaped = true
                else if (ch == '"') inString = false
                continue
            }
            when (ch) {
                '"' -> inString = true
                '[' -> depth++
                ']' -> {
                    depth--
                    if (depth == 0) return text.substring(startIdx, i + 1)
                }
            }
        }
        return null
    }

    private fun unescapeJsonString(raw: String): String {
        val sb = StringBuilder(raw.length)
        var i = 0
        while (i < raw.length) {
            val ch = raw[i]
            if (ch == '\\' && i + 1 < raw.length) {
                val next = raw[i + 1]
                when (next) {
                    '"' -> { sb.append('"'); i += 2 }
                    '\\' -> { sb.append('\\'); i += 2 }
                    '/' -> { sb.append('/'); i += 2 }
                    'b' -> { sb.append('\b'); i += 2 }
                    'f' -> { sb.append('\u000C'); i += 2 }
                    'n' -> { sb.append('\n'); i += 2 }
                    'r' -> { sb.append('\r'); i += 2 }
                    't' -> { sb.append('\t'); i += 2 }
                    'u' -> {
                        if (i + 5 < raw.length) {
                            val hex = raw.substring(i + 2, i + 6)
                            val code = hex.toIntOrNull(16)
                            if (code != null) {
                                sb.append(code.toChar())
                                i += 6
                                continue
                            }
                        }
                        sb.append(ch)
                        i++
                    }
                    else -> {
                        sb.append(next)
                        i += 2
                    }
                }
            } else {
                sb.append(ch)
                i++
            }
        }
        return sb.toString()
    }
}
