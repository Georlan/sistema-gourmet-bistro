package br.com.koma.print.app

import android.app.Activity
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
 * Tela principal do operador KÔMA Print Android (Android 8.0+ / API 26+).
 *
 * Permite:
 * 1. Conceder permissões Bluetooth (`BLUETOOTH_CONNECT` / `BLUETOOTH_SCAN` no Android 12+).
 * 2. Selecionar a impressora Bluetooth Classic SPP pareada (destacando a Kapbom KA-1445 58 mm).
 * 3. Vincular o celular ao restaurante no KÔMA (`/auth/login` + `/api/print-agents/register`).
 * 4. Imprimir um cupom de teste 58 mm (32 colunas) diretamente na impressora pareada.
 * 5. Desativar restrição de bateria do fabricante (Samsung, Xiaomi, Motorola, Realme) e
 *    iniciar o `KomaPrintForegroundService` para impressão com a tela bloqueada.
 */
class MainActivity : Activity() {
    private lateinit var store: AgentPreferencesStore
    private lateinit var btAdapter: AndroidBluetoothSppAdapter

    private lateinit var statusTextView: TextView
    private lateinit var batteryGuidanceView: TextView
    private lateinit var backendUrlInput: EditText
    private lateinit var restauranteIdInput: EditText
    private lateinit var restaurantNameInput: EditText
    private lateinit var agentIdInput: EditText
    private lateinit var usernameInput: EditText
    private lateinit var passwordInput: EditText
    private lateinit var printerSpinner: Spinner

    private var pairedPrinters: List<BluetoothPrinterDevice> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = AgentPreferencesStore(this)
        btAdapter = AndroidBluetoothSppAdapter(this)

        setContentView(buildContentView())
        requestMissingRuntimePermissions()
        refreshUiFromStore()
        refreshPairedPrinters()
    }

    override fun onResume() {
        super.onResume()
        refreshUiFromStore()
        refreshPairedPrinters()
    }

    private fun buildContentView(): ScrollView {
        val scroll = ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#0F172A"))
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = dp(18)
            setPadding(pad, pad, pad, pad)
        }

        val title = TextView(this).apply {
            text = "KÔMA Print Android • 58mm"
            textSize = 21f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.parseColor("#F8FAFC"))
        }
        val subtitle = TextView(this).apply {
            text = "Impressão direta Bluetooth SPP (Kapbom KA-1445) sem computador e sem RawBT."
            textSize = 13f
            setTextColor(Color.parseColor("#94A3B8"))
            setPadding(0, dp(4), 0, dp(14))
        }
        root.addView(title)
        root.addView(subtitle)

        statusTextView = TextView(this).apply {
            textSize = 14f
            setTextColor(Color.parseColor("#E2E8F0"))
            setBackgroundColor(Color.parseColor("#1E293B"))
            val pad = dp(12)
            setPadding(pad, pad, pad, pad)
        }
        root.addView(statusTextView)

        // Seção 1: Impressora Bluetooth SPP
        root.addView(sectionHeader("1. Impressora Térmica Bluetooth (58 mm)"))
        printerSpinner = Spinner(this).apply {
            setBackgroundColor(Color.parseColor("#FFFFFF"))
        }
        root.addView(printerSpinner)

        val btButtonsRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(8), 0, dp(4))
        }
        val refreshBtBtn = actionButton("Atualizar Pareadas", "#334155") {
            requestMissingRuntimePermissions()
            refreshPairedPrinters()
        }
        val testPrintBtn = actionButton("Imprimir Teste 58mm", "#0284C7") {
            runDirectSelfTestPrint()
        }
        btButtonsRow.addView(
            refreshBtBtn,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                rightMargin = dp(6)
            },
        )
        btButtonsRow.addView(
            testPrintBtn,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f),
        )
        root.addView(btButtonsRow)

        // Seção 2: Vinculação KÔMA
        root.addView(sectionHeader("2. Vincular ao Restaurante no KÔMA"))
        backendUrlInput = labeledInput(root, "URL da API KÔMA", "https://api.komagourmet.com.br")
        restauranteIdInput = labeledInput(
            root,
            "ID do Restaurante (ex.: 1 para JE Lanches)",
            "1",
            InputType.TYPE_CLASS_NUMBER,
        )
        restaurantNameInput = labeledInput(root, "Nome no Cupom", "JE LANCHES")
        agentIdInput = labeledInput(root, "Identificador deste Celular (Agent ID)", "android-je-lanches-01")
        usernameInput = labeledInput(root, "E-mail / Usuário Operador KÔMA", "")
        passwordInput = labeledInput(
            root,
            "Senha do Operador KÔMA",
            "",
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD,
        )

        val registerBtn = actionButton("Vincular Celular e Ativar Impressão Automática", "#16A34A") {
            performLoginAndRegister()
        }
        root.addView(registerBtn)

        // Seção 3: Operação com Tela Bloqueada e Bateria OEM
        root.addView(sectionHeader("3. Operação com Celular Bloqueado"))
        batteryGuidanceView = TextView(this).apply {
            text = OemCompatibilityPolicy.lockScreenGuidanceForManufacturer(Build.MANUFACTURER)
            textSize = 13f
            setTextColor(Color.parseColor("#FDE68A"))
            setPadding(0, 0, 0, dp(8))
        }
        root.addView(batteryGuidanceView)

        val batteryBtn = actionButton("Liberar Economia de Bateria (Sem Restrições)", "#D97706") {
            requestBatteryOptimizationExemption()
        }
        root.addView(batteryBtn)

        val serviceRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(8), 0, dp(16))
        }
        val startServiceBtn = actionButton("Iniciar Serviço 2º Plano", "#059669") {
            saveSelectedPrinterPreference()
            KomaPrintForegroundService.startService(this)
            toast("Serviço KÔMA Print iniciado em segundo plano.")
            refreshUiFromStore()
        }
        val stopServiceBtn = actionButton("Pausar Serviço", "#DC2626") {
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

        scroll.addView(root)
        return scroll
    }

    private fun refreshUiFromStore() {
        val cfg = store.load()
        backendUrlInput.setText(cfg.backendUrl)
        restauranteIdInput.setText(cfg.restauranteId.toString())
        restaurantNameInput.setText(cfg.restaurantName)
        agentIdInput.setText(cfg.agentId)

        val tokenState = if (cfg.agentToken.isNotBlank()) "Vinculado" else "Não vinculado"
        val batteryState = if (isIgnoringBatteryOptimizations()) {
            "Livre de restrição"
        } else {
            "Pendente liberar bateria"
        }
        statusTextView.text = buildString {
            appendLine("Estado do Agente: $tokenState (Restaurante #${cfg.restauranteId})")
            appendLine("Impressora Preferida: ${cfg.preferredPrinterName} (${cfg.preferredPrinterAddress.ifBlank { "automática" }})")
            appendLine("Bateria / Tela Bloqueada: $batteryState")
            append("Último Status: ${cfg.lastStatusSummary}")
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
            val idx = pairedPrinters.indexOfFirst {
                it.normalizedAddress.equals(cfg.preferredPrinterAddress, ignoreCase = true)
            }.takeIf { it >= 0 } ?: 0
            printerSpinner.setSelection(idx)
            val chosen = pairedPrinters[idx]
            store.savePreferredPrinter(chosen.name, chosen.normalizedAddress)
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
        val restaurantName = restaurantNameInput.text?.toString().orEmpty().ifBlank { "JE LANCHES" }
        toast("Enviando teste 58mm para ${target.name}...")

        Thread {
            val payload = EscPos58Renderer.buildKapbomSelfTestPayload(
                restaurantName = restaurantName,
                printerName = target.name,
                printerAddress = target.normalizedAddress,
            )
            val result = btAdapter.sendRawPayload(target, payload)
            runOnUiThread {
                if (result.success) {
                    val msg = "Teste 58mm impresso com sucesso em ${target.name} (${result.bytesWritten} bytes)."
                    store.updateLastStatus(msg)
                    toast(msg)
                } else {
                    val msg = result.errorMessage ?: "Falha ao imprimir na ${target.name}."
                    store.updateLastStatus(msg)
                    toast(msg)
                }
                refreshUiFromStore()
            }
        }.start()
    }

    private fun performLoginAndRegister() {
        val backendUrl = backendUrlInput.text?.toString()?.trim().orEmpty()
        val restauranteId = restauranteIdInput.text?.toString()?.trim()?.toIntOrNull() ?: 1
        val restaurantName = restaurantNameInput.text?.toString()?.trim().orEmpty().ifBlank { "JE LANCHES" }
        val agentId = agentIdInput.text?.toString()?.trim().orEmpty().ifBlank { "android-je-lanches-01" }
        val username = usernameInput.text?.toString()?.trim().orEmpty()
        val password = passwordInput.text?.toString().orEmpty()

        if (backendUrl.isBlank() || username.isBlank() || password.isBlank()) {
            toast("Preencha URL da API, usuário/e-mail e senha do operador KÔMA.")
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
                    KomaPrintForegroundService.startService(this)
                    refreshUiFromStore()
                    toast("Celular vinculado com sucesso! Impressão automática ativada.")
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
            toast("Otimização de bateria já está desativada para o KÔMA Print.")
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
        setPadding(0, dp(16), 0, dp(6))
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
        private const val REQUEST_PERMISSIONS_CODE = 5802
    }
}
