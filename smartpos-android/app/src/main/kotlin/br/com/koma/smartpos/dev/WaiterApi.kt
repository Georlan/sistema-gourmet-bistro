package br.com.koma.smartpos.dev

import br.com.koma.smartpos.bridge.HttpResponsePayload
import br.com.koma.smartpos.bridge.HttpTransport
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.math.BigDecimal
import java.math.RoundingMode
import java.net.URLEncoder
import java.text.NumberFormat
import java.text.Normalizer
import java.util.Locale
import java.util.UUID

internal data class Restaurant(val id: Int, val name: String)
internal data class Operator(val id: String, val name: String)
internal data class Session(
    val restaurant: Restaurant,
    val operator: Operator,
    val enabled: Boolean,
    val open: Boolean,
)
internal data class Table(val id: Int, val name: String)
internal data class Check(val id: String, val tableId: Int, val name: String) {
    val label get() = name.ifBlank { "Consumo geral" }
}
internal data class Salon(val tables: List<Table>, val checks: List<Check>)
internal data class Consumption(
    val id: String,
    val orderNumber: String,
    val name: String,
    val status: String,
    val note: String,
    val paid: Boolean,
) {
    val ready get() = status == "pronto"
    val statusLabel get() = when (status) {
        "cancelado" -> "Cancelado"
        "entregue" -> "Servido"
        "pronto" -> "Pronto para servir"
        "preparando" -> "Em preparo"
        else -> status.replace('_', ' ').replaceFirstChar { it.uppercase() }
    }
}
internal data class TableDetail(val checks: List<Check>, val items: List<Consumption>)
internal data class Category(val id: String, val name: String)
internal data class Option(val id: String, val name: String, val price: Long)
internal data class Group(
    val name: String,
    val min: Int,
    val max: Int,
    val portions: Boolean,
    val options: List<Option>,
)
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
)
internal data class Menu(
    val categories: List<Category>,
    val products: List<Product>,
    val observations: Map<String, List<String>> = emptyMap(),
) {
    fun choices(category: Category): List<List<Product>> = products
        .filter { it.categoryId == category.id }
        .groupBy { product ->
            if (product.familyId.isNotBlank() && product.familyName.isNotBlank()) {
                "family:${product.familyId}"
            } else "product:${product.id}"
        }.values.toList()

    fun notes(product: Product): List<String> {
        val words = " ${normalized("${product.name} ${product.description}")} "
        val ingredients = listOf(
            "cebola", "bacon", "cheddar", "salada", "ovo", "queijo", "tomate",
            "maionese", "molho", "milho", "presunto", "calabresa", "azeitona", "orégano",
        )
        val derived = ingredients.filter { words.contains(" ${normalized(it)} ") }.map { "Sem $it" }
        return (observations[product.categoryId].orEmpty() + derived).distinctBy(::normalized)
    }
}

private fun normalized(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFD)
    .replace(Regex("\\p{M}+"), "").lowercase(Locale.ROOT)
    .replace(Regex("[^a-z0-9]+"), " ").trim()
internal data class Line(
    val product: Product,
    val options: List<Option>,
    val note: String,
    val quantity: Int,
) {
    val unitPrice get() = product.price + options.sumOf { it.price }

    fun item(customer: String?) = JSONObject()
        .put("produto_id", product.id)
        .put("observacao", note)
        .put("cliente_nome", customer ?: "Consumo Geral")
        .put("modificador_ids", JSONArray(options.map { it.id }))
}

internal data class PendingOrder(
    val tableId: Int,
    val tableName: String,
    val checkId: String?,
    val body: String,
    val started: Boolean = false,
) {
    fun encode(): String = JSONObject()
        .put("tableId", tableId)
        .put("tableName", tableName)
        .put("checkId", checkId ?: JSONObject.NULL)
        .put("body", body)
        .put("started", started)
        .toString()

    companion object {
        fun decode(value: String): PendingOrder = JSONObject(value).let {
            PendingOrder(it.getInt("tableId"), it.getString("tableName"), it.string("checkId").ifBlank { null },
                it.getString("body"), it.getBoolean("started"))
        }

        fun create(table: Table, check: Check?, operator: Operator, lines: List<Line>): PendingOrder {
            val items = JSONArray()
            lines.forEach { line -> repeat(line.quantity) { items.put(line.item(check?.name?.takeIf(String::isNotBlank))) } }
            require(items.length() in 1..200)
            val body = JSONObject()
                .put("garcom_id", operator.id)
                .put("origem", "smartpos")
                .put("idempotency_key", "smartpos-waiter-${UUID.randomUUID()}")
                .put("itens", items)
            return PendingOrder(table.id, table.name, check?.id, body.toString())
        }
    }
}

internal class ApiFailure(
    val status: Int,
    message: String,
    val restaurants: List<Restaurant> = emptyList(),
) : Exception(message) {
    val uncertain get() = status in 200..399 || status >= 500 || status == 408
}

internal class WaiterApi(private val transport: HttpTransport) {
    fun authenticate(user: String, password: String, restaurantId: Int? = null): String =
        post("/auth/login", JSONObject()
            .put("username", user.trim())
            .put("password", password)
            .put("restaurante_id", restaurantId))
            .getString("access_token")

    fun session(): Session {
        val context = get("/auth/smartpos/contexto") as JSONObject
        val restaurant = context.getJSONObject("restaurante")
        val operator = context.getJSONObject("operador")
        return Session(
            Restaurant(restaurant.getInt("id"), restaurant.getString("nome")),
            Operator(operator.getString("id"), operator.getString("nome")),
            context.getBoolean("smartpos_enabled"),
            context.getBoolean("turno_aberto"),
        )
    }

    fun salon(): Salon {
        val tables = (get("/mesas/") as JSONArray).objects().map {
            val id = it.getInt("id")
            Table(id, it.string("nome").ifBlank { "Mesa $id" })
        }
        val checks = (get("/comandas/?fechada=false") as JSONArray).objects().mapNotNull {
            val tableId = it.optInt("mesa_id")
            if (tableId > 0) Check(it.getString("id"), tableId, it.string("identificador")) else null
        }
        return Salon(tables, checks)
    }

    fun detail(table: Table): TableDetail {
        val checks = (get("/comandas/detalhes/todos?fechada=false&mesa_id=${table.id}") as JSONArray).objects()
        val items = checks.flatMap { check ->
            check.optJSONArray("itens").objects().map {
                Consumption(
                    it.getString("id"),
                    it.string("lancamento_display_number"),
                    it.optJSONObject("produto")?.string("nome").orEmpty().ifBlank { it.string("produto_id") },
                    it.string("status"),
                    it.string("observacao"),
                    it.optBoolean("pago"),
                )
            }
        }
        return TableDetail(
            checks.map { Check(it.getString("id"), table.id, it.string("identificador")) },
            items.sortedByDescending { it.ready },
        )
    }

    fun serve(item: Consumption) {
        require(item.ready)
        val id = URLEncoder.encode(item.id, Charsets.UTF_8.name()).replace("+", "%20")
        parse(transport.put("/comandas/itens/$id/status?status=entregue"))
    }

    fun menu(): Menu {
        val menu = parseMenu(get("/produtos/catalogo") as JSONObject)
        val presets = try {
            (get("/produtos/observacoes") as JSONArray).objects().filter { it.string("texto").isNotBlank() }
                .groupBy({ it.string("categoria_id") }, { it.getString("texto") })
        } catch (failure: ApiFailure) {
            if (failure.status == 401) throw failure
            emptyMap()
        } catch (_: java.io.IOException) {
            emptyMap()
        }
        return menu.copy(observations = presets)
    }

    fun open(tableId: Int, operatorId: String): String =
        post("/comandas/", JSONObject()
            .put("mesa_id", tableId)
            .put("garcom_id", operatorId)
            .put("tipo", "Consumo no Local"))
            .getString("id")

    fun send(checkId: String, body: String): String {
        val pathId = URLEncoder.encode(checkId, Charsets.UTF_8.name()).replace("+", "%20")
        val result = parse(transport.post("/cardapio/modificadores/lancamentos/$pathId", body)) as JSONObject
        require(result.getString("id").isNotBlank())
        return result.string("display_number")
    }

    fun submit(order: PendingOrder, operatorId: String, persist: (PendingOrder?) -> Unit): String {
        persist(order)
        try {
            val request = if (order.started) order else {
                // A abertura geral é reutilizada pelo servidor. A partir daqui, o
                // mesmo payload e a mesma comanda são obrigatórios em cada retry.
                val target = order.checkId ?: open(order.tableId, operatorId)
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
        } else emptyList()
        val message = when {
            restaurants.isNotEmpty() -> "Escolha o restaurante."
            response.statusCode >= 500 -> "O KÔMA está temporariamente indisponível."
            response.statusCode in 200..299 -> "A resposta do KÔMA está incompleta."
            detail is String && detail.isNotBlank() -> detail
            else -> "Não foi possível concluir a operação (HTTP ${response.statusCode})."
        }
        throw ApiFailure(response.statusCode, message, restaurants)
    }
}

internal fun parseMenu(payload: JSONObject): Menu {
    val active = payload.optJSONArray("cardapios_ativos_ids").strings().filter { it.isNotBlank() }
        .ifEmpty { listOfNotNull(payload.string("cardapio_ativo_id").ifBlank { null }) }
    val products = payload.optJSONArray("produtos").objects()
        .filter { it.optBoolean("ativo", true) && (active.isEmpty() || it.string("cardapio_id") in active) }
        .map { product ->
            Product(product.getString("id"), product.string("categoria_id"), product.getString("nome"),
                product.money("preco"),
                product.optJSONArray("grupos_modificadores").objects().map { group ->
                    Group(group.getString("nome"), group.optInt("min_selecoes").coerceAtLeast(0),
                        group.optInt("max_selecoes", 1).coerceAtLeast(1), group.string("modo_selecao") == "porcoes",
                        group.optJSONArray("opcoes").objects().filter { it.optBoolean("ativo", true) }.map {
                            Option(it.getString("id"), it.getString("nome"), it.money("preco_adicional"))
                        })
                },
                description = product.string("descricao"),
                familyId = product.string("familia_id"),
                familyName = product.string("familia_nome"),
                familyAxis = product.string("familia_eixo"),
                variantLabel = product.string("variacao_rotulo"),
            )
        }
    val categoryIds = products.map { it.categoryId }.toSet()
    val categories = payload.optJSONArray("categorias").objects()
        .map { Category(it.getString("id"), it.getString("nome")) }
        .filter { it.id in categoryIds }
    val missing = categoryIds - categories.map { it.id }.toSet()
    return Menu(categories + missing.map { Category(it, "Outros") }, products)
}

internal fun money(value: Long): String =
    NumberFormat.getCurrencyInstance(Locale("pt", "BR")).format(BigDecimal.valueOf(value, 2))

private fun JSONObject.money(key: String): Long = BigDecimal(string(key).ifBlank { "0" })
    .movePointRight(2).setScale(0, RoundingMode.HALF_UP).longValueExact()

private fun JSONObject.string(key: String) = if (isNull(key)) "" else optString(key)
private fun JSONArray?.objects() = if (this == null) emptyList() else List(length()) { getJSONObject(it) }
private fun JSONArray?.strings() = if (this == null) emptyList() else List(length()) { optString(it, "") }
