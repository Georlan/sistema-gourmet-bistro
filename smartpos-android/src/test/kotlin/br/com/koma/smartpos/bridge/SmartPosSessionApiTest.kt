package br.com.koma.smartpos.bridge

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class SmartPosSessionApiTest {
    private class FakeTransport(
        private val posts: ArrayDeque<HttpResponsePayload> = ArrayDeque(),
        private val gets: ArrayDeque<HttpResponsePayload> = ArrayDeque(),
    ) : HttpTransport {
        val postRequests = mutableListOf<Pair<String, String>>()
        val getRequests = mutableListOf<String>()

        override fun post(path: String, body: String): HttpResponsePayload {
            postRequests += path to body
            return posts.removeFirst()
        }

        override fun get(path: String): HttpResponsePayload {
            getRequests += path
            return gets.removeFirst()
        }
    }

    @Test
    fun loginUsesRootAuthEndpointAndReturnsToken() {
        val transport = FakeTransport(
            posts = ArrayDeque(listOf(HttpResponsePayload(200, """{"access_token":"jwt-123"}""")))
        )
        val api = KomaSmartPosSessionApi(transport)

        assertEquals("jwt-123", api.login("caixa@koma.test", "senha-segura"))
        assertEquals("/auth/login", transport.postRequests.single().first)
        assertTrue(transport.postRequests.single().second.contains("\"username\":\"caixa@koma.test\""))
    }

    @Test
    fun parsesSmartPosContextAndPendingQueue() {
        val contextJson = """
            {
              "smartpos_enabled":true,
              "turno_aberto":true,
              "restaurante":{"id":7,"nome":"Bistrô Teste"},
              "operador":{"id":"user-1","nome":"Operador","role":"caixa","restaurante_id":7}
            }
        """.trimIndent()
        val queueJson = """
            [
              {"intent_id":"i-1","mesa_id":4,"amount":"42.50","method":"credito","status":"criada","created_at":"2026-08-18T20:00:00+00:00","provider":null,"terminal_id":null},
              {"intent_id":"i-2","mesa_id":8,"amount":"18.00","method":"pix","status":"processando","created_at":"2026-08-18T20:01:00+00:00","provider":"pagbank","terminal_id":"POS-1"}
            ]
        """.trimIndent()
        val transport = FakeTransport(
            gets = ArrayDeque(
                listOf(
                    HttpResponsePayload(200, contextJson),
                    HttpResponsePayload(200, queueJson),
                )
            )
        )
        val api = KomaSmartPosSessionApi(transport)

        val context = api.context()
        assertTrue(context.smartposEnabled)
        assertTrue(context.turnoAberto)
        assertEquals("Bistrô Teste", context.restauranteNome)
        assertEquals("Operador", context.operadorNome)

        val intents = api.pendingProviderIntents("POS-1")
        assertEquals(2, intents.size)
        assertEquals(4250, intents[0].amountMinor)
        assertEquals("credito", intents[0].method)
        assertEquals(null, intents[0].provider)
        assertEquals("POS-1", intents[1].terminalId)
        assertTrue(transport.getRequests.last().startsWith("/auth/smartpos/payment-intents/pendentes-provider?"))
    }

    @Test
    fun operationKeyIsStablePerIntentTerminalAndProvider() {
        val first = StableOperationKey.forIntent("intent-1", "POS-1", "pagbank")
        val replay = StableOperationKey.forIntent("intent-1", "POS-1", "pagbank")
        val otherIntent = StableOperationKey.forIntent("intent-2", "POS-1", "pagbank")

        assertEquals(first, replay)
        assertNotEquals(first, otherIntent)
        assertTrue(first.startsWith("smartpos-"))
        assertFalse(first.contains("intent-1"))
    }
}
