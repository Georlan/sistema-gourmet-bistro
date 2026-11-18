package br.com.koma.smartpos.dev

import br.com.koma.smartpos.bridge.HttpResponsePayload
import br.com.koma.smartpos.bridge.HttpTransport
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.IOException

class WaiterApiTest {
    @Test
    fun filtersCatalogAndPreservesPortionGroups() {
        val json = JSONObject("""
            {
              "cardapio_ativo_id": "main",
              "cardapios_ativos_ids": ["main", "extras"],
              "categorias": [{"id": "food", "nome": "Pratos"}],
              "produtos": [
                {"id": "1", "nome": "Quentinha", "categoria_id": "food", "preco": 18.75,
                 "cardapio_id": "main", "grupos_modificadores": [
                   {"nome":"Proteínas", "min_selecoes":2, "max_selecoes":2, "modo_selecao":"porcoes",
                    "opcoes":[{"id":"frango","nome":"Frango"},
                              {"id":"carne","nome":"Carne","ativo":false}]}
                 ]},
                {"id": "2", "nome": "Ovo", "categoria_id": "food", "cardapio_id":"extras"},
                {"id": "3", "nome": "Salada", "categoria_id": "food", "cardapio_id":"archived"},
                {"id": "4", "nome": "Bolo", "categoria_id": "food", "ativo":false, "cardapio_id":"main"}
              ]
            }
        """.trimIndent())
        val menu = parseMenu(json)
        assertEquals(listOf("1", "2"), menu.products.map(Product::id))
        assertEquals(1875L, menu.products.first().price)
        assertEquals(Group("Proteínas", 2, 2, true, listOf(Option("frango", "Frango", 0))),
            menu.products.first().groups.single())
    }

    @Test
    fun groupsOnlyDeclaredVariantsAndDeduplicatesQuickObservations() {
        val api = WaiterApi(object : HttpTransport {
            override fun post(path: String, body: String) = error("Unexpected post")
            override fun get(path: String) = when (path) {
                "/produtos/catalogo" -> HttpResponsePayload(200, """
                    {"categorias":[{"id":"pastel","nome":"Pastéis"}],"produtos":[
                      {"id":"p1","categoria_id":"pastel","nome":"Pastel médio", "descricao":"Com cebola e orégano",
                       "familia_id":"family","familia_nome":"Pastel","familia_eixo":"Tamanho","variacao_rotulo":"Médio"},
                      {"id":"p2","categoria_id":"pastel","nome":"Pastel grande",
                       "familia_id":"family","familia_nome":"Pastel","familia_eixo":"Tamanho","variacao_rotulo":"Grande"},
                      {"id":"p3","categoria_id":"pastel","nome":"Pastel da casa"}
                    ]}
                """.trimIndent())
                "/produtos/observacoes" -> HttpResponsePayload(200, """
                    [{"categoria_id":"pastel","texto":"Sem cebola"},{"categoria_id":"bebidas","texto":"Sem gelo"}]
                """.trimIndent())
                else -> error("Unexpected path $path")
            }
        })
        val menu = api.menu()
        val choices = menu.choices(menu.categories.single())
        assertEquals(listOf(listOf("p1", "p2"), listOf("p3")), choices.map { it.map(Product::id) })
        assertEquals(listOf("Médio", "Grande"), choices.first().map(Product::variantLabel))
        assertEquals(listOf("Sem cebola", "Sem orégano"), menu.notes(choices.first().first()))
    }

    @Test
    fun keepsPaidAndProductionStatesIndependentAndServesOnlyReadyItems() {
        val api = WaiterApi(object : HttpTransport {
            override fun post(path: String, body: String) = error("Unexpected post")
            override fun get(path: String) = HttpResponsePayload(200, """
                [{"id":"check-1","itens":[
                  {"id":"prep","produto_id":"p2","status":"preparando"},
                  {"id":"ready","produto_id":"p1","status":"pronto","pago":true}
                ]}]
            """.trimIndent())
            override fun put(path: String): HttpResponsePayload {
                assertEquals("/comandas/itens/ready/status?status=entregue", path)
                return HttpResponsePayload(200, """{"id":"ready","status":"entregue"}""")
            }
        })
        val detail = api.detail(Table(3, "Mesa 3"))
        assertEquals(listOf("ready", "prep"), detail.items.map(Consumption::id))
        assertEquals(true, detail.items.first().paid)
        assertEquals("Pronto para servir", detail.items.first().statusLabel)
        api.serve(detail.items.first())
        assertThrows(IllegalArgumentException::class.java) { api.serve(detail.items.last()) }
    }

    @Test
    fun retriesTheSameLaunchAfterLosingTheResponse() {
        val operator = Operator("owner", "Garçom")
        val chicken = Option("frango", "Frango", 0)
        val order = PendingOrder.create(Table(3, "Mesa 3"), null, operator, listOf(
            Line(Product("meal", "food", "Quentinha", 1875, emptyList()), listOf(chicken, chicken), "Sem cebola", 2),
        ))
        var persisted: PendingOrder? = null
        val sent = mutableListOf<Pair<String, String>>()
        val api = WaiterApi(object : HttpTransport {
            override fun post(path: String, body: String): HttpResponsePayload {
                if (path == "/comandas/") {
                    sent.add(path to body)
                    return HttpResponsePayload(201, """{"id":"check-123"}""")
                }
                sent.add(path to body)
                assertEquals(true, persisted?.started)
                if (sent.size == 2) throw IOException("network interruption")
                return HttpResponsePayload(200, """{"id":"launch-123","display_number":"17A"}""")
            }
        })
        assertThrows(IOException::class.java) { api.submit(order, operator.id) { persisted = it } }
        val recovery = PendingOrder.decode(requireNotNull(persisted).encode())
        assertEquals("17A", api.submit(recovery, operator.id) { persisted = it })
        assertEquals(3, sent.size)
        assertEquals("/cardapio/modificadores/lancamentos/check-123", sent[1].first)
        assertEquals(sent[1], sent[2])
        val items = JSONObject(sent[1].second).getJSONArray("itens")
        assertEquals(2, items.length())
        assertEquals("""["frango","frango"]""", items.getJSONObject(0).getJSONArray("modificador_ids").toString())
        assertNull(persisted)
    }

    @Test
    fun releasesAnExplicitCatalogRejectionForEditing() {
        val order = PendingOrder(3, "Mesa 3", "check-123", "{}")
        var persisted: PendingOrder? = null
        val api = WaiterApi(object : HttpTransport {
            override fun post(path: String, body: String) =
                HttpResponsePayload(422, """{"detail":"Cardápio mudou"}""")
        })
        val failure = assertThrows(ApiFailure::class.java) { api.submit(order, "owner") { persisted = it } }
        assertEquals("Cardápio mudou", failure.message)
        assertNull(persisted)
    }
}
