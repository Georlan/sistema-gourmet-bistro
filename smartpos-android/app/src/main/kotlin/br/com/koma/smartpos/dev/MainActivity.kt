package br.com.koma.smartpos.dev

import android.app.Activity
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import br.com.koma.smartpos.bridge.FakeTerminalPaymentBridge
import br.com.koma.smartpos.bridge.FileOperationStore
import br.com.koma.smartpos.bridge.JdkHttpTransport
import br.com.koma.smartpos.bridge.KomaTerminalBackendApi
import br.com.koma.smartpos.bridge.PaymentOutcome
import br.com.koma.smartpos.bridge.TerminalCoordinator
import br.com.koma.smartpos.bridge.TerminalPaymentResult
import br.com.koma.smartpos.bridge.TerminalRuntime
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var bridge: FakeTerminalPaymentBridge
    private lateinit var operationStore: FileOperationStore

    private lateinit var backendUrl: EditText
    private lateinit var bearerToken: EditText
    private lateinit var intentId: EditText
    private lateinit var terminalId: EditText
    private lateinit var operationKey: EditText
    private lateinit var outcome: Spinner
    private lateinit var runButton: Button
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        bridge = FakeTerminalPaymentBridge()
        operationStore = FileOperationStore(File(filesDir, "smartpos-operations.tsv").toPath())
        setContentView(buildContent())
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun buildContent(): View {
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(28))
        }

        content.addView(TextView(this).apply {
            text = "Kôma SmartPOS · Terminal Dev"
            textSize = 24f
        })
        content.addView(TextView(this).apply {
            text = "FakeBridge — nenhuma cobrança real é executada."
            textSize = 14f
            setPadding(0, dp(4), 0, dp(16))
        })

        backendUrl = field("Backend URL", "https://")
        bearerToken = field("Bearer token (não é salvo)", "").apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        intentId = field("PaymentIntent ID", "")
        terminalId = field("Terminal ID", defaultTerminalId())
        operationKey = field("Operation key", UUID.randomUUID().toString())

        content.addView(backendUrl)
        content.addView(bearerToken)
        content.addView(intentId)
        content.addView(terminalId)
        content.addView(operationKey)

        content.addView(Button(this).apply {
            text = "Gerar nova operation key"
            setOnClickListener { operationKey.setText(UUID.randomUUID().toString()) }
        })

        content.addView(TextView(this).apply {
            text = "Resultado simulado do terminal"
            setPadding(0, dp(14), 0, dp(4))
        })
        outcome = Spinner(this).apply {
            adapter = ArrayAdapter(
                this@MainActivity,
                android.R.layout.simple_spinner_dropdown_item,
                listOf("APPROVED", "DECLINED", "PENDING", "TIMEOUT", "ERROR"),
            )
        }
        content.addView(outcome)

        runButton = Button(this).apply {
            text = "Executar ciclo do terminal"
            setOnClickListener { executeCycle() }
        }
        content.addView(runButton)

        status = TextView(this).apply {
            text = "Aguardando simulação."
            setPadding(0, dp(16), 0, 0)
            isTextSelectable = true
        }
        content.addView(status)

        return ScrollView(this).apply { addView(content) }
    }

    private fun field(label: String, initial: String): EditText = EditText(this).apply {
        hint = label
        setText(initial)
        setSingleLine(true)
    }

    private fun executeCycle() {
        val url = backendUrl.text.toString().trim().trimEnd('/')
        val token = bearerToken.text.toString().trim()
        val intent = intentId.text.toString().trim()
        val terminal = terminalId.text.toString().trim()
        val operation = operationKey.text.toString().trim()
        val selectedOutcome = PaymentOutcome.valueOf(outcome.selectedItem.toString())

        val validationError = when {
            url.isBlank() || !url.startsWith("http") -> "Informe uma URL HTTP/HTTPS válida."
            token.isBlank() -> "Informe o bearer token do operador SmartPOS."
            intent.isBlank() -> "Informe o PaymentIntent ID."
            terminal.isBlank() -> "Informe o terminal ID."
            operation.length < 8 -> "A operation key precisa ter ao menos 8 caracteres."
            else -> null
        }
        if (validationError != null) {
            status.text = validationError
            return
        }

        val result = TerminalPaymentResult(
            outcome = selectedOutcome,
            reference = if (selectedOutcome in setOf(PaymentOutcome.APPROVED, PaymentOutcome.DECLINED)) {
                "fake-${selectedOutcome.name.lowercase()}-${System.currentTimeMillis()}"
            } else null,
            message = "Resultado gerado pelo FakeBridge Android.",
        )
        bridge.setChargeResult(result)
        bridge.setReconcileResult(result)

        runButton.isEnabled = false
        status.text = "Executando em thread de trabalho..."

        executor.execute {
            runCatching {
                val transport = JdkHttpTransport(baseUrl = url, bearerToken = { token })
                val backend = KomaTerminalBackendApi(transport)
                val coordinator = TerminalCoordinator(bridge, operationStore)
                val runtime = TerminalRuntime(
                    backend = backend,
                    coordinator = coordinator,
                    provider = "pagbank",
                    terminalId = terminal,
                )
                runtime.runOnce(intent, operation)
            }.onSuccess { ack ->
                runOnUiThread {
                    status.text = buildString {
                        appendLine("Ciclo concluído.")
                        appendLine("intent: ${ack.intentId}")
                        appendLine("status backend: ${ack.status}")
                        append("replayed: ${ack.replayed}")
                    }
                    runButton.isEnabled = true
                }
            }.onFailure { error ->
                runOnUiThread {
                    status.text = "Falha: ${error.message ?: error::class.java.simpleName}\n\n" +
                        "A reserva local foi preservada. Repetir a mesma operation key executará reconciliação, não uma nova cobrança."
                    runButton.isEnabled = true
                }
            }
        }
    }

    private fun defaultTerminalId(): String {
        val androidId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
            ?: "unknown"
        return "DEV-${androidId.takeLast(10)}"
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
