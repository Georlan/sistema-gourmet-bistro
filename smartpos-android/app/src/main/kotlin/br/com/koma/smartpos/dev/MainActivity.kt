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
import br.com.koma.smartpos.bridge.KomaSmartPosSessionApi
import br.com.koma.smartpos.bridge.KomaTerminalBackendApi
import br.com.koma.smartpos.bridge.PaymentOutcome
import br.com.koma.smartpos.bridge.PendingProviderIntent
import br.com.koma.smartpos.bridge.SmartPosContext
import br.com.koma.smartpos.bridge.StableOperationKey
import br.com.koma.smartpos.bridge.TerminalCoordinator
import br.com.koma.smartpos.bridge.TerminalPaymentResult
import br.com.koma.smartpos.bridge.TerminalRuntime
import java.io.File
import java.util.concurrent.Executors

class MainActivity : Activity() {
    companion object {
        private const val DEFAULT_API = "https://sistema-gourmet-bistro-production.up.railway.app"
        private const val PROVIDER = "pagbank"
    }

    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var bridge: FakeTerminalPaymentBridge
    private lateinit var operationStore: FileOperationStore
    private val terminalId: String by lazy { defaultTerminalId() }

    @Volatile private var sessionToken: String? = null
    private var transport: JdkHttpTransport? = null
    private var sessionApi: KomaSmartPosSessionApi? = null
    private var context: SmartPosContext? = null
    private var pendingIntents: List<PendingProviderIntent> = emptyList()

    private lateinit var loginSection: LinearLayout
    private lateinit var operationSection: LinearLayout
    private lateinit var backendUrl: EditText
    private lateinit var username: EditText
    private lateinit var password: EditText
    private lateinit var restauranteId: EditText
    private lateinit var loginButton: Button
    private lateinit var sessionInfo: TextView
    private lateinit var intentsSpinner: Spinner
    private lateinit var refreshButton: Button
    private lateinit var outcome: Spinner
    private lateinit var runButton: Button
    private lateinit var logoutButton: Button
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        bridge = FakeTerminalPaymentBridge()
        operationStore = FileOperationStore(File(filesDir, "smartpos-operations.tsv").toPath())
        setContentView(buildContent())
        showLoggedOut()
    }

    override fun onResume() {
        super.onResume()
        if (sessionApi != null && !sessionToken.isNullOrBlank()) {
            refreshQueue(silent = true)
        }
    }

    override fun onDestroy() {
        executor.shutdownNow()
        sessionToken = null
        super.onDestroy()
    }

    private fun buildContent(): View {
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(28))
        }

        content.addView(TextView(this).apply {
            text = "Kôma Maquininha"
            textSize = 26f
        })
        content.addView(TextView(this).apply {
            text = "Terminal DEV · FakeBridge · nenhuma cobrança real"
            textSize = 13f
            setPadding(0, dp(4), 0, dp(14))
        })

        loginSection = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        backendUrl = field("API do Kôma", DEFAULT_API)
        username = field("E-mail ou telefone", "")
        password = field("Senha", "").apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        restauranteId = field("ID do estabelecimento (somente se solicitado)", "").apply {
            inputType = InputType.TYPE_CLASS_NUMBER
        }
        loginButton = Button(this).apply {
            text = "Entrar na maquininha"
            setOnClickListener { login() }
        }
        loginSection.addView(backendUrl)
        loginSection.addView(username)
        loginSection.addView(password)
        loginSection.addView(restauranteId)
        loginSection.addView(loginButton)
        content.addView(loginSection)

        operationSection = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        sessionInfo = TextView(this).apply {
            textSize = 16f
            setPadding(0, 0, 0, dp(10))
        }
        operationSection.addView(sessionInfo)
        operationSection.addView(TextView(this).apply {
            text = "Recebimentos integrados disponíveis"
            setPadding(0, dp(6), 0, dp(4))
        })
        intentsSpinner = Spinner(this)
        operationSection.addView(intentsSpinner)
        refreshButton = Button(this).apply {
            text = "Atualizar recebimentos"
            setOnClickListener { refreshQueue() }
        }
        operationSection.addView(refreshButton)
        operationSection.addView(TextView(this).apply {
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
        operationSection.addView(outcome)
        runButton = Button(this).apply {
            text = "Executar / reconciliar simulação"
            setOnClickListener { executeSelectedIntent() }
        }
        operationSection.addView(runButton)
        logoutButton = Button(this).apply {
            text = "Sair"
            setOnClickListener { logout() }
        }
        operationSection.addView(logoutButton)
        content.addView(operationSection)

        val statusView = TextView(this).apply {
            text = "Faça login para carregar o contexto da maquininha."
            setPadding(0, dp(16), 0, 0)
            setTextIsSelectable(true)
        }
        status = statusView
        content.addView(statusView)

        return ScrollView(this).apply { addView(content) }
    }

    private fun login() {
        val url = backendUrl.text.toString().trim().trimEnd('/')
        val identifier = username.text.toString().trim()
        val secret = password.text.toString()
        val ridText = restauranteId.text.toString().trim()
        val rid = if (ridText.isBlank()) null else ridText.toIntOrNull()

        val validation = when {
            !url.startsWith("http://") && !url.startsWith("https://") -> "Informe uma URL HTTP/HTTPS válida."
            identifier.isBlank() -> "Informe o e-mail ou telefone."
            secret.isBlank() -> "Informe a senha."
            ridText.isNotBlank() && rid == null -> "O ID do estabelecimento precisa ser numérico."
            else -> null
        }
        if (validation != null) {
            status.text = validation
            return
        }

        setBusy(true, "Autenticando e carregando contexto...")
        executor.execute {
            runCatching {
                val localTransport = JdkHttpTransport(
                    baseUrl = url,
                    bearerToken = { sessionToken.orEmpty() },
                )
                val localApi = KomaSmartPosSessionApi(localTransport)
                val token = localApi.login(identifier, secret, rid)
                sessionToken = token
                val loadedContext = localApi.context()
                require(loadedContext.smartposEnabled) { "A maquininha não está habilitada para este restaurante." }
                val intents = localApi.pendingProviderIntents(terminalId, PROVIDER)
                Triple(localTransport, localApi, loadedContext to intents)
            }.onSuccess { (localTransport, localApi, loaded) ->
                transport = localTransport
                sessionApi = localApi
                context = loaded.first
                pendingIntents = loaded.second
                runOnUiThread {
                    password.setText("")
                    showLoggedIn()
                    renderSession()
                    renderQueue()
                    status.text = "Sessão da maquininha carregada. Terminal: $terminalId\n" +
                        "FakeBridge ativo: APPROVED/DECLINED/PENDING/TIMEOUT/ERROR podem ser simulados sem cartão."
                    setBusy(false)
                }
            }.onFailure { error ->
                sessionToken = null
                transport = null
                sessionApi = null
                context = null
                pendingIntents = emptyList()
                runOnUiThread {
                    status.text = "Falha no login: ${error.message ?: error::class.java.simpleName}"
                    setBusy(false)
                }
            }
        }
    }

    private fun refreshQueue(silent: Boolean = false) {
        val api = sessionApi ?: return
        if (!silent) setBusy(true, "Atualizando recebimentos...")
        executor.execute {
            runCatching { api.pendingProviderIntents(terminalId, PROVIDER) }
                .onSuccess { intents ->
                    pendingIntents = intents
                    runOnUiThread {
                        renderQueue()
                        if (!silent) {
                            status.text = if (intents.isEmpty()) {
                                "Nenhum recebimento integrado disponível para este terminal."
                            } else {
                                "${intents.size} recebimento(s) disponível(is)."
                            }
                        }
                        setBusy(false)
                    }
                }
                .onFailure { error ->
                    runOnUiThread {
                        status.text = "Falha ao atualizar: ${error.message ?: error::class.java.simpleName}\n" +
                            "A sessão local foi mantida; tente novamente quando a rede voltar."
                        setBusy(false)
                    }
                }
        }
    }

    private fun executeSelectedIntent() {
        val selected = pendingIntents.getOrNull(intentsSpinner.selectedItemPosition)
        val localTransport = transport
        if (selected == null || localTransport == null || sessionToken.isNullOrBlank()) {
            status.text = "Selecione um recebimento integrado válido."
            return
        }

        val selectedOutcome = PaymentOutcome.valueOf(outcome.selectedItem.toString())
        val fakeResult = TerminalPaymentResult(
            outcome = selectedOutcome,
            reference = if (selectedOutcome in setOf(PaymentOutcome.APPROVED, PaymentOutcome.DECLINED)) {
                "fake-${selectedOutcome.name.lowercase()}-${selected.intentId.take(8)}"
            } else null,
            message = "Resultado gerado pelo FakeBridge Android: ${selectedOutcome.name}.",
        )
        bridge.setChargeResult(fakeResult)
        bridge.setReconcileResult(fakeResult)
        val operationKey = StableOperationKey.forIntent(selected.intentId, terminalId, PROVIDER)

        setBusy(true, "Executando/reconciliando ${selected.displayLabel()}...")
        executor.execute {
            runCatching {
                val backend = KomaTerminalBackendApi(localTransport)
                val coordinator = TerminalCoordinator(bridge, operationStore)
                val runtime = TerminalRuntime(
                    backend = backend,
                    coordinator = coordinator,
                    provider = PROVIDER,
                    terminalId = terminalId,
                )
                runtime.runOnce(selected.intentId, operationKey)
            }.onSuccess { ack ->
                runOnUiThread {
                    status.text = buildString {
                        append("Resultado recebido pelo Kôma: ").append(ack.status)
                        if (ack.replayed) append(" · replay idempotente")
                        if (ack.status == "processando") {
                            append("\nOperação preservada para reconciliação; nenhuma segunda cobrança deve ser criada.")
                        }
                    }
                    setBusy(false)
                    refreshQueue(silent = true)
                }
            }.onFailure { error ->
                runOnUiThread {
                    status.text = "Falha: ${error.message ?: error::class.java.simpleName}\n" +
                        "A reserva local foi preservada; a próxima tentativa usará reconciliação, não nova cobrança."
                    setBusy(false)
                }
            }
        }
    }

    private fun logout() {
        sessionToken = null
        transport = null
        sessionApi = null
        context = null
        pendingIntents = emptyList()
        renderQueue()
        showLoggedOut()
        status.text = "Sessão encerrada. O token não foi persistido."
    }

    private fun renderSession() {
        val loaded = context ?: return
        sessionInfo.text = buildString {
            appendLine(loaded.restauranteNome)
            append(loaded.operadorNome).append(" · ").append(loaded.operadorRole)
            append(" · Caixa ").append(if (loaded.turnoAberto) "aberto" else "fechado")
            append("\nTerminal ").append(terminalId)
        }
    }

    private fun renderQueue() {
        val labels = if (pendingIntents.isEmpty()) {
            listOf("Nenhum recebimento integrado")
        } else {
            pendingIntents.map { it.displayLabel() }
        }
        intentsSpinner.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            labels,
        )
        runButton.isEnabled = pendingIntents.isNotEmpty() && sessionToken != null
    }

    private fun showLoggedOut() {
        loginSection.visibility = View.VISIBLE
        operationSection.visibility = View.GONE
        loginButton.isEnabled = true
    }

    private fun showLoggedIn() {
        loginSection.visibility = View.GONE
        operationSection.visibility = View.VISIBLE
    }

    private fun setBusy(busy: Boolean, message: String? = null) {
        runOnUiThread {
            loginButton.isEnabled = !busy
            refreshButton.isEnabled = !busy
            runButton.isEnabled = !busy && pendingIntents.isNotEmpty() && sessionToken != null
            logoutButton.isEnabled = !busy
            if (message != null) status.text = message
        }
    }

    private fun field(label: String, initial: String): EditText = EditText(this).apply {
        hint = label
        setText(initial)
        setSingleLine(true)
    }

    private fun defaultTerminalId(): String {
        val androidId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
            ?: "unknown"
        return "DEV-${androidId.takeLast(10)}"
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
