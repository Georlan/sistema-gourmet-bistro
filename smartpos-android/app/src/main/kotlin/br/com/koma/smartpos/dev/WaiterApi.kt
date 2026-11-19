package br.com.koma.smartpos.dev

import br.com.koma.smartpos.bridge.HttpResponsePayload
import br.com.koma.smartpos.bridge.HttpTransport
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.IOException
import java.math.BigDecimal
import java.math.RoundingMode
import java.net.URLEncoder
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

internal data class Restaurant(val id: Int, val name: String)

internal data class Operator(val id: String, val name: String)

internal data class WaiterPermissions(
    val showProductionStatus: Boolean = true,
    val canEdit: Boolean = true,
    val canCancel: Boolean = false,
    val canClose: Boolean = true,
    val serviceFeeActive: Boolean = false,
    val serviceFeePercent: Int = 10,
)

internal data class Session(
    val restaurant: Restaurant,
    val operator: Operator,
    val tablesAvailable: Boolean,
    val ordersAvailable: Boolean,
    val role: String = "garcom",
    val shiftOpen: Boolean = true,
    val providerIntegratedAvailable: Boolean = false,
    val terminalMode: String = "registro_externo",
    val permissions: WaiterPermissions = WaiterPermissions(),
    val smartposEnabled: Boolean = true,
) {
    val enabled get() = tablesAvailable
    val open get() = shiftOpen
}

internal data class Table(val id: Int, val name: String)

internal data class Consumption(
    val id: String,
    val launchNumber: String,
    val name: String,
    val status: String,
    val note: String,
    val paid: Boolean,
    val priceCents: Long = 0L,
    val clientName: String = "",
    val modifiers: List<String> = emptyList(),
    val checkId: String = "",
    val productId: String = "",
) {
    val ready get() = status == "pronto"
    val preparing get() = status in PREPARING_STATUSES
    val served get() = status == "entregue"
    val canceled get() = status == "cancelado"

    val statusLabel
        get() = when {
            canceled -> "Cancelado"
            ready -> "Pronto para servir"
            served -> "Servido"
            preparing -> "Em preparo"
            status.isBlank() -> "Enviado"
            else -> status.replace('_', ' ').replaceFirstChar { it.uppercase() }
        }

    val totalLabel get() = if (priceCents > 0L) money(priceCents) else ""

    companion object {
        private val PREPARING_STATUSES = setOf("aguardando", "preparando", "em_preparo", "em_preparacao")
    }
}

internal data class Check(
    val id: String,
    val number: String,
    val label: String,
    val total: Long,
    val paidCents: Long = 0L,
    val statusComanda: String = "aberta",
    val createdAt: String = "",
    val items: List<Consumption> = emptyList(),
) {
    val displayName get() = label.ifBlank { if (number.isNotBlank()) "Pedido #$number" else "Consumo Geral" }
    val awaitingPayment
        get() = statusComanda.equals("aguardando_pagamento", ignoreCase = true) ||
            statusComanda.equals("aguardando pagamento", ignoreCase = true)
    val remainingCents get() = (total - paidCents).coerceAtLeast(0L)
}

internal enum class TableVisualState {
    FREE,
    OCCUPIED,
    READY,
    SERVED,
    PAYMENT,
    MERGED,
}

internal data class TableDetail(
    val table: Table,
    val checks: List<Check>,
    val items: List<Consumption>,
    val total: Long,
    val paidTotal: Long = 0L,
    val mergedOrderLabel: String = "",
    val elapsedMinutes: Int? = null,
) {
    val openCheck get() = checks.firstOrNull()
    val remainingTotal get() = (total - paidTotal).coerceAtLeast(0L)
    val awaitingPayment get() = checks.any { it.awaitingPayment }
    val readyCount get() = items.count { it.ready }
    val preparingCount get() = items.count { it.preparing }
    val servedCount get() = items.count { it.served }

    fun visualState(showProductionStatus: Boolean): TableVisualState = resolveTableVisualState(
        hasChecks = checks.isNotEmpty(),
        mergedOrderLabel = mergedOrderLabel,
        awaitingPayment = awaitingPayment,
        readyCount = readyCount,
        hasActiveItems = items.any { !it.canceled },
        allServedOrCanceled = items.isNotEmpty() && items.all { it.served || it.canceled },
        showProductionStatus = showProductionStatus,
    )
}

internal data class TableSummary(
    val table: Table,
    val checks: List<Check>,
    val items: List<Consumption>,
    val total: Long,
    val paidTotal: Long,
    val openBalance: Long,
    val displayOrderNumber: String,
    val mergedOrderLabel: String = "",
    val elapsedMinutes: Int? = null,
    val rawVisualState: TableVisualState,
) {
    val openCheck get() = checks.firstOrNull()
    val occupied get() = checks.isNotEmpty()
    val readyCount get() = items.count { it.ready }
    val preparingCount get() = items.count { it.preparing }
    val awaitingPayment get() = checks.any { it.awaitingPayment }

    fun visualState(showProductionStatus: Boolean): TableVisualState {
        if (!showProductionStatus && (rawVisualState == TableVisualState.READY || rawVisualState == TableVisualState.SERVED)) {
            return if (occupied) TableVisualState.OCCUPIED else TableVisualState.FREE
        }
        return rawVisualState
    }

    fun badgeLabel(showProductionStatus: Boolean): String = when (visualState(showProductionStatus)) {
        TableVisualState.MERGED -> "Junta"
        TableVisualState.PAYMENT -> "Pagando"
        TableVisualState.FREE -> "Livre"
        TableVisualState.READY -> if (readyCount > 1) "$readyCount prontos" else "Pronto"
        TableVisualState.SERVED -> "Servido"
        TableVisualState.OCCUPIED -> "Ocupada"
    }

    fun subtitleLabel(showProductionStatus: Boolean): String {
        if (!occupied) return "Toque em Lançar ou abra a mesa"
        val parts = mutableListOf<String>()
        if (displayOrderNumber.isNotBlank()) parts.add("Ped. #$displayOrderNumber")
        if (elapsedMinutes != null && elapsedMinutes >= 0) {
            parts.add(formatElapsed(elapsedMinutes))
        }
        if (showProductionStatus && readyCount > 0) {
            parts.add(if (readyCount == 1) "1 pronto" else "$readyCount prontos")
        } else if (showProductionStatus && preparingCount > 0) {
            parts.add("$preparingCount em preparo")
        } else if (checks.size > 1) {
            parts.add("${checks.size} comandas")
        }
        return parts.joinToString(" · ").ifBlank { "Consumo aberto" }
    }
}

internal enum class SalonFilter(val label: String) {
    ALL("Todas"),
    FREE("Livres"),
    OCCUPIED("Ocupadas"),
    READY("Prontas"),
}

internal data class Category(val id: String, val name: String)

internal data class Option(val id: String, val name: String, val price: Long)

internal data class Group(
    val name: String,
    val min: Int,
    val max: Int,
    val repeatable: Boolean,
    val options: List<Option>,
) {
    val isSingleChoice get() = !repeatable && max == 1
    val isRequired get() = min > 0

    fun selectedCount(selected: List<Option>): Int {
        val allowedIds = options.mapTo(HashSet()) { it.id }
        return selected.count { it.id in allowedIds }
    }

    fun optionCount(selected: List<Option>, option: Option): Int =
        selected.count { it.id == option.id }

    fun canAdd(selected: List<Option>, option: Option): Boolean {
        if (selectedCount(selected) >= max) return false
        if (!repeatable && optionCount(selected, option) >= 1) return false
        return true
    }

    fun isSatisfied(selected: List<Option>): Boolean = selectedCount(selected) in min..max

    fun ruleLabel(): String = when {
        min > 0 && min == max && repeatable -> "Obrigatório · escolha $min porções"
        min > 0 && min == max && max == 1 -> "Obrigatório · escolha 1"
        min > 0 && min == max -> "Obrigatório · escolha $min"
        min > 0 -> "Obrigatório · de $min a $max"
        repeatable -> "Opcional · até $max porções"
        max == 1 -> "Opcional · até 1"
        else -> "Opcional · até $max"
    }
}

internal data class Product(
    val id: String,
    val categoryId: String,
    val name: String,
    val price: Long,
    val groups: List<Group>,
    val description: String = "",
    val familyId: String = "",
    val familyName: String = "",
    val familyAxis: String = "",
    val variantLabel: String = "",
    val available: Boolean = true,
) {
    val requiresConfiguration get() = groups.any { it.min > 0 }
    val hasOptionalCustomization get() = groups.isNotEmpty()
}

internal data class Menu(
    val categories: List<Category>,
    val products: List<Product>,
    val observations: Map<String, List<String>> = emptyMap(),
) {
    fun choices(category: Category): List<List<Product>> {
        val items = products.filter { it.categoryId == category.id }
        val groups = linkedMapOf<String, MutableList<Product>>()
        items.forEachIndexed { index, product ->
            val key = if (product.familyId.isNotBlank()) "f:${product.familyId}" else "s:$index"
            groups.getOrPut(key) { mutableListOf() }.add(product)
        }
        return groups.values.toList()
    }

    fun notes(product: Product): List<String> {
        val result = mutableListOf<String>()
        val seen = mutableSetOf<String>()
        fun addNote(raw: String) {
            val clean = raw.trim()
            if (clean.isNotBlank() && seen.add(clean.lowercase())) result.add(clean)
        }
        observations[product.categoryId].orEmpty().forEach(::addNote)
        val catName = categories.firstOrNull { it.id == product.categoryId }?.name.orEmpty().lowercase()
        val catId = product.categoryId.lowercase()
        if (BEVERAGE_HINTS.any { it in catName || it in catId }) {
            BEVERAGE_NOTES.forEach(::addNote)
        }
        ingredientsFrom(product.description).forEach { addNote("Sem $it") }
        return result
    }

    fun serviceNotes(): List<String> = listOf("VIAGEM", "PRA MESA")

    companion object {
        private val BEVERAGE_HINTS = listOf("bebida", "suco", "refri", "drink", "cerveja")
        private val BEVERAGE_NOTES = listOf("Sem gelo", "Com gelo e limão", "Bem gelado")
    }
}

internal data class Line(
    val product: Product,
    val options: List<Option>,
    val note: String,
    val quantity: Int,
    val clientName: String = "",
) {
    val unitPrice get() = product.price + options.sumOf { it.price }
    val total get() = unitPrice * quantity

    fun item(customer: String?) = JSONObject()
        .put("produto_id", product.id)
        .put("observacao", note)
        .put("cliente_nome", clientName.ifBlank { customer ?: "Consumo Geral" })
        .put("modificador_ids", JSONArray(options.map { it.id }))
}

internal data class PendingOrder(
    val tableId: Int,
    val tableName: String,
    val checkId: String?,
    val body: String,
    val started: Boolean = false,
    val checkIdentifier: String? = null,
) {
    fun encode(): String = JSONObject()
        .put("tableId", tableId)
        .put("tableName", tableName)
        .put("checkId", checkId ?: JSONObject.NULL)
        .put("body", body)
        .put("started", started)
        .put("checkIdentifier", checkIdentifier ?: JSONObject.NULL)
        .toString()

    companion object {
        fun decode(value: String): PendingOrder = JSONObject(value).let {
            PendingOrder(
                tableId = it.getInt("tableId"),
                tableName = it.getString("tableName"),
                checkId = it.string("checkId").ifBlank { null },
                body = it.getString("body"),
                started = it.getBoolean("started"),
                checkIdentifier = it.string("checkIdentifier").ifBlank { null },
            )
        }

        fun create(
            table: Table,
            check: Check?,
            operator: Operator,
            lines: List<Line>,
            checkIdentifier: String? = null,
        ): PendingOrder {
            val items = JSONArray()
            lines.forEach { line ->
                repeat(line.quantity) {
                    items.put(line.item(check?.label?.takeIf(String::isNotBlank) ?: checkIdentifier))
                }
            }
            require(items.length() in 1..200)
            val body = JSONObject()
                .put("garcom_id", operator.id)
                .put("origem", "smartpos")
                .put("idempotency_key", "smartpos-waiter-${UUID.randomUUID()}")
                .put("itens", items)
            return PendingOrder(
                tableId = table.id,
                tableName = table.name,
                checkId = check?.id,
                body = body.toString(),
                started = false,
                checkIdentifier = checkIdentifier?.trim()?.ifBlank { null },
            )
        }
    }
}

internal data class PaymentIntentPreview(
    val id: String,
    val tableId: Int,
    val amountCents: Long,
    val method: String,
    val capture: String,
    val scope: String,
    val status: String,
    val expiresAt: String,
)

internal data class ManualPaymentOutcome(
    val intentId: String,
    val status: String,
    val paymentId: String?,
    val settled: Boolean,
    val paidCents: Long,
    val receivedCents: Long,
    val trocoCents: Long,
    val tableReleased: Boolean,
)

internal data class RecentOperation(
    val intentId: String,
    val tableId: Int,
    val tableName: String,
    val operatorName: String,
    val amountCents: Long,
    val method: String,
    val capture: String,
    val status: String,
    val createdAt: String,
    val providerReference: String?,
    val providerLastError: String?,
    val paymentId: String?,
)

internal class ApiFailure(
    val status: Int,
    message: String,
    val restaurants: List<Restaurant> = emptyList(),
) : Exception(message) {
    val uncertain get() = status in 200..399 || status >= 500 || status == 408
    val requiresReauth get() = status == 401
}

internal class WaiterApi(
    private val transport: HttpTransport,
    private val nowMsProvider: () -> Long = System::currentTimeMillis,
) {
    fun authenticate(user: String, password: String, restaurantId: Int? = null): String {
        val payload = JSONObject()
            .put("username", user.trim())
            .put("password", password)
        if (restaurantId != null) {
            payload.put("restaurante_id", restaurantId)
        } else {
            payload.put("restaurante_id", JSONObject.NULL)
        }
        return post("/auth/login", payload).getString("access_token")
    }

    fun session(): Session {
        val context = get("/auth/smartpos/contexto") as JSONObject
        val restaurant = context.getJSONObject("restaurante")
        val operator = context.getJSONObject("operador")
        val permissions = fetchPermissionsBestEffort()
        val smartposEnabled = context.optBoolean("smartpos_enabled", true)
        return Session(
            restaurant = Restaurant(restaurant.getInt("id"), restaurant.getString("nome")),
            operator = Operator(operator.getString("id"), operator.getString("nome")),
            tablesAvailable = context.optBoolean("mesas_disponiveis", smartposEnabled),
            ordersAvailable = context.optBoolean("pedidos_disponiveis", smartposEnabled),
            role = operator.string("role").ifBlank { "garcom" },
            shiftOpen = context.optBoolean("turno_aberto", false),
            providerIntegratedAvailable = context.optBoolean("provider_integrado_disponivel", false),
            terminalMode = context.string("terminal_mode").ifBlank { "registro_externo" },
            permissions = permissions,
            smartposEnabled = smartposEnabled,
        )
    }

    fun permissions(): WaiterPermissions = fetchPermissionsBestEffort()

    fun tables(): List<Table> =
        (get("/mesas/") as JSONArray).objects().map {
            val id = it.getInt("id")
            Table(id, it.string("nome").ifBlank { "Mesa $id" })
        }.sortedBy { it.id }

    fun salon(): List<TableSummary> {
        val tableList = tables()
        val allChecksPayload = (get("/comandas/detalhes/todos?fechada=false") as JSONArray).objects()
        val nowMs = nowMsProvider()
        val checksByTable = mutableMapOf<Int, MutableList<JSONObject>>()
        allChecksPayload.forEach { raw ->
            val mesaId = raw.optInt("mesa_id")
            if (mesaId > 0) {
                checksByTable.getOrPut(mesaId) { mutableListOf() }.add(raw)
            }
        }
        return tableList.map { table ->
            val rawChecks = checksByTable[table.id].orEmpty()
            val (checks, items) = parseChecksAndItems(rawChecks)
            val total = checks.sumOf { it.total }
            val paid = checks.sumOf { it.paidCents }
            val openBalance = (total - paid).coerceAtLeast(0L)
            val displayOrderNumber = resolveOrderNumber(checks, items)
            val distinctOrderNumbers = checks.mapNotNull { it.number.takeIf(String::isNotBlank) }.distinct()
            val hasForeignOrigin = rawChecks.any { raw ->
                val originId = raw.optInt("mesa_origem_id")
                originId > 0 && originId != table.id
            }
            val mergedOrderLabel = when {
                distinctOrderNumbers.size > 1 -> "Pedidos ${distinctOrderNumbers.joinToString(" + ")}"
                hasForeignOrigin -> "Mesas combinadas"
                else -> ""
            }
            val elapsed = resolveElapsedMinutes(rawChecks, nowMs)
            val visual = resolveTableVisualState(
                hasChecks = checks.isNotEmpty(),
                mergedOrderLabel = mergedOrderLabel,
                awaitingPayment = checks.any { it.awaitingPayment },
                readyCount = items.count { it.ready },
                hasActiveItems = items.any { !it.canceled },
                allServedOrCanceled = items.isNotEmpty() && items.all { it.served || it.canceled },
                showProductionStatus = true,
            )
            TableSummary(
                table = table,
                checks = checks,
                items = items,
                total = total,
                paidTotal = paid,
                openBalance = openBalance,
                displayOrderNumber = displayOrderNumber,
                mergedOrderLabel = mergedOrderLabel,
                elapsedMinutes = elapsed,
                rawVisualState = visual,
            )
        }
    }

    fun detail(table: Table): TableDetail {
        val rawChecks = (get("/comandas/detalhes/todos?fechada=false&mesa_id=${table.id}") as JSONArray).objects()
        val (checks, items) = parseChecksAndItems(rawChecks)
        val mergedLabel = fetchMergedOrderLabelBestEffort(table.id)
        val total = checks.sumOf { it.total }
        val paid = checks.sumOf { it.paidCents }
        val elapsed = resolveElapsedMinutes(rawChecks, nowMsProvider())
        return TableDetail(
            table = table,
            checks = checks,
            items = items,
            total = total,
            paidTotal = paid,
            mergedOrderLabel = mergedLabel,
            elapsedMinutes = elapsed,
        )
    }

    fun serve(item: Consumption) {
        require(item.ready)
        val id = encodePath(item.id)
        parse(transport.put("/comandas/itens/$id/status?status=entregue"))
    }

    fun serveAll(items: List<Consumption>): Int {
        var count = 0
        items.filter { it.ready }.forEach {
            serve(it)
            count += 1
        }
        return count
    }

    fun requestBill(checkId: String) {
        val id = encodePath(checkId)
        parse(transport.put("/comandas/$id/pedir-conta"))
    }

    fun menu(): Menu {
        val menu = parseMenu(get("/produtos/catalogo") as JSONObject)
        val presets = try {
            (get("/produtos/observacoes") as JSONArray).objects()
                .filter { it.string("texto").isNotBlank() }
                .groupBy({ it.string("categoria_id") }, { it.getString("texto") })
        } catch (failure: ApiFailure) {
            if (failure.status == 401) throw failure
            emptyMap()
        } catch (_: IOException) {
            emptyMap()
        }
        return menu.copy(observations = presets)
    }

    fun open(tableId: Int, operatorId: String, identifier: String? = null): String {
        require(idempotencyKey.trim().length in 8..128)
        val body = JSONObject()
            .put("idempotency_key", idempotencyKey)
            .put("mesa_id", tableId)
            .put("garcom_id", operatorId)
            .put("tipo", "Consumo no Local")
        val cleanIdentifier = identifier?.trim()?.ifBlank { null }
        if (cleanIdentifier != null) {
            body.put("identificador", cleanIdentifier)
        }
        return post("/comandas/", body).getString("id")
    }

    fun send(checkId: String, body: String): String {
        val pathId = encodePath(checkId)
        val result = parse(transport.post("/cardapio/modificadores/lancamentos/$pathId", body)) as JSONObject
        require(result.getString("id").isNotBlank())
        return result.string("display_number")
    }

    fun submit(order: PendingOrder, operatorId: String, persist: (PendingOrder?) -> Unit): String {
        persist(order)
        try {
            val request = if (order.started) {
                order
            } else {
                // A abertura geral é reutilizada pelo servidor. A partir daqui, o
                // mesmo payload e a mesma comanda são obrigatórios em cada retry.
                val target = order.checkId ?: open(order.tableId, operatorId, order.checkIdentifier)
                order.copy(checkId = target, started = true).also(persist)
            }
            val number = send(requireNotNull(request.checkId), request.body)
            persist(null)
            return number
        } catch (failure: ApiFailure) {
            if (!order.started && !failure.uncertain && failure.status != 401) persist(null)
            throw failure
        }
    }

    fun createPaymentIntent(
        tableId: Int,
        amountCents: Long,
        method: String,
        capture: String?,
        scope: String,
        itemIds: List<String> = emptyList(),
        idempotencyKey: String = "smartpos-create-${UUID.randomUUID()}",
    ): PaymentIntentPreview {
        require(idempotencyKey.trim().length in 8..128)
        val body = JSONObject()
            .put("idempotency_key", idempotencyKey)
            .put("mesa_id", tableId)
            .put("valor", BigDecimal.valueOf(amountCents, 2).toPlainString())
            .put("metodo", method)
            .put("escopo", scope)
        if (capture != null) {
            body.put("captura", capture)
        } else {
            body.put("captura", JSONObject.NULL)
        }
        if (itemIds.isNotEmpty()) {
            body.put("item_ids", JSONArray(itemIds))
        }
        val res = post("/auth/smartpos/payment-intents", body)
        return PaymentIntentPreview(
            id = res.getString("id"),
            tableId = res.optInt("mesa_id", tableId),
            amountCents = res.optMoney("valor").takeIf { it > 0L } ?: amountCents,
            method = res.string("metodo").ifBlank { method },
            capture = res.string("captura").ifBlank { capture ?: "dinheiro_pendente" },
            scope = res.string("escopo").ifBlank { scope },
            status = res.string("status").ifBlank { "pendente" },
            expiresAt = res.string("expira_em"),
        )
    }

    fun confirmManualPayment(
        intentId: String,
        receivedCents: Long?,
        idempotencyKey: String = "smartpos-manual-${UUID.randomUUID()}",
    ): ManualPaymentOutcome {
        val body = JSONObject().put("idempotency_key", idempotencyKey)
        if (receivedCents != null) {
            body.put("valor_recebido", BigDecimal.valueOf(receivedCents, 2).toPlainString())
        }
        val res = post("/auth/smartpos/payment-intents/${encodePath(intentId)}/confirmar-manual", body)
        return ManualPaymentOutcome(
            intentId = res.string("intent_id").ifBlank { res.string("id").ifBlank { intentId } },
            status = res.string("status"),
            paymentId = res.string("payment_id").ifBlank { null },
            settled = res.optBoolean("settled", true),
            paidCents = res.optMoney("valor_pago"),
            receivedCents = res.optMoney("valor_recebido"),
            trocoCents = res.optMoney("troco"),
            tableReleased = res.optBoolean("mesa_liberada", false),
        )
    }

    fun cancelPaymentIntent(
        intentId: String,
        reason: String,
        idempotencyKey: String = "smartpos-cancel-${UUID.randomUUID()}",
    ): String {
        val body = JSONObject()
            .put("idempotency_key", idempotencyKey)
            .put("motivo", reason.trim().ifBlank { "Cancelado no SmartPOS" })
        val res = post("/auth/smartpos/payment-intents/${encodePath(intentId)}/cancelar", body)
        return res.string("status").ifBlank { "cancelada" }
    }

    fun recentOperations(limit: Int = 5): List<RecentOperation> {
        val bounded = limit.coerceIn(1, 20)
        return (get("/auth/smartpos/payment-intents/recentes?limit=$bounded") as JSONArray).objects().map { item ->
            RecentOperation(
                intentId = item.string("intent_id"),
                tableId = item.optInt("mesa_id"),
                tableName = item.string("mesa_nome").ifBlank { "Mesa ${item.optInt("mesa_id")}" },
                operatorName = item.string("operador_nome"),
                amountCents = item.optMoney("amount"),
                method = item.string("method"),
                capture = item.string("capture"),
                status = item.string("status"),
                createdAt = item.string("created_at"),
                providerReference = item.string("provider_reference").ifBlank { null },
                providerLastError = item.string("provider_last_error").ifBlank { null },
                paymentId = item.string("payment_id").ifBlank { null },
            )
        }
    }

    private fun fetchPermissionsBestEffort(): WaiterPermissions = try {
        val cfg = get("/caixa/configuracoes") as JSONObject
        WaiterPermissions(
            showProductionStatus = cfg.optBoolean("perm_garcom_status", true),
            canEdit = cfg.optBoolean("perm_garcom_editar", true),
            canCancel = cfg.optBoolean("perm_garcom_cancelar", false),
            canClose = cfg.optBoolean("perm_garcom_fechar", true),
            serviceFeeActive = cfg.optBoolean("taxa_servico_ativa", false),
            serviceFeePercent = cfg.optInt("taxa_servico_padrao", 10),
        )
    } catch (failure: ApiFailure) {
        if (failure.status == 401) throw failure
        WaiterPermissions()
    } catch (_: IOException) {
        WaiterPermissions()
    }

    private fun fetchMergedOrderLabelBestEffort(tableId: Int): String = try {
        val payload = get("/atendimentos/mesas/$tableId") as? JSONObject ?: return ""
        val families = payload.optJSONArray("familias").objects()
        if (families.size <= 1) return ""
        val numbers = families.mapNotNull { fam ->
            val num = fam.string("numero_conta")
            num.takeIf { it.isNotBlank() }
        }.distinct()
        if (numbers.size > 1) "Pedidos ${numbers.joinToString(" + ")}" else ""
    } catch (failure: ApiFailure) {
        if (failure.status == 401) throw failure
        ""
    } catch (_: Exception) {
        ""
    }

    private fun parseChecksAndItems(rawChecks: List<JSONObject>): Pair<List<Check>, List<Consumption>> {
        val checks = mutableListOf<Check>()
        val allItems = mutableListOf<Consumption>()

        rawChecks.forEach { checkJson ->
            val checkId = checkJson.string("id")
            val orderNum = checkJson.string("numero_pedido").let { if (it == "0") "" else it }
            val identifier = checkJson.string("identificador")
            val statusComanda = checkJson.string("status_comanda").ifBlank { "aberta" }
            val createdAt = checkJson.string("criado_em")

            val checkItems = checkJson.optJSONArray("itens").objects().map { itemJson ->
                val rawStatus = itemJson.string("status").lowercase()
                val modNames = itemJson.optJSONArray("modificadores").objects().mapNotNull { mod ->
                    mod.string("nome").takeIf { it.isNotBlank() }
                }
                val unitPrice = itemJson.optMoney("preco_unit").let { parsed ->
                    if (parsed > 0L) parsed else (itemJson.optJSONObject("produto")?.optMoney("preco") ?: 0L)
                }
                Consumption(
                    id = itemJson.string("id"),
                    launchNumber = itemJson.string("lancamento_display_number"),
                    name = itemJson.optJSONObject("produto")?.string("nome").orEmpty()
                        .ifBlank { itemJson.string("produto_id") },
                    status = rawStatus,
                    note = itemJson.string("observacao"),
                    paid = itemJson.optBoolean("pago", false),
                    priceCents = unitPrice,
                    clientName = itemJson.string("cliente_nome"),
                    modifiers = modNames,
                    checkId = checkId,
                    productId = itemJson.string("produto_id"),
                )
            }

            val itemsTotal = checkItems.filterNot { it.canceled }.sumOf { it.priceCents }
            val discounts = checkJson.optMoney("valor_desconto_cupom") + checkJson.optMoney("valor_desconto_cashback")
            val checkTotal = (itemsTotal - discounts).coerceAtLeast(0L)
            val paidCents = checkJson.optMoney("valor_pago")

            checks.add(
                Check(
                    id = checkId,
                    number = orderNum,
                    label = identifier,
                    total = checkTotal,
                    paidCents = paidCents,
                    statusComanda = statusComanda,
                    createdAt = createdAt,
                    items = checkItems,
                ),
            )
            allItems.addAll(checkItems)
        }

        val sortedItems = allItems
            .filterNot { it.canceled }
            .sortedWith(
                compareBy<Consumption> { !it.ready }
                    .thenBy { !it.preparing }
                    .thenBy { it.paid },
            )
        return checks to sortedItems
    }

    private fun resolveOrderNumber(checks: List<Check>, items: List<Consumption>): String {
        val checkNumbers = checks.mapNotNull { it.number.takeIf(String::isNotBlank) }.distinct()
        if (checkNumbers.isNotEmpty()) return checkNumbers.joinToString(", ")
        val launchNumbers = items.mapNotNull { it.launchNumber.takeIf(String::isNotBlank) }.distinct()
        return launchNumbers.firstOrNull().orEmpty()
    }

    private fun resolveElapsedMinutes(rawChecks: List<JSONObject>, nowMs: Long): Int? {
        val timestamps = rawChecks.mapNotNull { parseIsoTimestampMs(it.string("criado_em")) }
        val earliest = timestamps.minOrNull() ?: return null
        val diffMin = ((nowMs - earliest) / 60_000L).toInt()
        return diffMin.coerceAtLeast(0)
    }

    private fun encodePath(value: String): String =
        URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")

    private fun get(path: String): Any = parse(transport.get(path))

    private fun post(path: String, payload: JSONObject): JSONObject =
        parse(transport.post(path, payload.toString())) as JSONObject

    private fun parse(response: HttpResponsePayload): Any {
        val data = runCatching { JSONTokener(response.body).nextValue() }.getOrNull()
        if (response.statusCode in 200..299 && data != null) return data
        val detail = (data as? JSONObject)?.opt("detail")
        val restaurants = if (detail is JSONObject && detail.string("code") == "restaurant_selection_required") {
            detail.optJSONArray("restaurantes").objects().map {
                Restaurant(it.getInt("id"), it.getString("nome"))
            }
        } else {
            emptyList()
        }
        val message = when {
            restaurants.isNotEmpty() -> "Escolha o restaurante."
            response.statusCode == 401 -> "Sessão expirada ou revogada. Confirme sua senha."
            response.statusCode == 429 -> "Muitas tentativas. Aguarde alguns instantes."
            response.statusCode >= 500 -> "O KÔMA está temporariamente indisponível."
            response.statusCode in 200..299 -> "A resposta do KÔMA está incompleta."
            detail is String && detail.isNotBlank() -> detail
            detail is JSONObject && detail.string("message").isNotBlank() -> detail.string("message")
            else -> "Não foi possível concluir a operação (HTTP ${response.statusCode})."
        }
        throw ApiFailure(response.statusCode, message, restaurants)
    }
}

internal fun resolveTableVisualState(
    hasChecks: Boolean,
    mergedOrderLabel: String,
    awaitingPayment: Boolean,
    readyCount: Int,
    hasActiveItems: Boolean,
    allServedOrCanceled: Boolean,
    showProductionStatus: Boolean,
): TableVisualState {
    if (!hasChecks) return TableVisualState.FREE
    if (mergedOrderLabel.isNotBlank()) return TableVisualState.MERGED
    if (awaitingPayment) return TableVisualState.PAYMENT
    if (showProductionStatus && readyCount > 0) return TableVisualState.READY
    if (showProductionStatus && hasActiveItems && allServedOrCanceled) return TableVisualState.SERVED
    return TableVisualState.OCCUPIED
}

internal fun parseMenu(payload: JSONObject): Menu {
    val active = payload.optJSONArray("cardapios_ativos_ids").strings().filter { it.isNotBlank() }
        .ifEmpty { listOfNotNull(payload.string("cardapio_ativo_id").ifBlank { null }) }
    val products = payload.optJSONArray("produtos").objects()
        .filter { it.optBoolean("ativo", true) && (active.isEmpty() || it.string("cardapio_id") in active) }
        .map { product ->
            Product(
                id = product.getString("id"),
                categoryId = product.string("categoria_id"),
                name = product.getString("nome"),
                price = product.money("preco"),
                groups = product.optJSONArray("grupos_modificadores").objects().map { group ->
                    Group(
                        name = group.getString("nome"),
                        min = group.optInt("min_selecoes").coerceAtLeast(0),
                        max = group.optInt("max_selecoes", 1).coerceAtLeast(1),
                        repeatable = group.string("modo_selecao") == "porcoes",
                        options = group.optJSONArray("opcoes").objects()
                            .filter { it.optBoolean("ativo", true) }
                            .map { Option(it.getString("id"), it.getString("nome"), it.money("preco_adicional")) },
                    )
                },
                description = product.string("descricao"),
                familyId = product.string("familia_id"),
                familyName = product.string("familia_nome"),
                familyAxis = product.string("familia_eixo"),
                variantLabel = product.string("variacao_rotulo"),
                available = product.optBoolean("disponivel", true),
            )
        }
    val categoryIds = products.map { it.categoryId }.toSet()
    val categories = payload.optJSONArray("categorias").objects()
        .map { Category(it.getString("id"), it.getString("nome")) }
        .filter { it.id in categoryIds }
    val missing = categoryIds - categories.map { it.id }.toSet()
    return Menu(categories + missing.map { Category(it, "Outros") }, products)
}

internal fun ingredientsFrom(description: String): List<String> {
    val clean = description.trim().removePrefix("Com ").removePrefix("com ")
        .removePrefix("Acompanha ").removePrefix("acompanha ")
    if (clean.isBlank()) return emptyList()
    return clean.split(",", " e ").map { it.trim().trimEnd('.') }
        .filter { it.length in 2..28 }
}

internal fun money(value: Long): String =
    NumberFormat.getCurrencyInstance(Locale("pt", "BR")).format(BigDecimal.valueOf(value, 2))

internal fun formatElapsed(minutes: Int): String = when {
    minutes < 1 -> "agora"
    minutes < 60 -> "há ${minutes} min"
    else -> "há ${minutes / 60}h${String.format(Locale.US, "%02d", minutes % 60)}"
}

internal fun parseIsoTimestampMs(raw: String): Long? {
    val trimmed = raw.trim()
    if (trimmed.length < 19) return null
    val base = trimmed.substring(0, 19)
    val rest = trimmed.substring(19)
    val tz = when {
        rest.endsWith("Z") -> TimeZone.getTimeZone("UTC")
        else -> {
            val match = Regex("[+-]\\d{2}:?\\d{2}$").find(rest)
            if (match != null) {
                val offset = match.value.let { if (it.contains(":")) it else "${it.substring(0, 3)}:${it.substring(3)}" }
                TimeZone.getTimeZone("GMT$offset")
            } else {
                TimeZone.getTimeZone("UTC")
            }
        }
    }
    return runCatching {
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply {
            timeZone = tz
        }.parse(base)?.time
    }.getOrNull()
}

private fun JSONObject.money(key: String): Long =
    BigDecimal(string(key).ifBlank { "0" }).movePointRight(2).setScale(0, RoundingMode.HALF_UP).longValueExact()

private fun JSONObject.optMoney(key: String): Long =
    runCatching { money(key) }.getOrDefault(0L)

private fun JSONObject.string(key: String) = if (isNull(key)) "" else optString(key)
private fun JSONArray?.objects() = if (this == null) emptyList() else List(length()) { getJSONObject(it) }
private fun JSONArray?.strings() = if (this == null) emptyList() else List(length()) { optString(it, "") }
