package br.com.koma.smartpos.bridge

import java.math.BigDecimal
import java.net.URLEncoder
import java.security.MessageDigest


data class SmartPosContext(
    val smartposEnabled: Boolean,
    val turnoAberto: Boolean,
    val restauranteId: Int,
    val restauranteNome: String,
    val operadorId: String,
    val operadorNome: String,
    val operadorRole: String,
    val providerIntegratedAvailable: Boolean,
    val terminalMode: String,
)

data class RecentSmartPosOperation(
    val intentId: String,
    val mesaNome: String,
    val amountMinor: Long,
    val method: String,
    val status: String,
    val createdAt: String,
    val capture: String,
    val paymentId: String?,
) {
    fun displayLabel(): String {
        val reais = BigDecimal(amountMinor).movePointLeft(2).setScale(2)
            .toPlainString().replace('.', ',')
        return "$mesaNome · ${method.replaceFirstChar { it.uppercase() }} · R$ $reais · $status"
    }
}

data class PendingProviderIntent(
    val intentId: String,
    val mesaId: Int,
    val amountMinor: Long,
    val method: String,
    val status: String,
    val createdAt: String,
    val provider: String?,
    val terminalId: String?,
) {
    fun displayLabel(): String = "Mesa $mesaId · ${method.replaceFirstChar { it.uppercase() }} · ${moneyLabel()} · $status"

    private fun moneyLabel(): String {
        val reais = BigDecimal(amountMinor).movePointLeft(2).setScale(2)
        return "R$ ${reais.toPlainString().replace('.', ',')}"
    }
}

class KomaSmartPosSessionApi(private val transport: HttpTransport) {
    fun login(username: String, password: String, restauranteId: Int? = null): String {
        val response = transport.post(
            "/auth/login",
            buildString {
                append("{\"username\":").append(json(username.trim()))
                append(",\"password\":").append(json(password))
                restauranteId?.let { append(",\"restaurante_id\":").append(it) }
                append('}')
            },
        )
        requireSuccess(response, "login")
        return JsonField.string(response.body, "access_token")
    }

    fun context(): SmartPosContext {
        val response = transport.get("/auth/smartpos/contexto")
        requireSuccess(response, "contexto SmartPOS")
        val restaurante = JsonField.objectBody(response.body, "restaurante")
        val operador = JsonField.objectBody(response.body, "operador")
        return SmartPosContext(
            smartposEnabled = JsonField.boolean(response.body, "smartpos_enabled"),
            turnoAberto = JsonField.boolean(response.body, "turno_aberto"),
            restauranteId = JsonField.int(restaurante, "id"),
            restauranteNome = JsonField.string(restaurante, "nome"),
            operadorId = JsonField.string(operador, "id"),
            operadorNome = JsonField.string(operador, "nome"),
            operadorRole = JsonField.string(operador, "role"),
            providerIntegratedAvailable = JsonField.boolean(response.body, "provider_integrado_disponivel"),
            terminalMode = JsonField.string(response.body, "terminal_mode"),
        )
    }

    fun recentOperations(limit: Int = 5): List<RecentSmartPosOperation> {
        require(limit in 1..20) { "O limite deve estar entre 1 e 20." }
        val response = transport.get("/auth/smartpos/payment-intents/recentes?limit=$limit")
        requireSuccess(response, "histórico SmartPOS")
        return JsonField.objectArray(response.body).map { item ->
            RecentSmartPosOperation(
                intentId = JsonField.string(item, "intent_id"),
                mesaNome = JsonField.string(item, "mesa_nome"),
                amountMinor = BigDecimal(JsonField.string(item, "amount"))
                    .movePointRight(2)
                    .longValueExact(),
                method = JsonField.string(item, "method"),
                status = JsonField.string(item, "status"),
                createdAt = JsonField.string(item, "created_at"),
                capture = JsonField.string(item, "capture"),
                paymentId = JsonField.nullableString(item, "payment_id"),
            )
        }
    }

    fun pendingProviderIntents(
        terminalId: String,
        provider: String = "pagbank",
    ): List<PendingProviderIntent> {
        val response = transport.get(
            "/auth/smartpos/payment-intents/pendentes-provider" +
                "?terminal_id=${query(terminalId)}&provider=${query(provider)}"
        )
        requireSuccess(response, "fila de recebimentos")
        return JsonField.objectArray(response.body).map { item ->
            PendingProviderIntent(
                intentId = JsonField.string(item, "intent_id"),
                mesaId = JsonField.int(item, "mesa_id"),
                amountMinor = BigDecimal(JsonField.string(item, "amount"))
                    .movePointRight(2)
                    .longValueExact(),
                method = JsonField.string(item, "method"),
                status = JsonField.string(item, "status"),
                createdAt = JsonField.string(item, "created_at"),
                provider = JsonField.nullableString(item, "provider"),
                terminalId = JsonField.nullableString(item, "terminal_id"),
            )
        }
    }

    private fun requireSuccess(response: HttpResponsePayload, operation: String) {
        if (response.statusCode !in 200..299) {
            error("Falha no $operation: HTTP ${response.statusCode}: ${response.body.take(240)}")
        }
    }

    private fun query(value: String): String = URLEncoder.encode(value, Charsets.UTF_8).replace("+", "%20")

    private fun json(value: String): String = "\"" + value
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
        .replace("\n", "\\n") + "\""
}

object StableOperationKey {
    fun forIntent(intentId: String, terminalId: String, provider: String): String {
        val material = "$provider|$terminalId|$intentId".toByteArray(Charsets.UTF_8)
        val digest = MessageDigest.getInstance("SHA-256").digest(material)
        val hex = digest.joinToString("") { "%02x".format(it) }
        return "smartpos-${hex.take(48)}"
    }
}
