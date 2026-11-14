package br.com.koma.print.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.util.Log
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import br.com.koma.print.core.BluetoothPrinterDevice
import br.com.koma.print.core.EscPos58Renderer
import br.com.koma.print.core.JdkPrintAgentHttpTransport
import br.com.koma.print.core.KomaPrintAgentClient
import br.com.koma.print.core.OemCompatibilityPolicy

/**
 * Tela principal simplificada do operador KÔMA Print Android (Android 8.0+ / API 26+).
 *
 * Experiência sem digitação:
 * 1. Conexão automática via Deep Link (`koma-print://connect?...`) acionado pelo Caixa Web ou QR Code.
 * 2. Reconhecimento automático da impressora térmica Bluetooth (Kapbom KA-1445 58mm).
 * 3. Operação contínua em segundo plano com tela bloqueada (`KomaPrintForegroundService`).
 * 4. Botão de 1 toque para forçar reconexão Bluetooth e imprimir teste físico 58 mm.
 */
class MainActivity : Activity() {
    private lateinit var store: AgentPreferencesStore
    private lateinit var btAdapter: AndroidBluetoothSppAdapter

    // Componentes principais de UI
    private lateinit var connectionCard: LinearLayout
    private lateinit var connectionTitleView: TextView
    private lateinit var connectionDetailView: TextView
    private lateinit var disconnectButton: Button

    private lateinit var printerSpinner: Spinner
    private lateinit var printerStatusView: TextView

    private lateinit var serviceStatusView: TextView
    private lateinit var batteryStatusView: TextView
    private lateinit var startServiceBtn: Button
    private lateinit var stopServiceBtn: Button
    private lateinit var batteryExemptionBtn: Button

    // Seção avançada recolhível (fallback manual)
    private lateinit var advancedSection: LinearLayout
    private lateinit var toggleAdvancedBtn: Button
    private lateinit var backendUrlInput: EditText
    private lateinit var restauranteIdInput: EditText
    private lateinit var restaurantNameInput: EditText
    private lateinit var agentIdInput: EditText
    private lateinit var usernameInput: EditText
    private lateinit var passwordInput: EditText

    private var pairedPrinters: List<BluetoothPrinterDevice> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = AgentPreferencesStore(this)
        btAdapter = AndroidBluetoothSppAdapter(this)

        setContentView(buildContentView())
        requestMissingRuntimePermissions()
        refreshPairedPrinters()
        refreshUiFromStore()

        handleIncomingIntent(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        refreshPairedPrinters()
        refreshUiFromStore()
    }

    private fun handleIncomingIntent(intent: Intent?) {
        val data = intent?.data ?: return
        val scheme = data.scheme.orEmpty().lowercase()
        val host = data.host.orEmpty().lowercase()

        Log.i(TAG, "handleIncomingIntent: scheme=$scheme host=$host")

        if (scheme == "koma-print" && host == "connect") {
            val backendUrl = data.getQueryParameter("backend")
                ?.takeIf { it.isNotBlank() } ?: "https://sistema-gourmet-bistro-production.up.railway.app"
            val tenantId = data.getQueryParameter("tenant")?.toIntOrNull()
            val restaurantName = data.getQueryParameter("name")
                ?.takeIf { it.isNotBlank() } ?: "Restaurante KÔMA"
            val agentId = data.getQueryParameter("agent_id")
                ?.takeIf { it.isNotBlank() } ?: store.stableDeviceId()
            val token = data.getQueryParameter("token").orEmpty()

            if (tenantId == null || tenantId <= 0 || token.isBlank() ||
                !isSecureBackendUrl(backendUrl)
            ) {
                toast("Link inválido. Gere outro link nas configurações de impressão do KÔMA.")
                return
            }

            AlertDialog.Builder(this)
                .setTitle("Conectar ao KÔMA")
                .setMessage("Deseja conectar este celular como impressora do restaurante:\n\n• $restaurantName (Loja #$tenantId)\n• Agente: $agentId\n• Servidor: $backendUrl")
                .setPositiveButton("Confirmar Conexão") { _, _ ->
                    confirmConnection(
                        backendUrl = backendUrl,
                        tenantId = tenantId,
                        restaurantName = restaurantName,
                        agentId = agentId,
                        token = token,
                    )
                }
                .setNegativeButton("Cancelar", null)
                .show()
        } else if (scheme == "koma-print" && host == "start") {
            if (store.load().isConfigured && btAdapter.hasBluetoothPermission()) {
                runCatching { KomaPrintForegroundService.startService(this) }
                    .onSuccess { toast("Impressão automática ativada.") }
                    .onFailure { toast("Não foi possível iniciar. Abra o app para verificar.") }
            } else {
                requestMissingRuntimePermissions()
                toast("Vincule o restaurante e autorize Dispositivos próximos.")
            }
            refreshUiFromStore()
        }
    }

    private fun confirmConnection(
        backendUrl: String,
        tenantId: Int,
        restaurantName: String,
        agentId: String,
        token: String,
    ) {
        store.saveCredentials(
            backendUrl = backendUrl,
            agentId = agentId,
            agentToken = token,
            restauranteId = tenantId,
            restaurantName = restaurantName,
        )
        store.updateLastStatus("Conectado ao restaurante $restaurantName (#$tenantId).")
        Log.i(TAG, "Conexão confirmada com sucesso: $restaurantName (#$tenantId), agent=$agentId")

        if (btAdapter.hasBluetoothPermission()) {
            runCatching { KomaPrintForegroundService.startService(this) }
                .onFailure {
                    store.setAutoStartEnabled(false)
                    store.updateLastStatus("Vinculado; toque em Ativar impressão automática.")
                }
        } else {
            store.setAutoStartEnabled(false)
            requestMissingRuntimePermissions()
        }
        refreshUiFromStore()
        toast("Loja $restaurantName vinculada. Confira a impressora e faça um teste.")
    }

    private fun buildContentView(): ScrollView {
        val scroll = ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#0F172A"))
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = dp(16)
            setPadding(pad, pad, pad, pad)
        }

        // Cabeçalho
        val title = TextView(this).apply {
            text = "KÔMA Print 58mm"
            textSize = 22f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.parseColor("#F8FAFC"))
        }
        val subtitle = TextView(this).apply {
            text = "Pedidos automáticos • Impressora térmica Bluetooth 58 mm"
            textSize = 13f
            setTextColor(Color.parseColor("#94A3B8"))
            setPadding(0, dp(4), 0, dp(14))
        }
        root.addView(title)
        root.addView(subtitle)

        // 1. Card de Conexão com o Restaurante
        connectionCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = dp(14)
            setPadding(pad, pad, pad, pad)
            setBackgroundColor(Color.parseColor("#1E293B"))
        }
        connectionTitleView = TextView(this).apply {
            textSize = 16f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.parseColor("#10B981"))
        }
        connectionDetailView = TextView(this).apply {
            textSize = 13f
            setTextColor(Color.parseColor("#CBD5E1"))
            setPadding(0, dp(4), 0, dp(8))
        }
        disconnectButton = actionButton("Desconectar Loja", "#EF4444") {
            AlertDialog.Builder(this)
                .setTitle("Desconectar do Restaurante?")
                .setMessage("O celular deixará de receber pedidos de impressão deste caixa até ser reconectado.")
                .setPositiveButton("Desconectar") { _, _ ->
                    KomaPrintForegroundService.stopService(this)
                    store.clearCredentials()
                    toast("Celular desconectado.")
                    refreshUiFromStore()
                }
                .setNegativeButton("Cancelar", null)
                .show()
        }
        connectionCard.addView(connectionTitleView)
        connectionCard.addView(connectionDetailView)
        connectionCard.addView(disconnectButton)
        root.addView(connectionCard)

        // 2. Impressora Térmica Bluetooth (58mm)
        root.addView(sectionHeader("Impressora Térmica Bluetooth"))
        printerSpinner = Spinner(this).apply {
            setBackgroundColor(Color.parseColor("#FFFFFF"))
        }
        root.addView(printerSpinner)

        printerStatusView = TextView(this).apply {
            textSize = 12f
            setTextColor(Color.parseColor("#94A3B8"))
            setPadding(0, dp(4), 0, dp(8))
        }
        root.addView(printerStatusView)

        val btButtonsRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(4), 0, dp(12))
        }
        val testPrintBtn = actionButton("Imprimir Teste 58mm", "#0284C7") {
            runDirectSelfTestPrint()
        }
        val refreshBtBtn = actionButton("Atualizar Pareadas", "#334155") {
            requestMissingRuntimePermissions()
            refreshPairedPrinters()
        }
        btButtonsRow.addView(
            testPrintBtn,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.2f).apply {
                rightMargin = dp(6)
            },
        )
        btButtonsRow.addView(
            refreshBtBtn,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.8f),
        )
        root.addView(btButtonsRow)

        root.addView(actionButton("Abrir Bluetooth para parear", "#475569") {
            startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
        })
        root.addView(actionButton("Salvar impressora escolhida", "#0F766E") {
            val selected = saveSelectedPrinterPreference()
            if (selected == null) {
                toast("Pareie uma impressora nas configurações Bluetooth primeiro.")
            } else {
                toast("Impressora selecionada: " + selected.name)
                refreshPairedPrinters()
            }
        })

        // 3. Operação em Segundo Plano (Tela Bloqueada)
        root.addView(sectionHeader("Operação em Segundo Plano (Tela Bloqueada)"))
        serviceStatusView = TextView(this).apply {
            textSize = 14f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.parseColor("#10B981"))
            setPadding(0, 0, 0, dp(4))
        }
        root.addView(serviceStatusView)

        batteryStatusView = TextView(this).apply {
            textSize = 13f
            setTextColor(Color.parseColor("#CBD5E1"))
            setPadding(0, 0, 0, dp(8))
        }
        root.addView(batteryStatusView)

        batteryExemptionBtn = actionButton("Liberar Bateria do Fabricante (Sem Restrições)", "#D97706") {
            requestBatteryOptimizationExemption()
        }
        // Ajuste de bateria é opcional: fica em Avançado, não bloqueia o onboarding.
        val serviceRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(8), 0, dp(16))
        }
        startServiceBtn = actionButton("Ativar impressão automática", "#059669") {
            if (!btAdapter.hasBluetoothPermission()) {
                requestMissingRuntimePermissions()
                toast("Autorize Dispositivos próximos para imprimir por Bluetooth.")
            } else if (!store.load().isConfigured) {
                toast("Vincule primeiro o restaurante pelo Caixa KÔMA.")
            } else {
                saveSelectedPrinterPreference()
                runCatching { KomaPrintForegroundService.startService(this) }
                    .onSuccess { toast("Impressão automática ativada.") }
                    .onFailure {
                        store.setAutoStartEnabled(false)
                        toast("Não foi possível iniciar o serviço. Verifique as permissões.")
                    }
                refreshUiFromStore()
            }
        }
        stopServiceBtn = actionButton("Pausar Serviço", "#64748B") {
            KomaPrintForegroundService.stopService(this)
            toast("Serviço pausado.")
            refreshUiFromStore()
        }
        serviceRow.addView(
            startServiceBtn,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                rightMargin = dp(6)
            },
        )
        serviceRow.addView(
            stopServiceBtn,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f),
        )
        root.addView(serviceRow)

        // 4. Configuração Avançada (Recolhida por padrão)
        toggleAdvancedBtn = actionButton("Configuração Manual (Avançada) ▼", "#1E293B") {
            val isVisible = advancedSection.visibility == View.VISIBLE
            advancedSection.visibility = if (isVisible) View.GONE else View.VISIBLE
            toggleAdvancedBtn.text = if (isVisible) "Configuração Manual (Avançada) ▼" else "Ocultar Configuração Manual ▲"
        }
        root.addView(toggleAdvancedBtn)

        advancedSection = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
            val pad = dp(12)
            setPadding(pad, pad, pad, pad)
            setBackgroundColor(Color.parseColor("#1E293B"))
        }
        advancedSection.addView(sectionHeader("Bateria (opcional)"))
        advancedSection.addView(batteryExemptionBtn)

        backendUrlInput = labeledInput(advancedSection, "URL da API KÔMA", "https://sistema-gourmet-bistro-production.up.railway.app")
        restauranteIdInput = labeledInput(advancedSection, "ID do Restaurante", "", InputType.TYPE_CLASS_NUMBER)
        restaurantNameInput = labeledInput(advancedSection, "Nome da loja", "Restaurante KÔMA")
        agentIdInput = labeledInput(advancedSection, "Identificador deste Celular (Agent ID)", store.stableDeviceId())
        usernameInput = labeledInput(advancedSection, "E-mail / Usuário Operador KÔMA", "")
        passwordInput = labeledInput(
            advancedSection,
            "Senha do Operador KÔMA",
            "",
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD,
        )

        val manualLoginBtn = actionButton("Login e Vinculação Manual", "#16A34A") {
            performManualLoginAndRegister()
        }
        advancedSection.addView(manualLoginBtn)
        root.addView(advancedSection)

        scroll.addView(root)
        return scroll
    }

    private fun refreshUiFromStore() {
        val cfg = store.load()
        val batteryOk = isIgnoringBatteryOptimizations()

        if (cfg.isConfigured) {
            connectionTitleView.text = "● Vinculado: ${cfg.restaurantName} (#${cfg.restauranteId})"
            connectionTitleView.setTextColor(Color.parseColor("#10B981"))
            connectionDetailView.text = "Agente: ${cfg.agentId}\nServidor: ${cfg.backendUrl}\nStatus: ${cfg.lastStatusSummary}"
            disconnectButton.visibility = View.VISIBLE
        } else {
            connectionTitleView.text = "● Aguardando Conexão do Caixa"
            connectionTitleView.setTextColor(Color.parseColor("#F59E0B"))
            connectionDetailView.text = "No Caixa do restaurante, acesse Configurações -> Impressão e clique em 'Conectar Celular' para vincular com 1 toque."
            disconnectButton.visibility = View.GONE
        }

        backendUrlInput.setText(cfg.backendUrl)
        restauranteIdInput.setText(cfg.restauranteId.toString())
        restaurantNameInput.setText(cfg.restaurantName)
        agentIdInput.setText(cfg.agentId)

        if (cfg.autoStartEnabled && cfg.isConfigured) {
            val lastContact = cfg.lastBackendContactEpochMs
            val recentlyOnline = lastContact > 0L &&
                (System.currentTimeMillis() - lastContact) in 0L..120_000L
            serviceStatusView.text = if (recentlyOnline) {
                "● KÔMA online • monitorando pedidos"
            } else {
                "○ Iniciado • aguardando resposta do KÔMA"
            }
            serviceStatusView.setTextColor(Color.parseColor(if (recentlyOnline) "#10B981" else "#F59E0B"))
            startServiceBtn.visibility = View.GONE
            stopServiceBtn.visibility = View.VISIBLE
        } else {
            serviceStatusView.text = "○ Impressão automática pausada"
            serviceStatusView.setTextColor(Color.parseColor("#94A3B8"))
            startServiceBtn.visibility = View.VISIBLE
            stopServiceBtn.visibility = View.GONE
        }

        if (batteryOk) {
            batteryStatusView.text = "✓ Bateria sem restrições extras."
            batteryStatusView.setTextColor(Color.parseColor("#CBD5E1"))
            batteryExemptionBtn.visibility = View.GONE
        } else {
            batteryStatusView.text = "Se os pedidos pararem com a tela bloqueada, veja Bateria em Avançado."
            batteryStatusView.setTextColor(Color.parseColor("#94A3B8"))
            batteryExemptionBtn.visibility = View.VISIBLE
        }
    }

    private fun refreshPairedPrinters() {
        pairedPrinters = btAdapter.listPairedSppPrinters()
        val cfg = store.load()
        val labels = if (pairedPrinters.isEmpty()) {
            listOf("Nenhuma impressora Bluetooth pareada encontrada")
        } else {
            pairedPrinters.map { p ->
                "${p.name} (${p.normalizedAddress}) • ${p.profile.paperWidthMm}mm/${p.profile.columns}col"
            }
        }
        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)
        printerSpinner.adapter = adapter

        if (pairedPrinters.isNotEmpty()) {
            val savedIndex = pairedPrinters.indexOfFirst {
                it.normalizedAddress.equals(cfg.preferredPrinterAddress, ignoreCase = true)
            }
            if (savedIndex >= 0) {
                printerSpinner.setSelection(savedIndex)
                val chosen = pairedPrinters[savedIndex]
                printerStatusView.text = "Escolhida: " + chosen.name + " • pronta para tentativa Bluetooth."
            } else if (cfg.preferredPrinterAddress.isNotBlank()) {
                printerSpinner.setSelection(0)
                printerStatusView.text = "Impressora anterior não encontrada (" +
                    cfg.preferredPrinterName + "). Pareie ou salve outra."
            } else if (pairedPrinters.size == 1) {
                val chosen = pairedPrinters.first()
                printerSpinner.setSelection(0)
                store.savePreferredPrinter(chosen.name, chosen.normalizedAddress)
                printerStatusView.text = "Detectada: " + chosen.name + " • pronta para teste."
            } else {
                printerSpinner.setSelection(0)
                printerStatusView.text = "Escolha a impressora e toque em Salvar impressora escolhida."
            }
        } else {
            printerStatusView.text = if (!btAdapter.hasBluetoothPermission()) {
                "Autorize Dispositivos próximos para ver as impressoras pareadas."
            } else {
                "Nenhuma impressora pareada. Use Abrir Bluetooth para parear."
            }
        }
    }

    private fun saveSelectedPrinterPreference(): BluetoothPrinterDevice? {
        if (pairedPrinters.isEmpty()) return null
        val idx = printerSpinner.selectedItemPosition.coerceIn(0, pairedPrinters.lastIndex)
        val selected = pairedPrinters[idx]
        store.savePreferredPrinter(selected.name, selected.normalizedAddress)
        return selected
    }

    private fun runDirectSelfTestPrint() {
        val target = saveSelectedPrinterPreference()
        if (target == null) {
            toast("Pareie a impressora Kapbom KA-1445 nas configurações Bluetooth do Android primeiro.")
            return
        }
        val cfg = store.load()
        val restaurantName = cfg.restaurantName.ifBlank { "KOMA GOURMET" }
        toast("Enviando teste 58mm para ${target.name}...")
        Log.i(TAG, "Disparando teste de impressão física 58mm para ${target.name} (${target.normalizedAddress})")

        Thread {
            val payload = EscPos58Renderer.buildKapbomSelfTestPayload(
                restaurantName = restaurantName,
                printerName = target.name,
                printerAddress = target.normalizedAddress,
            )
            val result = btAdapter.sendRawPayload(target, payload)
            runOnUiThread {
                if (result.success) {
                    val msg = "Teste enviado à impressora. Confira se o papel saiu corretamente."
                    store.updateLastStatus(msg)
                    toast(msg)
                    Log.i(TAG, msg)
                } else {
                    val msg = result.errorMessage ?: "Falha ao imprimir na ${target.name}."
                    store.updateLastStatus(msg)
                    toast(msg)
                    Log.e(TAG, "Falha no teste: $msg")
                }
                refreshUiFromStore()
            }
        }.start()
    }

    private fun performManualLoginAndRegister() {
        val backendUrl = backendUrlInput.text?.toString()?.trim()?.trimEnd('/').orEmpty()
        val restauranteId = restauranteIdInput.text?.toString()?.trim()?.toIntOrNull()
        val restaurantName = restaurantNameInput.text?.toString()?.trim().orEmpty().ifBlank { "Restaurante KÔMA" }
        val agentId = agentIdInput.text?.toString()?.trim().orEmpty().ifBlank { store.stableDeviceId() }
        val username = usernameInput.text?.toString()?.trim().orEmpty()
        val password = passwordInput.text?.toString().orEmpty()

        if (!isSecureBackendUrl(backendUrl) || restauranteId == null ||
            restauranteId <= 0 || username.isBlank() || password.isBlank()
        ) {
            toast("Informe URL HTTPS, ID da loja, usuário e senha do KÔMA.")
            return
        }

        saveSelectedPrinterPreference()
        toast("Vinculando agente $agentId ao KÔMA...")

        Thread {
            try {
                val transport = JdkPrintAgentHttpTransport(baseUrl = backendUrl)
                val client = KomaPrintAgentClient(transport = transport, agentTokenProvider = { "" })
                val credentials = client.loginAndRegisterAgent(
                    username = username,
                    password = password,
                    restauranteId = restauranteId,
                    requestedAgentId = agentId,
                )
                store.saveCredentials(
                    backendUrl = backendUrl,
                    agentId = credentials.agentId,
                    agentToken = credentials.agentToken,
                    restauranteId = credentials.restauranteId,
                    restaurantName = restaurantName,
                )
                store.updateLastStatus("Agente ${credentials.agentId} vinculado ao Restaurante #${credentials.restauranteId}.")
                runOnUiThread {
                    passwordInput.setText("")
                    if (btAdapter.hasBluetoothPermission()) {
                        runCatching { KomaPrintForegroundService.startService(this) }
                            .onFailure { store.setAutoStartEnabled(false) }
                    } else {
                        store.setAutoStartEnabled(false)
                        requestMissingRuntimePermissions()
                    }
                    refreshUiFromStore()
                    toast("Celular vinculado. Confira a impressora e faça um teste.")
                }
            } catch (err: Throwable) {
                runOnUiThread {
                    val msg = "Erro ao vincular: ${err.message ?: "falha de rede"}"
                    store.updateLastStatus(msg)
                    refreshUiFromStore()
                    toast(msg)
                }
            }
        }.start()
    }

    private fun isSecureBackendUrl(raw: String): Boolean {
        val parsed = runCatching { Uri.parse(raw.trim()) }.getOrNull() ?: return false
        return parsed.scheme.equals("https", ignoreCase = true) &&
            !parsed.host.isNullOrBlank() &&
            !parsed.authority.orEmpty().contains("@")
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_PERMISSIONS_CODE) {
            refreshPairedPrinters()
            if (btAdapter.hasBluetoothPermission() && store.load().isConfigured &&
                !store.load().autoStartEnabled
            ) {
                runCatching { KomaPrintForegroundService.startService(this) }
                    .onFailure { store.setAutoStartEnabled(false) }
            }
            refreshUiFromStore()
        }
    }

    private fun requestMissingRuntimePermissions() {
        val needed = OemCompatibilityPolicy.requiredRuntimePermissions(Build.VERSION.SDK_INT)
            .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (needed.isNotEmpty()) {
            requestPermissions(needed.toTypedArray(), REQUEST_PERMISSIONS_CODE)
        }
    }

    private fun isIgnoringBatteryOptimizations(): Boolean {
        val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
        return pm.isIgnoringBatteryOptimizations(packageName)
    }

    private fun requestBatteryOptimizationExemption() {
        if (isIgnoringBatteryOptimizations()) {
            return
        }
        runCatching {
            val intent = Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:$packageName"),
            )
            startActivity(intent)
        }.onFailure {
            runCatching {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }
        }
    }

    private fun sectionHeader(title: String): TextView = TextView(this).apply {
        text = title
        textSize = 15f
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(Color.parseColor("#38BDF8"))
        setPadding(0, dp(14), 0, dp(6))
    }

    private fun labeledInput(
        parent: LinearLayout,
        label: String,
        defaultValue: String,
        inputTypeFlags: Int = InputType.TYPE_CLASS_TEXT,
    ): EditText {
        val labelView = TextView(this).apply {
            text = label
            textSize = 12f
            setTextColor(Color.parseColor("#CBD5E1"))
            setPadding(0, dp(6), 0, dp(2))
        }
        val edit = EditText(this).apply {
            setText(defaultValue)
            inputType = inputTypeFlags
            setTextColor(Color.parseColor("#0F172A"))
            setBackgroundColor(Color.parseColor("#F8FAFC"))
            val pad = dp(10)
            setPadding(pad, pad, pad, pad)
        }
        parent.addView(labelView)
        parent.addView(edit)
        return edit
    }

    private fun actionButton(label: String, hexColor: String, onClick: () -> Unit): Button =
        Button(this).apply {
            text = label
            isAllCaps = false
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor(hexColor))
            setOnClickListener { onClick() }
        }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val TAG = "KomaPrint"
        private const val REQUEST_PERMISSIONS_CODE = 5802
    }
}
