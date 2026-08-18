package br.com.koma.smartpos.bridge

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class KomaTerminalBackendApiTest {
    private class FakeTransport(private val responses: ArrayDeque<HttpResponsePayload>) : HttpTransport {
        val requests = mutableListOf<Pair<String, String>>()
        override fun post(path: String, body: String): HttpResponsePayload {
            requests += path to body
            return responses.removeFirst()
        }
    }

    @Test
    fun mapsPrepareResponseAndConvertsAmountToMinorUnits() {
        val transport = FakeTransport(
            ArrayDeque(
                listOf(
                    HttpResponsePayload(
                        200,
                        """{"intent_id":"intent-1","restaurante_id":7,"provider":"pagbank","operation_key":"operation-123","terminal_id":"POS-01","amount":"42.50","method":"credito","mode":"charge","should_execute":true,"financial_effect":false}""",
                    )
                )
            )
        )
        val api = KomaTerminalBackendApi(transport)

        val command = api.prepare("intent-1", "pagbank", "operation-123", "POS-01")
        assertEquals(4250, command.amountMinor)
        assertEquals(CommandMode.CHARGE, command.mode)
        assertTrue(command.shouldExecute)
        assertTrue(transport.requests.single().first.endsWith("/preparar-terminal"))
    }

    @Test
    fun postsNormalizedTerminalResult() {
        val transport = FakeTransport(
            ArrayDeque(
                listOf(HttpResponsePayload(200, """{"intent_id":"intent-1","status":"aprovada","replayed":false}"""))
            )
        )
        val api = KomaTerminalBackendApi(transport)
        val command = TerminalCommand(
            intentId = "intent-1",
            restauranteId = 7,
            provider = "pagbank",
            operationKey = "operation-123",
            terminalId = "POS-01",
            amountMinor = 4250,
            method = "credito",
            mode = CommandMode.CHARGE,
            shouldExecute = true,
        )

        val ack = api.submitResult(
            command,
            TerminalPaymentResult(PaymentOutcome.APPROVED, reference = "pb-123", message = "ok"),
        )
        assertEquals("aprovada", ack.status)
        val body = transport.requests.single().second
        assertTrue(body.contains("\"outcome\":\"approved\""))
        assertTrue(body.contains("\"reference\":\"pb-123\""))
    }
}
