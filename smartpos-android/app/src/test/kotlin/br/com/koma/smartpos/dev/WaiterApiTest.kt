package br.com.koma.smartpos.dev

import br.com.koma.smartpos.bridge.HttpResponsePayload
import br.com.koma.smartpos.bridge.HttpTransport
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.IOException

class WaiterApiTest {
    @get:Rule
    val tempFolder = TemporaryFolder()

    @Test
    fun filtersCatalogAndPreservesPortionGroups() {
        val json = JSONObject(
            """
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
            """.trimIndent(),
        )
        val menu = parseMenu(json)
        assertEquals(listOf("1", "2"), menu.products.map(Product::id))
        assertEquals(1875L, menu.products.first().price)
        assertEquals(
            Group("Proteínas", 2, 2, true, listOf(Option("frango", "Frango", 0))),
            menu.products.first().groups.single(),
        )
    }

    @Test
    fun groupsOnlyDeclaredVariantsAndDeduplicatesQuickObservations() {
        val api = WaiterApi(
            object : HttpTransport {
                override fun post(path: String, body: String) = error("Unexpected post")
                override fun get(path: String) = when (path) {
                    "/produtos/catalogo" -> HttpResponsePayload(
                        200,
                        """
                        {"categorias":[{"id":"pastel","nome":"Pastéis"}],"produtos":[
                          {"id":"p1","categoria_id":"pastel","nome":"Pastel médio", "descricao":"Com cebola e orégano",
                           "familia_id":"family","familia_nome":"Pastel","familia_eixo":"Tamanho","variacao_rotulo":"Médio"},
                          {"id":"p2","categoria_id":"pastel","nome":"Pastel grande",
                           "familia_id":"family","familia_nome":"Pastel","familia_eixo":"Tamanho","variacao_rotulo":"Grande"},
                          {"id":"p3","categoria_id":"pastel","nome":"Pastel da casa"}
                        ]}
                        """.trimIndent(),
                    )
                    "/produtos/observacoes" -> HttpResponsePayload(
                        200,
                        """
                        [{"categoria_id":"pastel","texto":"Sem cebola"},{"categoria_id":"bebidas","texto":"Sem gelo"}]
                        """.trimIndent(),
                    )
                    else -> error("Unexpected path $path")
                }
            },
        )
        val menu = api.menu()
        val choices = menu.choices(menu.categories.single())
        assertEquals(listOf(listOf("p1", "p2"), listOf("p3")), choices.map { it.map(Product::id) })
        assertEquals(listOf("Médio", "Grande"), choices.first().map(Product::variantLabel))
        assertEquals(listOf("Sem cebola", "Sem orégano"), menu.notes(choices.first().first()))
    }

    @Test
    fun keepsPaidAndProductionStatesIndependentAndServesOnlyReadyItems() {
        val api = WaiterApi(
            object : HttpTransport {
                override fun post(path: String, body: String) = error("Unexpected post")
                override fun get(path: String) = when {
                    path.startsWith("/comandas/detalhes/todos") -> HttpResponsePayload(
                        200,
                        """
                        [{"id":"check-1","itens":[
                          {"id":"prep","produto_id":"p2","status":"preparando"},
                          {"id":"ready","produto_id":"p1","status":"pronto","pago":true}
                        ]}]
                        """.trimIndent(),
                    )
                    path.startsWith("/atendimentos/mesas/") -> HttpResponsePayload(404, """{"detail":"sem atendimento"}""")
                    else -> error("Unexpected get $path")
                }

                override fun put(path: String): HttpResponsePayload {
                    assertEquals("/comandas/itens/ready/status?status=entregue", path)
                    return HttpResponsePayload(200, """{"id":"ready","status":"entregue"}""")
                }
            },
        )
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
        val order = PendingOrder.create(
            Table(3, "Mesa 3"),
            null,
            operator,
            listOf(
                Line(Product("meal", "food", "Quentinha", 1875, emptyList()), listOf(chicken, chicken), "Sem cebola", 2),
            ),
        )
        var persisted: PendingOrder? = null
        val sent = mutableListOf<Pair<String, String>>()
        val api = WaiterApi(
            object : HttpTransport {
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
            },
        )
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
        val api = WaiterApi(
            object : HttpTransport {
                override fun post(path: String, body: String) =
                    HttpResponsePayload(422, """{"detail":"Cardápio mudou"}""")
            },
        )
        val failure = assertThrows(ApiFailure::class.java) { api.submit(order, "owner") { persisted = it } }
        assertEquals("Cardápio mudou", failure.message)
        assertNull(persisted)
    }

    @Test
    fun projectsSalonStatesBalancesMergedAndHidesProductionWhenPermDisablesIt() {
        val fixedNow = requireNotNull(parseIsoTimestampMs("2026-11-18T12:30:00Z"))
        val api = WaiterApi(
            transport = object : HttpTransport {
                override fun post(path: String, body: String) = error("Unexpected post")
                override fun get(path: String) = when (path) {
                    "/mesas/" -> HttpResponsePayload(
                        200,
                        """
                        [
                          {"id": 1, "nome": "Mesa 01"},
                          {"id": 2, "nome": "Mesa 02"},
                          {"id": 3, "nome": "Mesa 03"},
                          {"id": 4, "nome": "Mesa 04"}
                        ]
                        """.trimIndent(),
                    )
                    "/comandas/detalhes/todos?fechada=false" -> HttpResponsePayload(
                        200,
                        """
                        [
                          {
                            "id": "c-1", "mesa_id": 1, "numero_pedido": 12, "valor_pago": 10.00,
                            "status_comanda": "aberta", "criado_em": "2026-11-18T12:15:00Z",
                            "itens": [
                              {"id": "i1", "produto_id": "p1", "preco_unit": 35.00, "status": "pronto"}
                            ]
                          },
                          {
                            "id": "c-2", "mesa_id": 2, "numero_pedido": 13, "valor_pago": 0,
                            "status_comanda": "aguardando_pagamento", "criado_em": "2026-11-18T12:00:00Z",
                            "itens": [
                              {"id": "i2", "produto_id": "p1", "preco_unit": 50.00, "status": "entregue"}
                            ]
                          },
                          {
                            "id": "c-4a", "mesa_id": 4, "numero_pedido": 14, "valor_pago": 0,
                            "status_comanda": "aberta", "criado_em": "2026-11-18T12:20:00Z",
                            "itens": [{"id": "i4a", "produto_id": "p1", "preco_unit": 20.00, "status": "preparando"}]
                          },
                          {
                            "id": "c-4b", "mesa_id": 4, "numero_pedido": 15, "valor_pago": 0,
                            "status_comanda": "aberta", "criado_em": "2026-11-18T12:22:00Z",
                            "itens": [{"id": "i4b", "produto_id": "p2", "preco_unit": 15.00, "status": "pronto"}]
                          }
                        ]
                        """.trimIndent(),
                    )
                    else -> error("Unexpected get $path")
                }
            },
            nowMsProvider = { fixedNow },
        )

        val salon = api.salon()
        val m1 = salon[0]
        val m2 = salon[1]
        val m3 = salon[2]
        val m4 = salon[3]

        assertEquals(TableVisualState.READY, m1.visualState(showProductionStatus = true))
        assertEquals(TableVisualState.OCCUPIED, m1.visualState(showProductionStatus = false))
        assertEquals(2500L, m1.openBalance)
        assertEquals(15, m1.elapsedMinutes)
        assertTrue(m1.subtitleLabel(showProductionStatus = true).contains("1 pronto"))
        assertFalse(m1.subtitleLabel(showProductionStatus = false).contains("pronto"))

        assertEquals(TableVisualState.PAYMENT, m2.visualState(showProductionStatus = true))
        assertEquals(TableVisualState.FREE, m3.visualState(showProductionStatus = true))
        assertEquals(TableVisualState.MERGED, m4.visualState(showProductionStatus = true))
        assertEquals("Pedidos 14 + 15", m4.mergedOrderLabel)
        assertEquals(3500L, m4.openBalance)
    }

    @Test
    fun enforcesModifierRulesForSingleChoicePortionsAndMultiSelect() {
        val o1 = Option("o1", "Ao ponto", 0)
        val o2 = Option("o2", "Bem passado", 0)
        val singleGroup = Group("Ponto", min = 1, max = 1, repeatable = false, options = listOf(o1, o2))
        assertTrue(singleGroup.isSingleChoice)
        assertFalse(singleGroup.isSatisfied(emptyList()))
        assertTrue(singleGroup.canAdd(emptyList(), o1))
        assertFalse(singleGroup.canAdd(listOf(o1), o2))
        assertTrue(singleGroup.isSatisfied(listOf(o1)))

        val p1 = Option("p1", "Frango", 0)
        val p2 = Option("p2", "Carne", 0)
        val portionGroup = Group("Proteínas", min = 2, max = 2, repeatable = true, options = listOf(p1, p2))
        assertFalse(portionGroup.isSingleChoice)
        assertTrue(portionGroup.canAdd(listOf(p1), p1))
        assertFalse(portionGroup.canAdd(listOf(p1, p1), p2))
        assertTrue(portionGroup.isSatisfied(listOf(p1, p1)))

        val multiGroup = Group("Adicionais", min = 0, max = 2, repeatable = false, options = listOf(p1, p2))
        assertTrue(multiGroup.isSatisfied(emptyList()))
        assertTrue(multiGroup.canAdd(listOf(p1), p2))
        assertFalse(multiGroup.canAdd(listOf(p1), p1))
    }

    @Test
    fun persistsAndClearsTableDraftsAcrossRestarts() {
        val store = DraftStore(tempFolder.newFolder("drafts"))
        val scope = "https://example.koma|r:8"
        val product = Product(
            id = "burger-1",
            categoryId = "lanches",
            name = "Smash Duplo",
            price = 3290L,
            groups = emptyList(),
            familyId = "fam-burger",
            familyName = "Smash",
            familyAxis = "Tamanho",
            variantLabel = "Duplo",
        )
        val extra = Option("opt-bacon", "Bacon extra", 450L)
        val saved = mapOf(
            3 to listOf(Line(product, listOf(extra), "VIAGEM", 2, "Carlos")),
        )
        store.save(scope, saved)

        val reloaded = store.load(scope)
        assertEquals(1, reloaded[3]?.size)
        val line = reloaded[3]!!.single()
        assertEquals("burger-1", line.product.id)
        assertEquals("Duplo", line.product.variantLabel)
        assertEquals(listOf(extra), line.options)
        assertEquals("VIAGEM", line.note)
        assertEquals(2, line.quantity)
        assertEquals("Carlos", line.clientName)

        store.clearScope(scope)
        assertTrue(store.load(scope).isEmpty())
    }

    @Test
    fun bindsTerminalSwitchesOperatorsInvalidatesOn401AndUnbinds() {
        val xorCipher = object : TerminalKeyCipher {
            override fun encrypt(aad: ByteArray, plain: ByteArray): ByteArray =
                plain.mapIndexed { idx, b -> (b.toInt() xor (aad[idx % aad.size].toInt())).toByte() }.toByteArray()

            override fun decrypt(aad: ByteArray, cipherText: ByteArray): ByteArray =
                encrypt(aad, cipherText)
        }
        val store = TerminalSessionStore(tempFolder.newFolder("session"), cipher = xorCipher, nowProvider = { 1_000_000L })
        val scope = "https://example.koma"
        val rest = Restaurant(8, "Kôma Burger")

        val op1 = Session(rest, Operator("u1", "Ana"), tablesAvailable = true, ordersAvailable = true, role = "garcom")
        val op2 = Session(rest, Operator("u2", "Beto"), tablesAvailable = true, ordersAvailable = true, role = "caixa")

        val state1 = store.saveLogin(scope, op1, "ana", sessionToken(1200), ttlMs = 60_000L)
        val terminalId = state1.terminalId
        assertEquals(rest, state1.boundRestaurant)
        assertEquals("u1", state1.activeOperator?.operator?.id)

        val state2 = store.saveLogin(scope, op2, "beto", sessionToken(1201), ttlMs = 60_000L)
        assertEquals(terminalId, state2.terminalId)
        assertEquals(2, state2.operators.size)
        assertEquals("u2", state2.activeOperator?.operator?.id)

        val switched = store.switchOperator(scope, "u1")
        assertEquals("u1", switched.activeOperator?.operator?.id)

        val revoked = store.invalidateOperatorToken(scope, "u1")
        assertFalse(revoked.operators.first { it.operator.id == "u1" }.hasActiveToken(nowMs = 1_000_000L))
        assertEquals("ana", revoked.operators.first { it.operator.id == "u1" }.username)

        val unbound = store.unbindTerminal(scope)
        assertEquals(terminalId, unbound.terminalId)
        assertNull(unbound.boundRestaurant)
        assertNull(unbound.activeOperator)
        assertTrue(unbound.operators.isEmpty())
    }

    private fun sessionToken(expSeconds: Long): String {
        val payload = java.util.Base64.getUrlEncoder().withoutPadding()
            .encodeToString("{\"exp\":$expSeconds}".toByteArray())
        return "e30.$payload.signature"
    }

    private fun sessionStore(now: () -> Long): TerminalSessionStore = TerminalSessionStore(
        tempFolder.newFolder(),
        cipher = object : TerminalKeyCipher {
            override fun encrypt(aad: ByteArray, plain: ByteArray) = plain
            override fun decrypt(aad: ByteArray, cipherText: ByteArray) = cipherText
        },
        nowProvider = now,
    )

    @Test
    fun restoringSameTokenCannotExtendItsOriginalDeadline() {
        var now = 1_000_000L
        val store = sessionStore { now }
        val s = Session(Restaurant(8, "Teste"), Operator("u1", "Ana"), true, true)
        val token = sessionToken(1200)
        val original = store.saveLogin("api", s, "ana", token, ttlMs = 60_000L)
        now += 30_000L
        val restored = store.saveLogin("api", s, "ana", token, ttlMs = 60_000L)
        assertEquals(original.activeOperator!!.expiresAtMs, restored.activeOperator!!.expiresAtMs)
        assertEquals(original.activeOperator!!.savedAtMs, restored.activeOperator!!.savedAtMs)
    }

    @Test
    fun localSessionNeverOutlivesJwtAndRejectsMissingOrExpiredClaims() {
        val store = sessionStore { 1_000_000L }
        val s = Session(Restaurant(8, "Teste"), Operator("u1", "Ana"), true, true)
        val state = store.saveLogin("api", s, "ana", sessionToken(1010))
        assertEquals(1_010_000L, state.activeOperator!!.expiresAtMs)
        assertThrows(IllegalArgumentException::class.java) { store.saveLogin("api", s, "ana", "opaque") }
        assertThrows(IllegalArgumentException::class.java) { store.saveLogin("api", s, "ana", sessionToken(999)) }
    }

    @Test
    fun invalidatingActiveOperatorDoesNotSilentlyChooseAnotherPerson() {
        val store = sessionStore { System.currentTimeMillis() }
        val restaurant = Restaurant(8, "Teste")
        store.saveLogin("api", Session(restaurant, Operator("u1", "Ana"), true, true), "ana", sessionToken(System.currentTimeMillis() / 1000 + 600))
        store.saveLogin("api", Session(restaurant, Operator("u2", "Beto"), true, true), "beto", sessionToken(System.currentTimeMillis() / 1000 + 601))
        assertNull(store.invalidateOperatorToken("api", "u2").activeOperator)
    }

    @Test
    fun boundRestaurantCannotBeChangedBySavingAnotherLogin() {
        val store = sessionStore { 1_000_000L }
        store.saveLogin("api", Session(Restaurant(8, "A"), Operator("u1", "Ana"), true, true), "ana", sessionToken(1200))
        assertThrows(IllegalArgumentException::class.java) {
            store.saveLogin("api", Session(Restaurant(9, "B"), Operator("u2", "Beto"), true, true), "beto", sessionToken(1201))
        }
        assertEquals(8, store.load("api").boundRestaurant!!.id)
    }

    @Test
    fun createsAndConfirmsManualPaymentIntentWithChangeAndTableRelease() {
        val requests = mutableListOf<Pair<String, String>>()
        val api = WaiterApi(
            object : HttpTransport {
                override fun post(path: String, body: String): HttpResponsePayload {
                    requests.add(path to body)
                    return when (path) {
                        "/auth/smartpos/payment-intents" -> HttpResponsePayload(
                            201,
                            """
                            {
                              "id": "pi-100",
                              "mesa_id": 4,
                              "valor": "42.50",
                              "metodo": "dinheiro",
                              "captura": "dinheiro_pendente",
                              "escopo": "valor",
                              "status": "pendente",
                              "expira_em": "2026-11-18T13:00:00Z"
                            }
                            """.trimIndent(),
                        )
                        "/auth/smartpos/payment-intents/pi-100/confirmar-manual" -> HttpResponsePayload(
                            200,
                            """
                            {
                              "intent_id": "pi-100",
                              "status": "liquidada",
                              "payment_id": "pag-77",
                              "settled": true,
                              "valor_pago": 42.50,
                              "valor_recebido": 50.00,
                              "troco": 7.50,
                              "mesa_liberada": true
                            }
                            """.trimIndent(),
                        )
                        else -> error("Unexpected post $path")
                    }
                }
            },
        )

        val intent = api.createPaymentIntent(
            tableId = 4,
            amountCents = 4250L,
            method = "dinheiro",
            capture = null,
            scope = "valor",
        )
        assertEquals("pi-100", intent.id)
        assertEquals(4250L, intent.amountCents)
        val createPayload = JSONObject(requests[0].second)
        assertEquals("42.50", createPayload.getString("valor"))
        assertTrue(createPayload.isNull("captura"))

        val outcome = api.confirmManualPayment(intent.id, receivedCents = 5000L, idempotencyKey = "idem-1")
        assertTrue(outcome.settled)
        assertTrue(outcome.tableReleased)
        assertEquals(750L, outcome.trocoCents)
        assertEquals("pag-77", outcome.paymentId)
    }

    @Test
    fun parsesSmartPosEnabledCapabilityFromSessionContext() {
        val api = WaiterApi(
            object : HttpTransport {
                override fun post(path: String, body: String) = error("Unexpected post")
                override fun get(path: String) = when (path) {
                    "/auth/smartpos/contexto" -> HttpResponsePayload(
                        200,
                        """
                        {
                          "smartpos_enabled": true,
                          "turno_aberto": true,
                          "mesas_disponiveis": true,
                          "pedidos_disponiveis": true,
                          "provider_integrado_disponivel": false,
                          "terminal_mode": "registro_externo",
                          "restaurante": {"id": 8, "nome": "Kôma"},
                          "operador": {"id": "op-1", "nome": "Georlan", "role": "garcom"}
                        }
                        """.trimIndent(),
                    )
                    "/caixa/configuracoes" -> HttpResponsePayload(
                        200,
                        """{"perm_garcom_fechar": false}""",
                    )
                    else -> error("Unexpected get $path")
                }
            },
        )

        val session = api.session()
        assertTrue(session.smartposEnabled)
        assertFalse(session.permissions.canClose)
        assertEquals("garcom", session.role)
    }
    @Test
    fun corruptPaymentJournalCannotBeReadAsANeverStartedCharge() {
        val directory = tempFolder.newFolder("operations")
        val store = AndroidOperationStore(directory)
        val op = br.com.koma.smartpos.bridge.LocalOperation("pi-1", "pagbank", "operation-123", "POS-1")
        store.put(op)
        directory.listFiles()!!.single().writeText("corrupt journal")
        assertThrows(Exception::class.java) { store.get("operation-123") }
    }

}
