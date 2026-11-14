package br.com.koma.print.core

import java.io.ByteArrayOutputStream
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class KomaPrintAndroidCoreTest {
    @Test
    fun `infer profile detects Kapbom KA-1445 and 58mm printers with 32 columns and no cut`() {
        val kapbom = PrinterPaperProfile.infer("Kapbom KA-1445")
        assertEquals("thermal-58mm", kapbom.key)
        assertEquals(58, kapbom.paperWidthMm)
        assertEquals(32, kapbom.columns)
        assertEquals(384, kapbom.dotsPerLine)
        assertFalse(kapbom.supportsCut)
        assertEquals("ascii_safe", kapbom.charsetPolicy)
        assertEquals("compact_58", kapbom.semanticLayout)

        val mpt2 = PrinterPaperProfile.infer("MPT-II Bluetooth")
        assertEquals(58, mpt2.paperWidthMm)
        assertEquals(32, mpt2.columns)

        val generic80 = PrinterPaperProfile.infer("Epson TM-T20X")
        assertEquals(80, generic80.paperWidthMm)
        assertEquals(48, generic80.columns)
        assertTrue(generic80.supportsCut)
    }

    @Test
    fun `EscPos58Renderer fits 48-column ticket to 32 columns ascii-safe without cut command`() {
        val sample48ColPayload = buildString {
            appendLine("================================================")
            appendLine("                   JE LANCHES                   ")
            appendLine("                  PEDIDO #1042                  ")
            appendLine("================================================")
            appendLine("1x X-Tudo Especial                       R$18,00")
            appendLine("   + Porção de Bacon                     R$ 2,00")
            appendLine("   OBS: Pão bem tostado e sem maionese")
            appendLine("------------------------------------------------")
            appendLine("TOTAL DO PEDIDO                          R$20,00")
            appendLine("               Gerenciado por KÔMA              ")
            appendLine("              DOCUMENTO NÃO FISCAL              ")
            append("[CUT]")
        }

        val payloadBytes = EscPos58Renderer.buildEscPosPayload(
            payloadText = sample48ColPayload,
            profile = PrinterPaperProfile.KAPBOM_KA1445_58MM,
        )

        // Deve iniciar com ESC @ (0x1B 0x40) + ESC t 3 (0x1B 0x74 0x03)
        assertEquals(0x1B.toByte(), payloadBytes[0])
        assertEquals(0x40.toByte(), payloadBytes[1])
        assertEquals(0x1B.toByte(), payloadBytes[2])
        assertEquals(0x74.toByte(), payloadBytes[3])
        assertEquals(0x03.toByte(), payloadBytes[4])

        // Impressora 58mm Kapbom KA-1445 não possui guilhotina automática: não deve emitir GS V B 0
        val cutSeq = EscPos58Renderer.PARTIAL_CUT
        val hasCut = payloadBytes.indices.any { idx ->
            idx + cutSeq.size <= payloadBytes.size &&
                cutSeq.indices.all { offset -> payloadBytes[idx + offset] == cutSeq[offset] }
        }
        assertFalse(hasCut, "Bobina 58mm sem guilhotina não deve receber comando de corte parcial")

        val bodyText = String(payloadBytes.drop(5).toByteArray(), Charsets.ISO_8859_1)
        assertFalse(bodyText.contains("[CUT]"))
        assertFalse(bodyText.contains("Gerenciado por"), "Rodapé de marca deve ser omitido no compact_58")
        assertTrue(bodyText.contains("DOCUMENTO NAO FISCAL"))
        assertTrue(bodyText.contains("Pao bem tostado"))

        val visibleLines = bodyText.split("\n")
            .map { EscPos58Renderer.visibleText(it) }
            .filter { it.isNotEmpty() }
        assertTrue(visibleLines.all { it.length <= 32 }, "Nenhuma linha visível pode exceder 32 colunas")
    }

    @Test
    fun `compact 58mm JE ticket removes duplicate options and aligns long price`() {
        val name = "12x X-HAMBURGUER ARTESANAL COM CHEDDAR E BACON"
        val price = "R$ 129,90"
        val source = listOf(
            "=".repeat(48), "JE LANCHES".padStart(29).padEnd(48),
            "RETIRADA".padStart(27).padEnd(48), "PEDIDO #5",
            "CLIENTE", "NOME: PAULO JOSE", "TELEFONE: (88) 99999-9999",
            "-".repeat(48), "ITENS".padEnd(43) + "VALOR",
            name.padEnd(48 - price.length) + price,
            "   OBS: OPÇÕES: BACON, CARNE DE HAMBURGUER",
            "   OBS: SEM CEBOLA",
            "-".repeat(48), "-".repeat(48), "PAGAMENTO",
            "FORMA: DINHEIRO", "A COBRAR: R$ 129,90",
            "SUBTOTAL ITENS:".padEnd(48 - price.length) + price,
            "TOTAL DO PEDIDO:".padEnd(48 - price.length) + price,
            "DOCUMENTO NÃO FISCAL",
        ).joinToString("\n")
        val payload = EscPos58Renderer.buildEscPosPayload(source)
        val body = String(payload.drop(5).toByteArray(), Charsets.ISO_8859_1).trimEnd()
        val lines = body.lines().map { EscPos58Renderer.visibleText(it) }
        assertTrue(lines.all { it.length <= 32 }, lines.joinToString("\n"))
        assertTrue(body.contains("OPCOES: BACON"))
        assertFalse(body.contains("OBS: OPCOES:"))
        assertTrue(body.contains("OBS: SEM CEBOLA"))
        assertTrue(body.contains("PAULO JOSE"))
        assertTrue(body.contains("TEL: (88) 99999-9999"))
        assertFalse(body.contains("NOME:"))
        assertFalse(body.contains("SUBTOTAL ITENS:"))
        assertTrue(lines.any { "CHEDDAR E BACON" in it && price in it })
        assertTrue(lines.zipWithNext().none { (a, b) ->
            a.trim().isNotEmpty() && a.trim().all { it == '-' || it == '=' } &&
                b.trim().isNotEmpty() && b.trim().all { it == '-' || it == '=' }
        })
    }

    @Test
    fun `compact 58mm retains subtotal with fees and discounts`() {
        val source = listOf(
            "-".repeat(48),
            "SUBTOTAL ITENS:".padEnd(40) + "R$ 19,00",
            "TAXA DE ENTREGA:".padEnd(40) + "R$ 5,00",
            "DESCONTO CUPOM:".padEnd(40) + "-R$ 2,00",
            "TOTAL DO PEDIDO:".padEnd(40) + "R$ 22,00",
        ).joinToString("\n")
        val text = String(
            EscPos58Renderer.buildEscPosPayload(source).drop(5).toByteArray(),
            Charsets.ISO_8859_1,
        )
        assertTrue("SUBTOTAL ITENS:" in text)
        assertTrue("TAXA DE ENTREGA:" in text)
        assertTrue("DESCONTO CUPOM:" in text)
        assertTrue("R$ 22,00" in text)
    }

    @Test
    fun `standard 80mm keeps options and subtotal unchanged`() {
        val source = listOf(
            "=".repeat(48), "CLIENTE", "NOME: PAULO JOSE",
            "   OBS: OPÇÕES: BACON, CARNE DE HAMBURGUER",
            "SUBTOTAL ITENS:".padEnd(38) + "R$ 19,00",
        ).joinToString("\n")
        val wide = PrinterPaperProfile.infer("Epson TM-T20X")
        val payload = EscPos58Renderer.buildEscPosPayload(source, profile = wide)
        val text = String(payload.drop(5).toByteArray(), java.nio.charset.Charset.forName("IBM860"))
        assertTrue(source in text)
    }

    @Test
    fun `FilePrintJournal persists stages atomically and blocks duplicate transport dispatch`() {
        val tempDir = Files.createTempDirectory("koma-print-journal-test")
        val journalPath = tempDir.resolve("journal.properties")
        var now = 1_700_000_000_000L

        val journal1 = FilePrintJournal(storageFile = journalPath, clockEpochMs = { now })
        assertFalse(journal1.hasReachedTransport("job-101", "ikey-101"))

        val rec = journal1.recordReceivedLocal("job-101", "ikey-101", "Kapbom KA-1445")
        assertEquals(PrintReceiptStage.RECEBIDO_LOCAL, rec.stage)
        assertFalse(journal1.hasReachedTransport("job-101", "ikey-101"))

        now += 500
        val sent = journal1.recordSentToTransport("job-101", "ikey-101", "Kapbom KA-1445")
        assertEquals(PrintReceiptStage.ENVIADO_TRANSPORTE, sent.stage)
        assertTrue(journal1.hasReachedTransport("job-101"))
        assertTrue(journal1.hasReachedTransport("other-id", "ikey-101"))
        assertEquals(1, journal1.unconfirmedPrintedJobs().size)

        // Simula reinício do serviço Android (lendo do disco) antes do ACK HTTP
        val journalReloaded = FilePrintJournal(storageFile = journalPath, clockEpochMs = { now })
        assertTrue(journalReloaded.hasReachedTransport("job-101", "ikey-101"))
        assertEquals(1, journalReloaded.unconfirmedPrintedJobs().size)

        now += 500
        val confirmed = journalReloaded.markBackendConfirmed("job-101")
        assertNotNull(confirmed)
        assertEquals(PrintReceiptStage.CONFIRMADO_BACKEND, confirmed.stage)
        assertTrue(journalReloaded.unconfirmedPrintedJobs().isEmpty())

        val verified = journalReloaded.markPhysicallyVerified("job-101")
        assertNotNull(verified)
        assertEquals(PrintReceiptStage.IMPRESSO_FISICAMENTE_VERIFICADO, verified.stage)
    }

    @Test
    fun `AndroidPrintWorker reconciles unconfirmed jobs and prevents duplicate Bluetooth print`() {
        val tempDir = Files.createTempDirectory("koma-worker-dedup-test")
        val journal = FilePrintJournal(tempDir.resolve("journal.properties"))
        // Simula job-1 já enviado para a impressora antes de queda de rede, e job-2 já confirmado
        journal.recordSentToTransport("job-1", "ikey-1", "Kapbom KA-1445")
        journal.recordSentToTransport("job-2", "ikey-2", "Kapbom KA-1445")
        journal.markBackendConfirmed("job-2")

        val fakeHttp = FakePrintAgentHttpTransport(
            claimedJobsJson = """
                [
                  {
                    "id": "job-2",
                    "restaurante_id": 1,
                    "document_type": "producao",
                    "destination": "COZINHA",
                    "source_type": "pedido",
                    "source_id": "10",
                    "payload_text": "PEDIDO #10\n1x X-Burguer R$12,00",
                    "idempotency_key": "ikey-2",
                    "attempts": 1
                  },
                  {
                    "id": "job-3",
                    "restaurante_id": 1,
                    "document_type": "producao",
                    "destination": "COZINHA",
                    "source_type": "pedido",
                    "source_id": "11",
                    "payload_text": "PEDIDO #11\n1x Pastelao R$12,00",
                    "idempotency_key": "ikey-3",
                    "attempts": 0
                  }
                ]
            """.trimIndent(),
        )
        val fakeBt = FakeBluetoothSppTransport()
        val client = KomaPrintAgentClient(fakeHttp, agentTokenProvider = { "tok-123" })
        val worker = AndroidPrintWorker(client, fakeBt, journal)

        val outcome = worker.runCycle()
        assertEquals(2, outcome.claimedCount)
        assertEquals(1, outcome.deduplicatedSkipCount, "job-2 já impresso não deve ser reenviado ao Bluetooth")
        assertEquals(1, outcome.printedAndSentCount, "Apenas job-3 deve ser enviado ao socket RFCOMM")
        assertEquals(1, fakeBt.sentPayloads.size, "Socket Bluetooth deve receber exatamente 1 transmissão física")
        assertTrue(journal.isBackendConfirmed("job-1"), "job-1 pendente deve ser reconciliado no backend")
        assertTrue(journal.isBackendConfirmed("job-3"), "job-3 impresso deve ser confirmado no backend")
    }

    @Test
    fun `AndroidPrintWorker releases untouched jobs when Bluetooth disconnects mid-batch`() {
        val tempDir = Files.createTempDirectory("koma-worker-midbatch-test")
        val journal = FilePrintJournal(tempDir.resolve("journal.properties"))
        val fakeHttp = FakePrintAgentHttpTransport(
            claimedJobsJson = """
                [
                  {
                    "id": "job-a",
                    "restaurante_id": 1,
                    "document_type": "producao",
                    "destination": "COZINHA",
                    "source_type": "pedido",
                    "source_id": "20",
                    "payload_text": "PEDIDO #20",
                    "idempotency_key": "ikey-a",
                    "attempts": 0
                  },
                  {
                    "id": "job-b",
                    "restaurante_id": 1,
                    "document_type": "producao",
                    "destination": "COZINHA",
                    "source_type": "pedido",
                    "source_id": "21",
                    "payload_text": "PEDIDO #21",
                    "idempotency_key": "ikey-b",
                    "attempts": 0
                  },
                  {
                    "id": "job-c",
                    "restaurante_id": 1,
                    "document_type": "producao",
                    "destination": "COZINHA",
                    "source_type": "pedido",
                    "source_id": "22",
                    "payload_text": "PEDIDO #22",
                    "idempotency_key": "ikey-c",
                    "attempts": 0
                  }
                ]
            """.trimIndent(),
        )
        // Primeiro envio sucede (job-a), segundo falha por desconexão Bluetooth (job-b)
        val fakeBt = FakeBluetoothSppTransport(failOnSendIndex = 1)
        val client = KomaPrintAgentClient(fakeHttp, agentTokenProvider = { "tok-123" })
        val worker = AndroidPrintWorker(client, fakeBt, journal)

        val outcome = worker.runCycle()
        assertEquals(3, outcome.claimedCount)
        assertEquals(1, outcome.printedAndSentCount)
        assertEquals("job-b", outcome.failedJobId)
        assertEquals(1, outcome.releasedUntouchedCount, "job-c não tocado deve ser liberado via release-batch")
        assertEquals(listOf("job-a"), fakeHttp.completedJobIds)
        assertEquals(listOf("job-b"), fakeHttp.failedJobIds)
        assertEquals(listOf("job-c"), fakeHttp.releasedJobIds)
        assertTrue(journal.isBackendConfirmed("job-a"))
        assertFalse(journal.hasReachedTransport("job-b"))
        assertNull(journal.get("job-c"))
    }

    @Test
    fun `AndroidPrintWorker executes remote test_bluetooth command from heartbeat`() {
        val tempDir = Files.createTempDirectory("koma-worker-cmd-test")
        val journal = FilePrintJournal(tempDir.resolve("journal.properties"))
        val fakeHttp = FakePrintAgentHttpTransport(
            heartbeatCommandJson = """
                {
                  "id": "cmd-99",
                  "action": "test_bluetooth",
                  "printer_name": "Kapbom KA-1445",
                  "printer_uri": "bluetooth://AA:BB:CC:11:22:33"
                }
            """.trimIndent(),
        )
        val fakeBt = FakeBluetoothSppTransport()
        val client = KomaPrintAgentClient(fakeHttp, agentTokenProvider = { "tok-123" })
        val worker = AndroidPrintWorker(client, fakeBt, journal)

        val outcome = worker.runCycle()
        assertEquals("cmd-99", outcome.executedCommandId)
        assertEquals(1, fakeBt.sentPayloads.size)
        assertTrue(fakeHttp.completedCommandIds.contains("cmd-99"))
    }

    @Test
    fun `BluetoothReconnectPolicy chunks payload and OemCompatibilityPolicy covers Android 8 to 14+`() {
        val policy = BluetoothReconnectPolicy(chunkSizeBytes = 128, interChunkPauseMs = 5L)
        val out = ByteArrayOutputStream()
        val pauses = mutableListOf<Long>()
        val payload = ByteArray(300) { (it % 251).toByte() }

        val written = policy.writeChunked(out, payload, sleeper = { pauses.add(it) })
        assertEquals(300, written)
        assertTrue(out.toByteArray().contentEquals(payload))
        assertEquals(2, pauses.size, "300 bytes em blocos de 128 bytes gera 3 blocos e 2 pausas intermediárias")

        // Android 8.0 (API 26) a Android 11 (API 30)
        val permsApi26 = OemCompatibilityPolicy.requiredRuntimePermissions(26)
        assertTrue(OemCompatibilityPolicy.PERMISSION_BLUETOOTH in permsApi26)
        assertFalse(OemCompatibilityPolicy.PERMISSION_BLUETOOTH_CONNECT in permsApi26)

        // Android 12 (API 31)
        val permsApi31 = OemCompatibilityPolicy.requiredRuntimePermissions(31)
        assertTrue(OemCompatibilityPolicy.PERMISSION_BLUETOOTH_CONNECT in permsApi31)
        assertTrue(OemCompatibilityPolicy.PERMISSION_BLUETOOTH_SCAN in permsApi31)

        // Android 13+ (API 33)
        val permsApi34 = OemCompatibilityPolicy.requiredRuntimePermissions(34)
        assertTrue(OemCompatibilityPolicy.PERMISSION_POST_NOTIFICATIONS in permsApi34)

        assertTrue(OemCompatibilityPolicy.lockScreenGuidanceForManufacturer("Xiaomi").contains("HyperOS"))
        assertTrue(OemCompatibilityPolicy.lockScreenGuidanceForManufacturer("samsung").contains("One UI"))
    }
}

private class FakeBluetoothSppTransport(
    private val failOnSendIndex: Int = -1,
) : BluetoothSppTransport {
    val sentPayloads = mutableListOf<ByteArray>()
    private var sendCounter = 0

    override fun listPairedSppPrinters(): List<BluetoothPrinterDevice> = listOf(
        BluetoothPrinterDevice(
            name = "Kapbom KA-1445",
            address = "aa-bb-cc-11-22-33",
            paired = true,
            connected = true,
        ),
    )

    override fun sendRawPayload(device: BluetoothPrinterDevice, payload: ByteArray): SppTransmissionResult {
        val currentIdx = sendCounter++
        if (currentIdx == failOnSendIndex) {
            return SppTransmissionResult(
                success = false,
                attempts = 3,
                errorCode = "socket_io_error",
                errorMessage = "Impressora Kapbom KA-1445 desligada ou fora de alcance",
            )
        }
        sentPayloads.add(payload)
        return SppTransmissionResult(
            success = true,
            bytesWritten = payload.size,
            strategyUsed = SppSocketStrategy.SECURE_SPP_UUID,
            attempts = 1,
        )
    }
}

private class FakePrintAgentHttpTransport(
    private val claimedJobsJson: String = "[]",
    private val heartbeatCommandJson: String = "null",
) : PrintAgentHttpTransport {
    val completedJobIds = mutableListOf<String>()
    val failedJobIds = mutableListOf<String>()
    val releasedJobIds = mutableListOf<String>()
    val completedCommandIds = mutableListOf<String>()

    override fun post(path: String, body: String, headers: Map<String, String>): HttpResponsePayload {
        return when {
            path == "/api/print-agents/heartbeat" -> HttpResponsePayload(
                statusCode = 200,
                body = """{"status":"ok","agent_id":"android-je-lanches","restaurante_id":1,"command":$heartbeatCommandJson}""",
            )
            path.startsWith("/api/print-agents/actions/") && path.endsWith("/complete") -> {
                val cmdId = path.removePrefix("/api/print-agents/actions/").removeSuffix("/complete")
                completedCommandIds.add(cmdId)
                HttpResponsePayload(200, """{"status":"ok","command":{"id":"$cmdId"}}""")
            }
            path.startsWith("/api/print-agents/jobs/claim-batch") -> HttpResponsePayload(
                statusCode = 200,
                body = claimedJobsJson,
            )
            path == "/api/print-agents/jobs/complete-batch" -> {
                val ids = Regex(""""job_id"\s*:\s*"([^"]+)"""").findAll(body).map { it.groupValues[1] }.toList()
                completedJobIds.addAll(ids)
                val idsJson = ids.joinToString(",") { "\"$it\"" }
                HttpResponsePayload(
                    statusCode = 200,
                    body = """{"status":"ok","confirmed_job_ids":[$idsJson],"rejected_job_ids":[]}""",
                )
            }
            path == "/api/print-agents/jobs/release-batch" -> {
                val ids = MinimalJson.stringArray(body, "job_ids")
                releasedJobIds.addAll(ids)
                val idsJson = ids.joinToString(",") { "\"$it\"" }
                HttpResponsePayload(
                    statusCode = 200,
                    body = """{"status":"ok","released_job_ids":[$idsJson],"ignored_job_ids":[]}""",
                )
            }
            path.startsWith("/api/print-agents/jobs/") && path.endsWith("/fail") -> {
                val jobId = path.removePrefix("/api/print-agents/jobs/").removeSuffix("/fail")
                failedJobIds.add(jobId)
                HttpResponsePayload(200, """{"status":"ok","job_id":"$jobId"}""")
            }
            else -> HttpResponsePayload(404, """{"detail":"not found"}""")
        }
    }

    override fun get(path: String, headers: Map<String, String>): HttpResponsePayload =
        HttpResponsePayload(200, "{}")
}
