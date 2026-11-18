package br.com.koma.smartpos.dev

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextUtils
import android.text.TextWatcher
import android.util.AtomicFile
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import br.com.koma.smartpos.bridge.FakeTerminalPaymentBridge
import br.com.koma.smartpos.bridge.JdkHttpTransport
import br.com.koma.smartpos.bridge.KomaTerminalBackendApi
import br.com.koma.smartpos.bridge.LocalOperation
import br.com.koma.smartpos.bridge.OperationStore
import br.com.koma.smartpos.bridge.PaymentOutcome
import br.com.koma.smartpos.bridge.PlugPagTerminalPaymentBridge
import br.com.koma.smartpos.bridge.StableOperationKey
import br.com.koma.smartpos.bridge.TerminalCoordinator
import br.com.koma.smartpos.bridge.TerminalPaymentResult
import br.com.koma.smartpos.bridge.TerminalRuntime
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

private enum class Screen {
    LOGIN,
    SALON,
    TABLE,
    MENU,
    CUSTOMIZE,
    REVIEW,
    PAYMENT,
    HISTORY,
}

private enum class PaymentScope(val apiValue: String, val label: String) {
    VALUE("valor", "Por valor"),
    ITEMS("itens", "Por itens"),
}

private enum class PaymentMethod(val apiValue: String, val label: String) {
    CREDIT("credito", "Crédito"),
    DEBIT("debito", "Débito"),
    PIX("pix", "Pix"),
    CASH("dinheiro", "Dinheiro"),
}

private enum class CaptureOption {
    INTEGRATED_PAGBANK,
    EXTERNAL_POS,
    CASH_MANUAL,
}

private object KomaColors {
    const val HEADER = 0xFF06392C.toInt()
    const val CANVAS = 0xFF0D1D17.toInt()
    const val SURFACE = 0xFF192D24.toInt()
    const val RAISED = 0xFF28463A.toInt()
    const val CARD_BORDER = 0xFF2D4D3E.toInt()
    const val INK = 0xFFFFFFFF.toInt()
    const val INK_MUTED = 0xFFA2C4B7.toInt()
    const val ACCENT = 0xFF35D9B0.toInt()
    const val ACCENT_DARK = 0xFF05C49D.toInt()
    const val ACCENT_INK = 0xFF06251D.toInt()

    const val FREE_CAP = 0xFF2B5141.toInt()
    const val FREE_INK = 0xFFB8E2D0.toInt()
    const val READY_CAP = 0xFF67DCB2.toInt()
    const val READY_BORDER = 0xFF72EBC3.toInt()
    const val READY_INK = 0xFF06251D.toInt()
    const val OCCUPIED_CAP = 0xFFD9A9B8.toInt()
    const val OCCUPIED_BORDER = 0xFFF3A3B8.toInt()
    const val OCCUPIED_INK = 0xFF2A111A.toInt()
    const val PAYMENT_CAP = 0xFFA7CFE8.toInt()
    const val PAYMENT_BORDER = 0xFF9AD5FF.toInt()
    const val PAYMENT_INK = 0xFF0F2533.toInt()
    const val SERVED_CAP = 0xFF47866D.toInt()
    const val SERVED_INK = 0xFFFFFFFF.toInt()
    const val WARN_BG = 0xFF4E3D16.toInt()
    const val WARN_INK = 0xFFFBE5A6.toInt()
    const val DANGER_BG = 0xFF5D232A.toInt()
    const val DANGER_BORDER = 0xFFB9545E.toInt()
    const val DANGER_INK = 0xFFFFD8DC.toInt()
    const val DISABLED_BG = 0xFF1F3129.toInt()
    const val DISABLED_INK = 0xFF6F8F81.toInt()
}

private data class RemovedDraftEntry(
    val tableId: Int,
    val index: Int,
    val line: Line,
)

private data class ActiveTerminalIntent(
    val intent: PaymentIntentPreview,
    val operationKey: String,
    val table: Table,
    val simulatedBackend: Boolean,
)

internal class AndroidOperationStore(private val directory: File) : OperationStore {
    override fun get(operationKey: String): LocalOperation? {
        val target = file(operationKey)
        if (!target.exists()) return null
        return runCatching {
            val bytes = runCatching { AtomicFile(target).readFully() }.getOrElse { target.readBytes() }
            val obj = JSONObject(bytes.toString(Charsets.UTF_8))
            val lastOutcome = if (obj.isNull("lastOutcome")) null else obj.optString("lastOutcome").ifBlank { null }
            val lastResult = lastOutcome?.let { outcomeName ->
                TerminalPaymentResult(
                    outcome = PaymentOutcome.valueOf(outcomeName),
                    reference = if (obj.isNull("lastReference")) null else obj.optString("lastReference").ifBlank { null },
                    message = if (obj.isNull("lastMessage")) null else obj.optString("lastMessage").ifBlank { null },
                )
            }
            LocalOperation(
                intentId = obj.getString("intentId"),
                provider = obj.getString("provider"),
                operationKey = obj.getString("operationKey"),
                terminalId = obj.getString("terminalId"),
                started = obj.optBoolean("started", true),
                lastResult = lastResult,
            )
        }.getOrNull()
    }

    override fun put(operation: LocalOperation) {
        directory.mkdirs()
        val target = file(operation.operationKey)
        val obj = JSONObject()
            .put("intentId", operation.intentId)
            .put("provider", operation.provider)
            .put("operationKey", operation.operationKey)
            .put("terminalId", operation.terminalId)
            .put("started", operation.started)
        operation.lastResult?.let { result ->
            obj.put("lastOutcome", result.outcome.name)
            obj.put("lastReference", result.reference ?: JSONObject.NULL)
            obj.put("lastMessage", result.message ?: JSONObject.NULL)
        }
        val payload = obj.toString().toByteArray(Charsets.UTF_8)
        val atomicOk = runCatching {
            val atomic = AtomicFile(target)
            val stream = atomic.startWrite()
            try {
                stream.write(payload)
                atomic.finishWrite(stream)
            } catch (exc: Exception) {
                atomic.failWrite(stream)
                throw exc
            }
            true
        }.getOrDefault(false)
        if (!atomicOk) {
            val tmp = File(target.parentFile, "${target.name}.tmp")
            tmp.writeBytes(payload)
            if (!tmp.renameTo(target)) {
                target.writeBytes(payload)
                tmp.delete()
            }
        }
    }

    private fun file(operationKey: String): File {
        val hash = MessageDigest.getInstance("SHA-256").digest(operationKey.toByteArray(Charsets.UTF_8))
        return File(directory, "smartpos-op-${hash.joinToString("") { "%02x".format(it) }}")
    }
}

class MainActivity : Activity() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val destroyed = AtomicBoolean(false)
    private lateinit var executor: ExecutorService

    private val apiUrl = BuildConfig.KOMA_API_URL
    private val transport = JdkHttpTransport(apiUrl, { activeToken })
    private val api by lazy { WaiterApi(transport) }
    private val terminalBackend by lazy { KomaTerminalBackendApi(transport) }

    private lateinit var terminalStore: TerminalSessionStore
    private lateinit var draftStore: DraftStore
    private lateinit var orderStore: PendingOrderStore
    private lateinit var operationStore: AndroidOperationStore
    private lateinit var plugPagClient: AndroidPlugPagClient

    private lateinit var root: LinearLayout

    private var activeToken = ""
    private lateinit var terminalState: TerminalState
    private var session: Session? = null
    private var restaurants: List<Restaurant> = emptyList()
    private var selectedRestaurant: Restaurant? = null
    private var screen = Screen.LOGIN

    private var salonSummaries: List<TableSummary> = emptyList()
    private var salonFilter = SalonFilter.ALL
    private var cachedMenu: Menu? = null
    private var activeTable: Table? = null
    private var tableDetail: TableDetail? = null
    private var selectedCheckFilterId: String? = null
    private var orderTargetCheckId: String? = null
    private var newOrderCheckName: String = ""

    private var activeCategory: Category? = null
    private var customizingVariants: List<Product> = emptyList()
    private var customizingProduct: Product? = null
    private var customizingOptions: MutableList<Option> = mutableListOf()
    private var customizingNote: String = ""
    private var customizingClientName: String = ""
    private var customizingQuantity: Int = 1
    private var editingDraftIndex: Int? = null

    private var drafts: MutableMap<Int, MutableList<Line>> = mutableMapOf()
    private var lastRemovedDraft: RemovedDraftEntry? = null
    private var pendingOrder: PendingOrder? = null

    private var paymentScope = PaymentScope.VALUE
    private var paymentMethod = PaymentMethod.CREDIT
    private var paymentCapture = CaptureOption.EXTERNAL_POS
    private var paymentAmountCents: Long = 0L
    private var paymentSelectedItemIds: MutableSet<String> = mutableSetOf()
    private var cashReceivedCents: Long? = null
    private var activeTerminalIntent: ActiveTerminalIntent? = null

    private var recentOps: List<RecentOperation> = emptyList()

    private var usernameDraft: String = ""
    private var passwordDraft: String = ""
    private var busy = false
    private var loadingText: String? = null
    private var bannerMessage: String? = null
    private var bannerError = false
    private var bannerRetryAction: (() -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        @Suppress("DEPRECATION")
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.statusBarColor = KomaColors.HEADER
            window.navigationBarColor = KomaColors.CANVAS
        }

        executor = Executors.newCachedThreadPool()
        terminalStore = TerminalSessionStore(filesDir)
        draftStore = DraftStore(filesDir)
        orderStore = PendingOrderStore(filesDir)
        operationStore = AndroidOperationStore(File(filesDir, "terminal-ops"))
        plugPagClient = AndroidPlugPagClient(this)

        terminalState = terminalStore.load(apiUrl)
        pendingOrder = orderStore.load(apiUrl)

        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(KomaColors.CANVAS)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            setOnApplyWindowInsetsListener { view, insets ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                    view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                } else {
                    @Suppress("DEPRECATION")
                    view.setPadding(
                        insets.systemWindowInsetLeft,
                        insets.systemWindowInsetTop,
                        insets.systemWindowInsetRight,
                        insets.systemWindowInsetBottom,
                    )
                }
                insets
            }
        }
        setContentView(root)

        val restored = terminalState.activeOperator
        if (restored != null && restored.hasActiveToken()) {
            activeToken = restored.token
            usernameDraft = restored.username
            restoreBoundSession(restored)
        } else {
            val fallbackUser = terminalState.operators.firstOrNull()
            usernameDraft = fallbackUser?.username.orEmpty()
            render()
        }
    }

    override fun onDestroy() {
        destroyed.set(true)
        mainHandler.removeCallbacksAndMessages(null)
        executor.shutdownNow()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (busy) return
        when (screen) {
            Screen.CUSTOMIZE -> {
                editingDraftIndex = null
                screen = if (cachedMenu != null) Screen.MENU else Screen.SALON
            }
            Screen.REVIEW -> {
                screen = if (cachedMenu != null) Screen.MENU else Screen.TABLE
            }
            Screen.MENU -> {
                screen = if (tableDetail != null) Screen.TABLE else Screen.SALON
            }
            Screen.PAYMENT -> {
                if (activeTerminalIntent != null) return
                screen = Screen.TABLE
            }
            Screen.TABLE, Screen.HISTORY -> {
                screen = Screen.SALON
            }
            Screen.SALON, Screen.LOGIN -> {
                @Suppress("DEPRECATION")
                super.onBackPressed()
                return
            }
        }
        clearBanner()
        render()
    }

    private fun draftScope(): String {
        val restId = session?.restaurant?.id ?: terminalState.boundRestaurant?.id ?: 0
        return "$apiUrl|r:$restId"
    }

    private fun loadDraftsForCurrentRestaurant() {
        val loaded = draftStore.load(draftScope())
        drafts = loaded
    }

    private fun saveDrafts() {
        draftStore.save(draftScope(), drafts)
    }

    private fun restoreBoundSession(saved: SavedOperatorSession) {
        loadingText = "Conectando terminal ao KÔMA..."
        screen = Screen.SALON
        render()
        runAsync {
            val loadedSession = api.session()
            val tables = if (loadedSession.tablesAvailable) api.salon() else emptyList()
            val preloadedMenu = if (loadedSession.ordersAvailable) runCatching { api.menu() }.getOrNull() else null
            loadedSession to (tables to preloadedMenu)
        }.onSuccess { (loadedSession, data) ->
            val (tables, preloadedMenu) = data
            terminalState = terminalStore.saveLogin(apiUrl, loadedSession, saved.username, activeToken)
            session = loadedSession
            restaurants = emptyList()
            selectedRestaurant = loadedSession.restaurant
            salonSummaries = tables
            if (preloadedMenu != null) cachedMenu = preloadedMenu
            loadDraftsForCurrentRestaurant()
            loadingText = null
            screen = Screen.SALON
            clearBanner()
            render()
        }.onFailure { err ->
            loadingText = null
            if (err is ApiFailure && err.requiresReauth) {
                terminalState = terminalStore.invalidateOperatorToken(apiUrl, saved.operator.id)
                activeToken = ""
                session = null
                usernameDraft = saved.username
                screen = Screen.LOGIN
                setError(err.message)
                render()
            } else {
                // Keep operator selected with cached identity and allow explicit retry on network issues.
                session = Session(
                    restaurant = saved.restaurant,
                    operator = saved.operator,
                    tablesAvailable = true,
                    ordersAvailable = true,
                    role = saved.role,
                )
                loadDraftsForCurrentRestaurant()
                screen = Screen.SALON
                setError(messageFor(err), retry = { restoreBoundSession(saved) })
                render()
            }
        }
    }

    private fun render() {
        root.removeAllViews()
        when (screen) {
            Screen.LOGIN -> renderLogin()
            Screen.SALON -> renderSalon()
            Screen.TABLE -> renderTable()
            Screen.MENU -> renderMenu()
            Screen.CUSTOMIZE -> renderCustomize()
            Screen.REVIEW -> renderReview()
            Screen.PAYMENT -> renderPayment()
            Screen.HISTORY -> renderHistory()
        }
    }

    // -------------------------------------------------------------------------
    // SCREEN: LOGIN & TERMINAL BINDING
    // -------------------------------------------------------------------------

    private fun renderLogin() {
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f,
            )
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(24), dp(20), dp(24))
        }

        val bound = terminalState.boundRestaurant
        val headerCard = cardLayout(KomaColors.HEADER, KomaColors.CARD_BORDER, pad = 18).apply {
            addView(textView("KÔMA SmartPOS", 22f, bold = true, color = KomaColors.INK))
            addView(
                textView(
                    if (bound != null) {
                        "Terminal ${terminalState.terminalId} vinculado a ${bound.name}"
                    } else {
                        "Terminal ${terminalState.terminalId} · Salão, pedidos e PagBank"
                    },
                    13f,
                    color = KomaColors.FREE_INK,
                ).apply { topMargin(6) },
            )
        }
        content.addView(headerCard)

        bannerMessage?.let { msg ->
            content.addView(bannerView(msg, bannerError, bannerRetryAction).apply { topMargin(14) })
        }

        val savedOps = terminalState.operators
        if (savedOps.isNotEmpty()) {
            val opsCard = cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 16).apply {
                topMargin(16)
                addView(textView("Operadores neste terminal", 15f, bold = true))
                savedOps.forEach { op ->
                    val hasToken = op.hasActiveToken()
                    val rowBtn = buildActionButton(
                        title = if (hasToken) {
                            "Entrar como ${op.operator.name}"
                        } else {
                            "${op.operator.name} · confirmar senha"
                        },
                        bgColor = if (hasToken) KomaColors.RAISED else KomaColors.SURFACE,
                        textColor = KomaColors.INK,
                        borderColor = if (hasToken) KomaColors.ACCENT else KomaColors.CARD_BORDER,
                        enabled = !busy,
                    ) {
                        if (hasToken) {
                            activeToken = op.token
                            terminalState = terminalStore.switchOperator(apiUrl, op.operator.id)
                            usernameDraft = op.username
                            passwordDraft = ""
                            restoreBoundSession(op)
                        } else {
                            usernameDraft = op.username
                            passwordDraft = ""
                            clearBanner()
                            render()
                        }
                    }.apply { topMargin(10) }
                    addView(rowBtn)
                }
            }
            content.addView(opsCard)
        }

        val formCard = cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 18).apply {
            topMargin(16)
            addView(
                textView(
                    if (bound != null) "Autenticar operador" else "Vincular terminal ao restaurante",
                    16f,
                    bold = true,
                ),
            )
            addView(textView("Usuário", 13f, color = KomaColors.INK_MUTED).apply { topMargin(12) })
            val userInput = inputField("garcom", usernameDraft).apply {
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
                imeOptions = EditorInfo.IME_ACTION_NEXT
                addTextChangedListener(simpleWatcher { usernameDraft = it })
            }
            addView(userInput.apply { topMargin(6) })

            addView(textView("Senha", 13f, color = KomaColors.INK_MUTED).apply { topMargin(12) })
            val passInput = inputField("Sua senha", passwordDraft).apply {
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                imeOptions = EditorInfo.IME_ACTION_DONE
                addTextChangedListener(simpleWatcher { passwordDraft = it })
            }
            addView(passInput.apply { topMargin(6) })

            if (restaurants.isNotEmpty()) {
                addView(
                    textView("Selecione o restaurante", 13f, bold = true, color = KomaColors.ACCENT)
                        .apply { topMargin(14) },
                )
                restaurants.forEach { rest ->
                    val chosen = selectedRestaurant?.id == rest.id
                    addView(
                        buildActionButton(
                            title = if (chosen) "Selecionado: ${rest.name}" else rest.name,
                            bgColor = if (chosen) KomaColors.READY_CAP else KomaColors.RAISED,
                            textColor = if (chosen) KomaColors.ACCENT_INK else KomaColors.INK,
                            borderColor = if (chosen) KomaColors.READY_BORDER else KomaColors.CARD_BORDER,
                            enabled = !busy,
                        ) {
                            selectedRestaurant = rest
                            attemptLogin(rest.id)
                        }.apply { topMargin(8) },
                    )
                }
            }

            addView(
                buildActionButton(
                    title = if (busy) "Entrando..." else if (bound != null) "Entrar no turno" else "Entrar e vincular terminal",
                    bgColor = KomaColors.ACCENT,
                    textColor = KomaColors.ACCENT_INK,
                    enabled = !busy,
                ) {
                    attemptLogin(selectedRestaurant?.id ?: bound?.id)
                }.apply { topMargin(16) },
            )
        }
        content.addView(formCard)

        val infoCard = cardLayout(KomaColors.CANVAS, KomaColors.CARD_BORDER, pad = 14).apply {
            topMargin(16)
            addView(textView("Estado PagBank neste dispositivo", 13f, bold = true, color = KomaColors.INK_MUTED))
            addView(textView(plugPagClient.statusDescription(), 12f, color = KomaColors.INK_MUTED).apply { topMargin(4) })
            addView(textView("Versão ${BuildConfig.VERSION_NAME}", 11f, color = KomaColors.INK_MUTED).apply { topMargin(4) })
            if (bound != null || savedOps.isNotEmpty()) {
                addView(
                    buildActionButton(
                        title = "Desvincular terminal deste restaurante",
                        bgColor = KomaColors.DANGER_BG,
                        textColor = KomaColors.DANGER_INK,
                        borderColor = KomaColors.DANGER_BORDER,
                        enabled = !busy,
                    ) {
                        confirmUnbindTerminal()
                    }.apply { topMargin(12) },
                )
            }
        }
        content.addView(infoCard)

        scroll.addView(content)
        root.addView(scroll)
    }

    private fun attemptLogin(restaurantId: Int?) {
        val user = usernameDraft.trim()
        val pass = passwordDraft
        if (user.isBlank() || pass.isBlank()) {
            setError("Informe usuário e senha.")
            render()
            return
        }
        busy = true
        clearBanner()
        render()
        runAsync {
            val token = api.authenticate(user, pass, restaurantId)
            activeToken = token
            val loadedSession = api.session()
            val tables = if (loadedSession.tablesAvailable) api.salon() else emptyList()
            val menu = if (loadedSession.ordersAvailable) runCatching { api.menu() }.getOrNull() else null
            Triple(token, loadedSession, tables to menu)
        }.onSuccess { (token, loadedSession, data) ->
            busy = false
            val bound = terminalState.boundRestaurant
            if (bound != null && bound.id != loadedSession.restaurant.id) {
                promptRestaurantSwitchOnLogin(bound, loadedSession, user, token, data.first, data.second)
            } else {
                finishLogin(loadedSession, user, token, data.first, data.second)
            }
        }.onFailure { err ->
            busy = false
            activeToken = ""
            if (err is ApiFailure && err.restaurants.isNotEmpty()) {
                restaurants = err.restaurants
                val preferred = terminalState.boundRestaurant
                if (preferred != null && restaurants.any { it.id == preferred.id }) {
                    selectedRestaurant = preferred
                }
            }
            setError(messageFor(err))
            render()
        }
    }

    private fun finishLogin(
        loadedSession: Session,
        username: String,
        token: String,
        tables: List<TableSummary>,
        menu: Menu?,
    ) {
        terminalState = terminalStore.saveLogin(apiUrl, loadedSession, username, token)
        activeToken = token
        session = loadedSession
        passwordDraft = ""
        restaurants = emptyList()
        selectedRestaurant = loadedSession.restaurant
        salonSummaries = tables
        if (menu != null) cachedMenu = menu
        loadDraftsForCurrentRestaurant()
        screen = Screen.SALON
        clearBanner()
        render()
    }

    private fun promptRestaurantSwitchOnLogin(
        previous: Restaurant,
        nextSession: Session,
        username: String,
        token: String,
        tables: List<TableSummary>,
        menu: Menu?,
    ) {
        AlertDialog.Builder(this)
            .setTitle("Trocar restaurante do terminal?")
            .setMessage(
                "Este dispositivo está vinculado a ${previous.name}. Deseja desvincular ${previous.name} (removendo operadores e rascunhos locais desse restaurante) e vincular a ${nextSession.restaurant.name}?",
            )
            .setPositiveButton("Vincular a ${nextSession.restaurant.name}") { _, _ ->
                draftStore.clearScope("$apiUrl|r:${previous.id}")
                drafts = mutableMapOf()
                terminalState = terminalStore.unbindTerminal(apiUrl)
                finishLogin(nextSession, username, token, tables, menu)
            }
            .setNegativeButton("Cancelar") { _, _ ->
                activeToken = terminalState.activeOperator?.token.orEmpty()
                render()
            }
            .show()
    }

    private fun confirmUnbindTerminal() {
        val boundName = terminalState.boundRestaurant?.name ?: "restaurante atual"
        AlertDialog.Builder(this)
            .setTitle("Desvincular terminal?")
            .setMessage("Isso removerá todas as sessões de operadores salvas e os rascunhos locais de $boundName neste aparelho.")
            .setPositiveButton("Desvincular") { _, _ ->
                draftStore.clearScope(draftScope())
                drafts = mutableMapOf()
                cachedMenu = null
                salonSummaries = emptyList()
                tableDetail = null
                activeTable = null
                activeToken = ""
                session = null
                passwordDraft = ""
                terminalState = terminalStore.unbindTerminal(apiUrl)
                screen = Screen.LOGIN
                setInfo("Terminal desvinculado com segurança.")
                render()
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    // -------------------------------------------------------------------------
    // SCREEN: SALON
    // -------------------------------------------------------------------------

    private fun renderSalon() {
        val s = session ?: return renderLogin()
        val showProd = s.permissions.showProductionStatus
        if (!showProd && salonFilter == SalonFilter.READY) {
            salonFilter = SalonFilter.ALL
        }

        root.addView(
            topHeader(
                title = s.restaurant.name,
                subtitle = "${s.operator.name} (${s.role}) · ${terminalState.terminalId}",
                rightActions = listOf(
                    "Trocar" to { showOperatorSwitcher() },
                    "Histórico" to { openHistory() },
                    "Atualizar" to { refreshSalon(forceMenu = true) },
                ),
            ),
        )

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f,
            )
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(24))
        }

        loadingText?.let { msg ->
            content.addView(loadingCard(msg))
            scroll.addView(content)
            root.addView(scroll)
            return
        }

        if (!s.shiftOpen) {
            content.addView(
                cardLayout(KomaColors.WARN_BG, KomaColors.WARN_INK, pad = 12).apply {
                    addView(textView("Turno do caixa fechado — confira com o caixa antes de cobrar.", 13f, bold = true, color = KomaColors.WARN_INK))
                }.apply { bottomMargin(10) },
            )
        }

        if (!s.tablesAvailable) {
            content.addView(
                cardLayout(KomaColors.WARN_BG, KomaColors.WARN_INK, pad = 12).apply {
                    addView(textView("Operação de mesas desabilitada neste perfil.", 13f, bold = true, color = KomaColors.WARN_INK))
                }.apply { bottomMargin(10) },
            )
        }

        bannerMessage?.let { msg ->
            content.addView(bannerView(msg, bannerError, bannerRetryAction).apply { bottomMargin(10) })
        }

        pendingOrder?.let { pending ->
            content.addView(pendingOrderRecoveryCard(pending).apply { bottomMargin(12) })
        }

        val draftEntries = drafts.entries.filter { it.value.isNotEmpty() }
        if (draftEntries.isNotEmpty()) {
            val draftStrip = cardLayout(KomaColors.SURFACE, KomaColors.ACCENT, pad = 12).apply {
                bottomMargin(12)
                addView(textView("Rascunhos locais não enviados", 13f, bold = true, color = KomaColors.ACCENT))
                val chipRow = scrollChips {
                    draftEntries.forEach { (tableId, lines) ->
                        val tName = salonSummaries.firstOrNull { it.table.id == tableId }?.table?.name ?: "Mesa $tableId"
                        val qtySum = lines.sumOf { it.quantity }
                        addView(
                            pillButton(
                                label = "$tName ($qtySum)",
                                selected = false,
                                bgOverride = KomaColors.RAISED,
                                fgOverride = KomaColors.INK,
                            ) {
                                val targetTable = salonSummaries.firstOrNull { it.table.id == tableId }?.table
                                    ?: Table(tableId, tName)
                                openReviewDirectly(targetTable)
                            }.apply { rightMargin(8) },
                        )
                    }
                }.apply { topMargin(8) }
                addView(chipRow)
            }
            content.addView(draftStrip)
        }

        // Filter bar
        val availableFilters = if (showProd) {
            SalonFilter.values().toList()
        } else {
            listOf(SalonFilter.ALL, SalonFilter.FREE, SalonFilter.OCCUPIED)
        }
        val filterScroll = scrollChips {
            availableFilters.forEach { filter ->
                val count = countForFilter(filter, showProd)
                addView(
                    pillButton(
                        label = "${filter.label} ($count)",
                        selected = filter == salonFilter,
                    ) {
                        salonFilter = filter
                        render()
                    }.apply { rightMargin(8) },
                )
            }
        }.apply { bottomMargin(12) }
        content.addView(filterScroll)

        val visibleTables = filteredTables(showProd)
        if (visibleTables.isEmpty()) {
            content.addView(
                cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 20).apply {
                    addView(textView("Nenhuma mesa neste filtro.", 15f, bold = true))
                    addView(
                        textView(
                            if (salonFilter == SalonFilter.ALL) "Verifique o cadastro de mesas ou toque em Atualizar." else "Toque em Todas para ver todo o salão.",
                            13f,
                            color = KomaColors.INK_MUTED,
                        ).apply { topMargin(6) },
                    )
                    if (salonFilter != SalonFilter.ALL) {
                        addView(
                            buildActionButton("Ver todas as mesas", KomaColors.RAISED, KomaColors.INK) {
                                salonFilter = SalonFilter.ALL
                                render()
                            }.apply { topMargin(12) },
                        )
                    }
                },
            )
        } else {
            visibleTables.chunked(2).forEach { pair ->
                val row = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    layoutParams = LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                    ).apply { bottomMargin = dp(10) }
                }
                pair.forEachIndexed { idx, summary ->
                    val card = buildSalonTableCard(summary, showProd).apply {
                        layoutParams = LinearLayout.LayoutParams(
                            0,
                            ViewGroup.LayoutParams.WRAP_CONTENT,
                            1f,
                        ).apply {
                            if (idx == 0) rightMargin = dp(5) else leftMargin = dp(5)
                        }
                    }
                    row.addView(card)
                }
                if (pair.size == 1) {
                    row.addView(
                        View(this).apply {
                            layoutParams = LinearLayout.LayoutParams(0, 1, 1f).apply { leftMargin = dp(5) }
                        },
                    )
                }
                content.addView(row)
            }
        }

        scroll.addView(content)
        root.addView(scroll)
    }

    private fun countForFilter(filter: SalonFilter, showProd: Boolean): Int = when (filter) {
        SalonFilter.ALL -> salonSummaries.size
        SalonFilter.FREE -> salonSummaries.count { !it.occupied }
        SalonFilter.OCCUPIED -> salonSummaries.count { it.occupied }
        SalonFilter.READY -> if (showProd) salonSummaries.count { it.readyCount > 0 } else 0
    }

    private fun filteredTables(showProd: Boolean): List<TableSummary> = when (salonFilter) {
        SalonFilter.ALL -> salonSummaries
        SalonFilter.FREE -> salonSummaries.filter { !it.occupied }
        SalonFilter.OCCUPIED -> salonSummaries.filter { it.occupied }
        SalonFilter.READY -> if (showProd) salonSummaries.filter { it.readyCount > 0 } else salonSummaries
    }

    private fun buildSalonTableCard(summary: TableSummary, showProd: Boolean): LinearLayout {
        val state = summary.visualState(showProd)
        val (capColor, capInk, borderColor) = statePalette(state)
        val draftCount = drafts[summary.table.id].orEmpty().sumOf { it.quantity }

        return cardLayout(KomaColors.SURFACE, borderColor, pad = 12, radius = 14).apply {
            isClickable = !busy
            isFocusable = true
            setOnClickListener {
                if (summary.occupied) {
                    openTable(summary.table)
                } else {
                    startLaunchForTable(summary.table, preferredCheckId = null)
                }
            }

            // Header row: Table name + status badge
            val top = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            top.addView(
                textView(summary.table.name, 16f, bold = true).apply {
                    maxLines = 1
                    ellipsize = TextUtils.TruncateAt.END
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                },
            )
            top.addView(badgePill(summary.badgeLabel(showProd), capColor, capInk))
            addView(top)

            val valueText = if (summary.occupied) money(summary.openBalance) else "Livre"
            addView(
                textView(valueText, 18f, bold = true, color = if (summary.occupied) KomaColors.INK else KomaColors.FREE_INK, tabular = true)
                    .apply { topMargin(8) },
            )

            addView(
                textView(summary.subtitleLabel(showProd), 12f, color = KomaColors.INK_MUTED).apply {
                    minLines = 2
                    maxLines = 2
                    ellipsize = TextUtils.TruncateAt.END
                    topMargin(4)
                },
            )

            val actionLabel = when {
                draftCount > 0 -> "Rascunho ($draftCount)"
                summary.occupied -> "Lançar"
                else -> "Novo pedido"
            }
            val actionBg = when {
                draftCount > 0 -> KomaColors.ACCENT
                summary.occupied -> KomaColors.RAISED
                else -> KomaColors.ACCENT_DARK
            }
            val actionFg = when {
                draftCount > 0 || !summary.occupied -> KomaColors.ACCENT_INK
                else -> KomaColors.INK
            }
            addView(
                buildActionButton(actionLabel, actionBg, actionFg, minHeightDp = 44, enabled = !busy) {
                    startLaunchForTable(summary.table, preferredCheckId = summary.openCheck?.id)
                }.apply { topMargin(10) },
            )
        }
    }

    private fun pendingOrderRecoveryCard(order: PendingOrder): LinearLayout =
        cardLayout(KomaColors.WARN_BG, KomaColors.WARN_INK, pad = 14).apply {
            addView(textView("Envio pendente em ${order.tableName}", 14f, bold = true, color = KomaColors.WARN_INK))
            addView(
                textView(
                    "O envio anterior foi interrompido. Retome sem duplicar itens na cozinha.",
                    12f,
                    color = KomaColors.WARN_INK,
                ).apply { topMargin(4) },
            )
            val row = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                topMargin(10)
            }
            row.addView(
                buildActionButton("Retomar envio", KomaColors.ACCENT, KomaColors.ACCENT_INK, enabled = !busy) {
                    val currentOp = session?.operator ?: return@buildActionButton
                    submitPendingOrder(order, currentOp, clearDraftTableId = order.tableId)
                }.apply {
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                        .apply { rightMargin = dp(6) }
                },
            )
            row.addView(
                buildActionButton("Descartar", KomaColors.DANGER_BG, KomaColors.DANGER_INK, enabled = !busy) {
                    orderStore.save(apiUrl, null)
                    pendingOrder = null
                    render()
                }.apply {
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                        .apply { leftMargin = dp(6) }
                },
            )
            addView(row)
        }

    private fun refreshSalon(forceMenu: Boolean = false) {
        if (busy) return
        busy = true
        clearBanner()
        render()
        runAsync {
            val loadedSession = api.session()
            val tables = if (loadedSession.tablesAvailable) api.salon() else emptyList()
            val menu = if (forceMenu || cachedMenu == null) runCatching { api.menu() }.getOrNull() else cachedMenu
            Triple(loadedSession, tables, menu)
        }.onSuccess { (loadedSession, tables, menu) ->
            busy = false
            session = loadedSession
            salonSummaries = tables
            if (menu != null) cachedMenu = menu
            render()
        }.onFailure { err ->
            busy = false
            handleAsyncError(err) { refreshSalon(forceMenu) }
        }
    }

    // -------------------------------------------------------------------------
    // SCREEN: TABLE CONSUMPTION
    // -------------------------------------------------------------------------

    private fun openTable(table: Table) {
        activeTable = table
        selectedCheckFilterId = null
        busy = true
        clearBanner()
        loadingText = "Carregando ${table.name}..."
        screen = Screen.TABLE
        render()
        runAsync {
            val detail = api.detail(table)
            val menu = cachedMenu ?: runCatching { api.menu() }.getOrNull()
            detail to menu
        }.onSuccess { (detail, menu) ->
            busy = false
            loadingText = null
            tableDetail = detail
            if (menu != null) cachedMenu = menu
            render()
        }.onFailure { err ->
            busy = false
            loadingText = null
            handleAsyncError(err) { openTable(table) }
        }
    }

    private fun renderTable() {
        val table = activeTable ?: return backToSalon()
        val s = session ?: return renderLogin()
        val detail = tableDetail
        val showProd = s.permissions.showProductionStatus

        val stateBadge = if (detail != null) {
            val st = detail.visualState(showProd)
            val label = when (st) {
                TableVisualState.MERGED -> "Junta"
                TableVisualState.PAYMENT -> "Pagando"
                TableVisualState.FREE -> "Livre"
                TableVisualState.READY -> "${detail.readyCount} prontos"
                TableVisualState.SERVED -> "Servido"
                TableVisualState.OCCUPIED -> "Ocupada"
            }
            label to statePalette(st)
        } else {
            null
        }

        root.addView(
            topHeader(
                title = table.name,
                subtitle = detail?.mergedOrderLabel?.ifBlank { null }
                    ?: detail?.elapsedMinutes?.let { formatElapsed(it) }
                    ?: "Consumo da mesa",
                onBack = { backToSalon() },
                rightActions = listOf("Atualizar" to { openTable(table) }),
                statusChip = stateBadge,
            ),
        )

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f,
            )
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(20))
        }

        loadingText?.let { msg ->
            content.addView(loadingCard(msg))
            scroll.addView(content)
            root.addView(scroll)
            return
        }

        bannerMessage?.let { msg ->
            content.addView(bannerView(msg, bannerError, bannerRetryAction).apply { bottomMargin(10) })
        }

        if (detail != null) {
            // Financial summary 3 columns
            val summaryCard = cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 14).apply {
                bottomMargin(12)
                val cols = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL }
                cols.addView(metricCol("Consumo", money(detail.total), KomaColors.INK))
                cols.addView(metricCol("Pago", money(detail.paidTotal), KomaColors.FREE_INK))
                cols.addView(metricCol("Em aberto", money(detail.remainingTotal), if (detail.remainingTotal > 0) KomaColors.ACCENT else KomaColors.FREE_INK))
                addView(cols)

                val checksNeedingBill = detail.checks.filter { !it.awaitingPayment }
                if (checksNeedingBill.isNotEmpty()) {
                    addView(
                        buildActionButton(
                            title = if (checksNeedingBill.size > 1) "Pedir conta (${checksNeedingBill.size} comandas)" else "Pedir conta",
                            bgColor = KomaColors.RAISED,
                            textColor = KomaColors.PAYMENT_BORDER,
                            borderColor = KomaColors.PAYMENT_BORDER,
                            minHeightDp = 44,
                            enabled = !busy,
                        ) {
                            requestBillForChecks(table, checksNeedingBill)
                        }.apply { topMargin(12) },
                    )
                } else if (detail.awaitingPayment) {
                    addView(
                        textView("Mesa aguardando fechamento/pagamento.", 12f, bold = true, color = KomaColors.PAYMENT_BORDER)
                            .apply { topMargin(10) },
                    )
                }
            }
            content.addView(summaryCard)

            // Multi-comanda filter chips
            if (detail.checks.size > 1) {
                val chipRow = scrollChips {
                    addView(
                        pillButton("Todas (${detail.checks.size})", selectedCheckFilterId == null) {
                            selectedCheckFilterId = null
                            render()
                        }.apply { rightMargin(8) },
                    )
                    detail.checks.forEach { chk ->
                        addView(
                            pillButton("${chk.displayName} · ${money(chk.remainingCents)}", selectedCheckFilterId == chk.id) {
                                selectedCheckFilterId = chk.id
                                render()
                            }.apply { rightMargin(8) },
                        )
                    }
                }.apply { bottomMargin(12) }
                content.addView(chipRow)
            }

            val filteredItems = if (selectedCheckFilterId == null) {
                detail.items
            } else {
                detail.items.filter { it.checkId == selectedCheckFilterId }
            }

            // Ready items highlighted block
            val readyItems = if (showProd) filteredItems.filter { it.ready } else emptyList()
            if (readyItems.isNotEmpty()) {
                val readyCard = cardLayout(KomaColors.SURFACE, KomaColors.READY_BORDER, pad = 14).apply {
                    bottomMargin(12)
                    val hdr = LinearLayout(this@MainActivity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = Gravity.CENTER_VERTICAL
                    }
                    hdr.addView(
                        textView("Prontos para servir (${readyItems.size})", 15f, bold = true, color = KomaColors.READY_BORDER).apply {
                            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                        },
                    )
                    if (readyItems.size > 1) {
                        hdr.addView(
                            buildActionButton("Servir todos", KomaColors.READY_CAP, KomaColors.READY_INK, minHeightDp = 44, enabled = !busy) {
                                serveReadyItems(table, readyItems)
                            },
                        )
                    }
                    addView(hdr)
                    readyItems.forEach { item ->
                        addView(consumptionItemRow(table, item, showProd = true, highlightReady = true).apply { topMargin(10) })
                    }
                }
                content.addView(readyCard)
            }

            val otherItems = if (showProd) filteredItems.filterNot { it.ready } else filteredItems
            if (otherItems.isNotEmpty()) {
                val itemsCard = cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 14).apply {
                    addView(textView("Itens da mesa", 15f, bold = true))
                    otherItems.forEach { item ->
                        addView(consumptionItemRow(table, item, showProd = showProd, highlightReady = false).apply { topMargin(10) })
                    }
                }
                content.addView(itemsCard)
            } else if (filteredItems.isEmpty()) {
                content.addView(
                    cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 18).apply {
                        addView(textView("Comanda aberta sem itens lançados.", 14f, bold = true))
                        addView(textView("Toque em Lançar abaixo para adicionar pedidos.", 12f, color = KomaColors.INK_MUTED).apply { topMargin(4) })
                    },
                )
            }
        }

        scroll.addView(content)
        root.addView(scroll)

        // Sticky footer bar
        val draftCount = drafts[table.id].orEmpty().sumOf { it.quantity }
        val remaining = detail?.remainingTotal ?: 0L
        val footerActions = mutableListOf<FooterAction>()
        footerActions.add(
            FooterAction(
                label = if (draftCount > 0) "Lançar (+$draftCount)" else "Lançar",
                bgColor = KomaColors.ACCENT,
                fgColor = KomaColors.ACCENT_INK,
                enabled = !busy && s.ordersAvailable,
            ) {
                startLaunchForTable(table, preferredCheckId = selectedCheckFilterId ?: detail?.openCheck?.id)
            },
        )
        if (draftCount > 0) {
            footerActions.add(
                FooterAction(
                    label = "Enviar ($draftCount)",
                    bgColor = KomaColors.RAISED,
                    fgColor = KomaColors.ACCENT,
                    enabled = !busy && s.ordersAvailable,
                ) {
                    openReviewDirectly(table)
                },
            )
        }
        if (remaining > 0L && s.permissions.canClose && detail != null) {
            footerActions.add(
                FooterAction(
                    label = "Cobrar · ${money(remaining)}",
                    bgColor = KomaColors.PAYMENT_CAP,
                    fgColor = KomaColors.PAYMENT_INK,
                    enabled = !busy,
                ) {
                    openPaymentScreen(table, detail)
                },
            )
        }
        root.addView(stickyFooter(footerActions))
    }

    private fun consumptionItemRow(
        table: Table,
        item: Consumption,
        showProd: Boolean,
        highlightReady: Boolean,
    ): LinearLayout {
        val bg = if (highlightReady) KomaColors.RAISED else KomaColors.CANVAS
        val border = if (highlightReady) KomaColors.READY_BORDER else KomaColors.CARD_BORDER
        return cardLayout(bg, border, pad = 12, radius = 12).apply {
            val top = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            val titlePrefix = if (item.launchNumber.isNotBlank()) "#${item.launchNumber} · " else ""
            top.addView(
                textView("$titlePrefix${item.name}", 14f, bold = true).apply {
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                },
            )
            if (item.priceCents > 0L) {
                top.addView(textView(money(item.priceCents), 13f, bold = true, tabular = true))
            }
            addView(top)

            if (item.modifiers.isNotEmpty()) {
                addView(textView(item.modifiers.joinToString(", "), 12f, color = KomaColors.INK_MUTED).apply { topMargin(4) })
            }
            if (item.note.isNotBlank()) {
                addView(textView("Obs: ${item.note}", 12f, color = KomaColors.WARN_INK).apply { topMargin(4) })
            }
            if (item.clientName.isNotBlank() && !item.clientName.equals("Consumo Geral", ignoreCase = true)) {
                addView(textView("Cliente: ${item.clientName}", 12f, color = KomaColors.INK_MUTED).apply { topMargin(2) })
            }

            val bottom = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                topMargin(8)
            }
            val badges = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }
            val statusText = if (showProd) item.statusLabel else if (item.paid) "Pago" else "Lançado"
            val (sBg, sFg, _) = when {
                showProd && item.ready -> statePalette(TableVisualState.READY)
                showProd && item.served -> statePalette(TableVisualState.SERVED)
                else -> Triple(KomaColors.RAISED, KomaColors.INK_MUTED, KomaColors.CARD_BORDER)
            }
            badges.addView(badgePill(statusText, sBg, sFg))
            if (item.paid && showProd) {
                badges.addView(badgePill("Pago", KomaColors.FREE_CAP, KomaColors.FREE_INK).apply { leftMargin(6) })
            }
            bottom.addView(badges)

            if (item.ready) {
                bottom.addView(
                    buildActionButton("Servir", KomaColors.READY_CAP, KomaColors.READY_INK, minHeightDp = 44, enabled = !busy) {
                        serveReadyItems(table, listOf(item))
                    }.apply { leftMargin(8) },
                )
            } else {
                val productMatch = cachedMenu?.products?.firstOrNull { it.id == item.productId && it.available }
                if (productMatch != null) {
                    bottom.addView(
                        buildActionButton("+1", KomaColors.RAISED, KomaColors.ACCENT, minHeightDp = 44, enabled = !busy) {
                            repeatProductToDraft(table, productMatch, item.modifiers)
                        }.apply { leftMargin(8) },
                    )
                }
            }
            addView(bottom)
        }
    }

    private fun repeatProductToDraft(table: Table, product: Product, modifierNames: List<String>) {
        if (product.requiresConfiguration && modifierNames.isEmpty()) {
            startCustomization(product, listOf(product), editIndex = null)
            return
        }
        val list = drafts.getOrPut(table.id) { mutableListOf() }
        val existingIdx = list.indexOfFirst { it.product.id == product.id && it.options.isEmpty() && it.note.isBlank() }
        if (!product.requiresConfiguration && existingIdx >= 0) {
            val cur = list[existingIdx]
            list[existingIdx] = cur.copy(quantity = cur.quantity + 1)
        } else if (!product.requiresConfiguration) {
            list.add(Line(product, emptyList(), "", 1))
        } else {
            startCustomization(product, listOf(product), editIndex = null)
            return
        }
        saveDrafts()
        setInfo("Adicionado ${product.name} ao rascunho de ${table.name}.")
        render()
    }

    private fun serveReadyItems(table: Table, items: List<Consumption>) {
        if (busy || items.isEmpty()) return
        busy = true
        clearBanner()
        render()
        runAsync {
            val count = api.serveAll(items)
            val detail = api.detail(table)
            val tables = api.salon()
            Triple(count, detail, tables)
        }.onSuccess { (count, detail, tables) ->
            busy = false
            tableDetail = detail
            salonSummaries = tables
            setInfo(if (count == 1) "Item marcado como servido." else "$count itens marcados como servidos.")
            render()
        }.onFailure { err ->
            busy = false
            handleAsyncError(err) { serveReadyItems(table, items) }
        }
    }

    private fun requestBillForChecks(table: Table, checks: List<Check>) {
        if (busy || checks.isEmpty()) return
        busy = true
        clearBanner()
        render()
        runAsync {
            checks.forEach { api.requestBill(it.id) }
            val detail = api.detail(table)
            val tables = api.salon()
            detail to tables
        }.onSuccess { (detail, tables) ->
            busy = false
            tableDetail = detail
            salonSummaries = tables
            setInfo(if (checks.size > 1) "Conta solicitada para ${checks.size} comandas." else "Conta solicitada.")
            render()
        }.onFailure { err ->
            busy = false
            handleAsyncError(err) { requestBillForChecks(table, checks) }
        }
    }

    // -------------------------------------------------------------------------
    // SCREEN: MENU (CATEGORIES & PRODUCTS)
    // -------------------------------------------------------------------------

    private fun startLaunchForTable(table: Table, preferredCheckId: String?) {
        activeTable = table
        orderTargetCheckId = preferredCheckId
        activeCategory = null
        clearBanner()
        val menu = cachedMenu
        if (menu != null) {
            screen = Screen.MENU
            render()
        } else {
            busy = true
            loadingText = "Carregando cardápio..."
            screen = Screen.MENU
            render()
            runAsync { api.menu() }
                .onSuccess { loaded ->
                    busy = false
                    loadingText = null
                    cachedMenu = loaded
                    render()
                }
                .onFailure { err ->
                    busy = false
                    loadingText = null
                    handleAsyncError(err) { startLaunchForTable(table, preferredCheckId) }
                }
        }
    }

    private fun renderMenu() {
        val table = activeTable ?: return backToSalon()
        val menu = cachedMenu
        val currentCat = activeCategory

        root.addView(
            topHeader(
                title = "${table.name} · Cardápio",
                subtitle = currentCat?.name ?: "Escolha a categoria",
                onBack = {
                    if (currentCat != null) {
                        activeCategory = null
                        render()
                    } else if (tableDetail != null) {
                        screen = Screen.TABLE
                        render()
                    } else {
                        backToSalon()
                    }
                },
                rightActions = listOf("Atualizar" to { reloadMenu() }),
            ),
        )

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f,
            )
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(20))
        }

        loadingText?.let { msg ->
            content.addView(loadingCard(msg))
            scroll.addView(content)
            root.addView(scroll)
            return
        }

        bannerMessage?.let { msg ->
            content.addView(bannerView(msg, bannerError, bannerRetryAction).apply { bottomMargin(10) })
        }

        if (menu == null) {
            content.addView(
                cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 18).apply {
                    addView(textView("Cardápio ainda não carregado.", 14f, bold = true))
                    addView(
                        buildActionButton("Carregar cardápio", KomaColors.ACCENT, KomaColors.ACCENT_INK) {
                            reloadMenu()
                        }.apply { topMargin(12) },
                    )
                },
            )
            scroll.addView(content)
            root.addView(scroll)
            return
        }

        if (currentCat == null) {
            // 2-column category grid
            addCategoryGrid(content, menu)
        } else {
            // Horizontal category switcher + product choices
            val catStrip = scrollChips {
                menu.categories.forEach { cat ->
                    addView(
                        pillButton(cat.name, cat.id == currentCat.id) {
                            activeCategory = cat
                            render()
                        }.apply { rightMargin(8) },
                    )
                }
            }.apply { bottomMargin(12) }
            content.addView(catStrip)

            val choices = menu.choices(currentCat)
            if (choices.isEmpty()) {
                content.addView(
                    cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 16).apply {
                        addView(textView("Nenhum item ativo nesta categoria.", 14f, color = KomaColors.INK_MUTED))
                    },
                )
            } else {
                choices.forEach { variants ->
                    content.addView(buildChoiceCard(table, variants).apply { bottomMargin(10) })
                }
            }
        }

        scroll.addView(content)
        root.addView(scroll)

        val tableDraft = drafts[table.id].orEmpty()
        if (tableDraft.isNotEmpty()) {
            val count = tableDraft.sumOf { it.quantity }
            val sum = tableDraft.sumOf { it.total }
            root.addView(
                stickyFooter(
                    listOf(
                        FooterAction(
                            label = "Revisar pedido ($count) · ${money(sum)}",
                            bgColor = KomaColors.ACCENT,
                            fgColor = KomaColors.ACCENT_INK,
                            enabled = !busy,
                        ) {
                            openReviewDirectly(table)
                        },
                    ),
                ),
            )
        }
    }

    private fun addCategoryGrid(container: LinearLayout, menu: Menu) {
        if (menu.categories.isEmpty()) {
            container.addView(
                cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 18).apply {
                    addView(textView("Nenhum produto ativo no cardápio.", 14f, color = KomaColors.INK_MUTED))
                },
            )
            return
        }
        menu.categories.chunked(2).forEach { pair ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { bottomMargin = dp(10) }
            }
            pair.forEachIndexed { idx, cat ->
                val itemCount = menu.choices(cat).size
                val card = cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 16, radius = 14).apply {
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                        if (idx == 0) rightMargin = dp(5) else leftMargin = dp(5)
                    }
                    minimumHeight = dp(86)
                    isClickable = true
                    isFocusable = true
                    setOnClickListener {
                        activeCategory = cat
                        render()
                    }
                    addView(textView(cat.name, 16f, bold = true))
                    addView(
                        textView(if (itemCount == 1) "1 opção" else "$itemCount opções", 12f, color = KomaColors.INK_MUTED)
                            .apply { topMargin(6) },
                    )
                }
                row.addView(card)
            }
            if (pair.size == 1) {
                row.addView(
                    View(this).apply {
                        layoutParams = LinearLayout.LayoutParams(0, 1, 1f).apply { leftMargin = dp(5) }
                    },
                )
            }
            container.addView(row)
        }
    }

    private fun buildChoiceCard(table: Table, variants: List<Product>): LinearLayout {
        val primary = variants.first()
        val isFamily = variants.size > 1 && primary.familyName.isNotBlank()
        val tableDraft = drafts[table.id].orEmpty()

        return cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 14, radius = 14).apply {
            if (isFamily) {
                addView(textView(primary.familyName, 16f, bold = true))
                if (primary.familyAxis.isNotBlank()) {
                    addView(textView("Escolha ${primary.familyAxis.lowercase()}", 12f, color = KomaColors.INK_MUTED).apply { topMargin(2) })
                }
                if (primary.description.isNotBlank()) {
                    addView(textView(primary.description, 12f, color = KomaColors.INK_MUTED).apply { topMargin(4); maxLines = 2; ellipsize = TextUtils.TruncateAt.END })
                }
                val row = scrollChips {
                    variants.forEach { variant ->
                        val label = variant.variantLabel.ifBlank { variant.name }
                        val vLabel = if (!variant.available) "$label (Esgotado)" else "$label · ${money(variant.price)}"
                        addView(
                            pillButton(
                                label = vLabel,
                                selected = false,
                                bgOverride = if (variant.available) KomaColors.RAISED else KomaColors.DISABLED_BG,
                                fgOverride = if (variant.available) KomaColors.INK else KomaColors.DISABLED_INK,
                                enabled = variant.available && !busy,
                            ) {
                                onSelectProductFromMenu(table, variant, variants)
                            }.apply { rightMargin(8) },
                        )
                    }
                }.apply { topMargin(10) }
                addView(row)
                return@apply
            }

            // Single product card
            val simpleLineIndex = tableDraft.indexOfLast {
                it.product.id == primary.id && it.options.isEmpty() && it.note.isBlank() && it.clientName.isBlank()
            }
            val simpleQty = if (simpleLineIndex >= 0) tableDraft[simpleLineIndex].quantity else 0
            val totalQtyInDraft = tableDraft.filter { it.product.id == primary.id }.sumOf { it.quantity }

            val top = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            val infoCol = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            }
            infoCol.addView(textView(primary.name, 15f, bold = true))
            if (primary.description.isNotBlank()) {
                infoCol.addView(
                    textView(primary.description, 12f, color = KomaColors.INK_MUTED).apply {
                        topMargin(3)
                        maxLines = 2
                        ellipsize = TextUtils.TruncateAt.END
                    },
                )
            }
            infoCol.addView(
                textView(
                    if (!primary.available) "Indisponível" else money(primary.price),
                    15f,
                    bold = true,
                    color = if (primary.available) KomaColors.ACCENT else KomaColors.DISABLED_INK,
                    tabular = true,
                ).apply { topMargin(6) },
            )
            top.addView(infoCol)

            if (!primary.available) {
                top.addView(badgePill("Esgotado", KomaColors.DISABLED_BG, KomaColors.DISABLED_INK))
                addView(top)
                return@apply
            }

            if (primary.requiresConfiguration) {
                top.addView(
                    buildActionButton(
                        title = if (totalQtyInDraft > 0) "Configurar ($totalQtyInDraft)" else "Configurar",
                        bgColor = KomaColors.ACCENT,
                        textColor = KomaColors.ACCENT_INK,
                        minHeightDp = 44,
                    ) {
                        startCustomization(primary, variants, editIndex = null)
                    },
                )
                addView(top)
                return@apply
            }

            addView(top)

            val controls = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                topMargin(10)
            }
            if (simpleQty > 0) {
                controls.addView(
                    stepperControl(
                        qty = simpleQty,
                        onMinus = { adjustSimpleDraftQty(table, primary, -1) },
                        onPlus = { adjustSimpleDraftQty(table, primary, +1) },
                    ),
                )
            } else {
                controls.addView(
                    buildActionButton("+ Adicionar", KomaColors.ACCENT, KomaColors.ACCENT_INK, minHeightDp = 44) {
                        adjustSimpleDraftQty(table, primary, +1)
                    },
                )
            }
            controls.addView(
                buildActionButton(
                    title = if (primary.hasOptionalCustomization) "Personalizar" else "Obs.",
                    bgColor = KomaColors.RAISED,
                    textColor = KomaColors.INK,
                    minHeightDp = 44,
                ) {
                    startCustomization(primary, variants, editIndex = null)
                }.apply { leftMargin(8) },
            )
            addView(controls)
        }
    }

    private fun onSelectProductFromMenu(table: Table, product: Product, variants: List<Product>) {
        if (!product.available) return
        if (product.requiresConfiguration || product.hasOptionalCustomization) {
            startCustomization(product, variants, editIndex = null)
        } else {
            adjustSimpleDraftQty(table, product, +1)
            setInfo("Adicionado ${product.variantLabel.ifBlank { product.name }} ao rascunho.")
        }
    }

    private fun adjustSimpleDraftQty(table: Table, product: Product, delta: Int) {
        val list = drafts.getOrPut(table.id) { mutableListOf() }
        val idx = list.indexOfLast {
            it.product.id == product.id && it.options.isEmpty() && it.note.isBlank() && it.clientName.isBlank()
        }
        if (delta > 0) {
            if (idx >= 0) {
                val cur = list[idx]
                list[idx] = cur.copy(quantity = cur.quantity + delta)
            } else {
                list.add(Line(product, emptyList(), "", delta))
            }
        } else if (idx >= 0) {
            val cur = list[idx]
            val next = cur.quantity + delta
            if (next <= 0) list.removeAt(idx) else list[idx] = cur.copy(quantity = next)
        }
        saveDrafts()
        render()
    }

    private fun reloadMenu() {
        if (busy) return
        busy = true
        clearBanner()
        render()
        runAsync { api.menu() }
            .onSuccess { loaded ->
                busy = false
                cachedMenu = loaded
                activeCategory = activeCategory?.let { prev -> loaded.categories.firstOrNull { it.id == prev.id } }
                render()
            }
            .onFailure { err ->
                busy = false
                handleAsyncError(err) { reloadMenu() }
            }
    }

    // -------------------------------------------------------------------------
    // SCREEN: CUSTOMIZE PRODUCT / MODIFIERS / OBSERVATIONS
    // -------------------------------------------------------------------------

    private fun startCustomization(product: Product, variants: List<Product>, editIndex: Int?) {
        customizingProduct = product
        customizingVariants = variants
        editingDraftIndex = editIndex
        if (editIndex != null) {
            val table = activeTable
            val line = if (table != null) drafts[table.id]?.getOrNull(editIndex) else null
            if (line != null) {
                customizingOptions = line.options.toMutableList()
                customizingNote = line.note
                customizingClientName = line.clientName
                customizingQuantity = line.quantity
            }
        } else {
            customizingOptions = mutableListOf()
            customizingNote = ""
            customizingClientName = ""
            customizingQuantity = 1
        }
        clearBanner()
        screen = Screen.CUSTOMIZE
        render()
    }

    private fun renderCustomize() {
        val table = activeTable ?: return backToSalon()
        val product = customizingProduct ?: return
        val menu = cachedMenu

        root.addView(
            topHeader(
                title = product.familyName.ifBlank { product.name },
                subtitle = "${table.name} · ${money(product.price + customizingOptions.sumOf { it.price })}",
                onBack = {
                    editingDraftIndex = null
                    screen = Screen.MENU
                    render()
                },
            ),
        )

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f,
            )
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(24))
        }

        if (product.description.isNotBlank()) {
            content.addView(textView(product.description, 13f, color = KomaColors.INK_MUTED).apply { bottomMargin(12) })
        }

        // Variant pills if multiple in family
        if (customizingVariants.size > 1) {
            val varCard = cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 12).apply { bottomMargin(12) }
            varCard.addView(textView(product.familyAxis.ifBlank { "Variação" }, 14f, bold = true))
            val chipRow = scrollChips {
                customizingVariants.forEach { variant ->
                    val selected = variant.id == product.id
                    val vLabel = variant.variantLabel.ifBlank { variant.name }
                    addView(
                        pillButton(
                            label = "$vLabel · ${money(variant.price)}",
                            selected = selected,
                            enabled = variant.available,
                        ) {
                            val validOptionIds = variant.groups.flatMap { it.options }.map { it.id }.toSet()
                            customizingOptions.retainAll { it.id in validOptionIds }
                            customizingProduct = variant
                            render()
                        }.apply { rightMargin(8) },
                    )
                }
            }.apply { topMargin(8) }
            varCard.addView(chipRow)
            content.addView(varCard)
        }

        // Modifier groups
        product.groups.forEach { group ->
            content.addView(buildModifierGroupCard(group).apply { bottomMargin(12) })
        }

        // Quick observation chips & input
        val obsCard = cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 14).apply { bottomMargin(12) }
        obsCard.addView(textView("Observações", 15f, bold = true))
        val quickNotes = ((menu?.serviceNotes().orEmpty()) + (menu?.notes(product).orEmpty())).distinct()
        if (quickNotes.isNotEmpty()) {
            val noteChips = scrollChips {
                quickNotes.forEach { chipText ->
                    val active = noteContains(customizingNote, chipText)
                    addView(
                        pillButton(chipText, selected = active) {
                            customizingNote = toggleNoteToken(customizingNote, chipText)
                            render()
                        }.apply { rightMargin(8) },
                    )
                }
            }.apply { topMargin(8) }
            obsCard.addView(noteChips)
        }
        val noteInput = inputField("Ex: ponto da carne, sem cebola...", customizingNote).apply {
            topMargin(10)
            addTextChangedListener(simpleWatcher { customizingNote = it })
        }
        obsCard.addView(noteInput)

        obsCard.addView(textView("Pessoa / identificação (opcional)", 13f, color = KomaColors.INK_MUTED).apply { topMargin(12) })
        val clientInput = inputField("Ex: João, Consumo Geral", customizingClientName).apply {
            topMargin(6)
            addTextChangedListener(simpleWatcher { customizingClientName = it })
        }
        obsCard.addView(clientInput)
        content.addView(obsCard)

        // Quantity card
        val qtyCard = cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 14).apply {
            val row = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            row.addView(
                textView("Quantidade", 15f, bold = true).apply {
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                },
            )
            row.addView(
                stepperControl(
                    qty = customizingQuantity,
                    onMinus = {
                        if (customizingQuantity > 1) {
                            customizingQuantity -= 1
                            render()
                        }
                    },
                    onPlus = {
                        customizingQuantity += 1
                        render()
                    },
                ),
            )
            addView(row)
        }
        content.addView(qtyCard)

        scroll.addView(content)
        root.addView(scroll)

        // Bottom CTA
        val missingGroup = product.groups.firstOrNull { !it.isSatisfied(customizingOptions) }
        val unitTotal = product.price + customizingOptions.sumOf { it.price }
        val grandTotal = unitTotal * customizingQuantity
        val ctaLabel = when {
            missingGroup != null -> "Complete: ${missingGroup.name}"
            editingDraftIndex != null -> "Atualizar item · ${money(grandTotal)}"
            else -> "Adicionar · ${money(grandTotal)}"
        }
        root.addView(
            stickyFooter(
                listOf(
                    FooterAction(
                        label = ctaLabel,
                        bgColor = if (missingGroup == null) KomaColors.ACCENT else KomaColors.DISABLED_BG,
                        fgColor = if (missingGroup == null) KomaColors.ACCENT_INK else KomaColors.DISABLED_INK,
                        enabled = missingGroup == null,
                    ) {
                        commitCustomizedLine(table, product)
                    },
                ),
            ),
        )
    }

    private fun buildModifierGroupCard(group: Group): LinearLayout {
        val count = group.selectedCount(customizingOptions)
        val satisfied = group.isSatisfied(customizingOptions)
        val border = if (group.isRequired && !satisfied) KomaColors.OCCUPIED_BORDER else KomaColors.CARD_BORDER
        return cardLayout(KomaColors.SURFACE, border, pad = 14).apply {
            val hdr = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            hdr.addView(
                textView(group.name, 15f, bold = true).apply {
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                },
            )
            val statusBadge = if (group.isRequired && !satisfied) {
                badgePill("$count/${group.min}", KomaColors.OCCUPIED_CAP, KomaColors.OCCUPIED_INK)
            } else {
                badgePill("$count/${group.max}", KomaColors.FREE_CAP, KomaColors.FREE_INK)
            }
            hdr.addView(statusBadge)
            addView(hdr)
            addView(textView(group.ruleLabel(), 12f, color = KomaColors.INK_MUTED).apply { topMargin(4) })

            group.options.forEach { option ->
                val selectedCount = group.optionCount(customizingOptions, option)
                val optionRow = LinearLayout(this@MainActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    minimumHeight = dp(48)
                    setPadding(dp(12), dp(8), dp(12), dp(8))
                    background = roundedDrawable(
                        fill = if (selectedCount > 0) KomaColors.RAISED else KomaColors.CANVAS,
                        stroke = if (selectedCount > 0) KomaColors.ACCENT else KomaColors.CARD_BORDER,
                        radiusDp = 10,
                    )
                    topMargin(8)
                }

                val nameCol = LinearLayout(this@MainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                }
                nameCol.addView(textView(option.name, 14f, bold = selectedCount > 0))
                if (option.price > 0L) {
                    nameCol.addView(textView("+ ${money(option.price)}", 12f, color = KomaColors.ACCENT, tabular = true))
                }
                optionRow.addView(nameCol)

                when {
                    group.repeatable -> {
                        val canAddMore = group.canAdd(customizingOptions, option)
                        optionRow.addView(
                            stepperControl(
                                qty = selectedCount,
                                plusEnabled = canAddMore,
                                onMinus = {
                                    val idx = customizingOptions.indexOfFirst { it.id == option.id }
                                    if (idx >= 0) {
                                        customizingOptions.removeAt(idx)
                                        render()
                                    }
                                },
                                onPlus = {
                                    if (group.canAdd(customizingOptions, option)) {
                                        customizingOptions.add(option)
                                        render()
                                    }
                                },
                            ),
                        )
                    }
                    group.isSingleChoice -> {
                        optionRow.addView(
                            badgePill(
                                label = if (selectedCount > 0) "Selecionado" else "Escolher",
                                bg = if (selectedCount > 0) KomaColors.ACCENT else KomaColors.RAISED,
                                fg = if (selectedCount > 0) KomaColors.ACCENT_INK else KomaColors.INK_MUTED,
                            ),
                        )
                        optionRow.isClickable = true
                        optionRow.setOnClickListener {
                            val groupOptionIds = group.options.map { it.id }.toSet()
                            if (selectedCount > 0 && group.min == 0) {
                                customizingOptions.removeAll { it.id in groupOptionIds }
                            } else {
                                customizingOptions.removeAll { it.id in groupOptionIds }
                                customizingOptions.add(option)
                            }
                            render()
                        }
                    }
                    else -> {
                        val canToggleOn = selectedCount == 0 && group.canAdd(customizingOptions, option)
                        optionRow.addView(
                            badgePill(
                                label = if (selectedCount > 0) "Incluído" else "Adicionar",
                                bg = if (selectedCount > 0) KomaColors.ACCENT else KomaColors.RAISED,
                                fg = if (selectedCount > 0) KomaColors.ACCENT_INK else KomaColors.INK_MUTED,
                            ),
                        )
                        optionRow.isClickable = true
                        optionRow.setOnClickListener {
                            if (selectedCount > 0) {
                                customizingOptions.removeAll { it.id == option.id }
                            } else if (canToggleOn) {
                                customizingOptions.add(option)
                            }
                            render()
                        }
                    }
                }
                addView(optionRow)
            }
        }
    }

    private fun commitCustomizedLine(table: Table, product: Product) {
        val groupOrder = product.groups.flatMap { it.options.mapIndexed { idx, opt -> opt.id to idx } }.toMap()
        val sortedOptions = customizingOptions.sortedBy { groupOrder[it.id] ?: Int.MAX_VALUE }
        val newLine = Line(
            product = product,
            options = sortedOptions,
            note = customizingNote.trim(),
            quantity = customizingQuantity,
            clientName = customizingClientName.trim(),
        )
        val tableDraft = drafts.getOrPut(table.id) { mutableListOf() }
        val idx = editingDraftIndex
        if (idx != null && idx in tableDraft.indices) {
            tableDraft[idx] = newLine
            editingDraftIndex = null
            screen = Screen.REVIEW
        } else {
            tableDraft.add(newLine)
            screen = Screen.MENU
        }
        saveDrafts()
        setInfo("${newLine.product.name} no rascunho de ${table.name}.")
        render()
    }

    // -------------------------------------------------------------------------
    // SCREEN: REVIEW & SUBMIT ORDER
    // -------------------------------------------------------------------------

    private fun openReviewDirectly(table: Table) {
        activeTable = table
        screen = Screen.REVIEW
        clearBanner()
        if (tableDetail?.table?.id != table.id) {
            runAsync { runCatching { api.detail(table) }.getOrNull() }
                .onSuccess { loaded ->
                    if (loaded != null && activeTable?.id == table.id) {
                        tableDetail = loaded
                        if (orderTargetCheckId == null) orderTargetCheckId = loaded.openCheck?.id
                        render()
                    }
                }
        }
        render()
    }

    private fun renderReview() {
        val table = activeTable ?: return backToSalon()
        val s = session ?: return renderLogin()
        val lines = drafts[table.id].orEmpty()
        val detail = tableDetail?.takeIf { it.table.id == table.id }
        val checks = detail?.checks.orEmpty()

        root.addView(
            topHeader(
                title = "Revisar pedido · ${table.name}",
                subtitle = if (lines.isEmpty()) "Sem itens no rascunho" else "${lines.sumOf { it.quantity }} itens",
                onBack = {
                    screen = if (cachedMenu != null) Screen.MENU else Screen.TABLE
                    render()
                },
            ),
        )

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f,
            )
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(24))
        }

        bannerMessage?.let { msg ->
            content.addView(bannerView(msg, bannerError, bannerRetryAction).apply { bottomMargin(10) })
        }

        lastRemovedDraft?.takeIf { it.tableId == table.id }?.let { removed ->
            content.addView(
                cardLayout(KomaColors.RAISED, KomaColors.ACCENT, pad = 12).apply {
                    bottomMargin(10)
                    val row = LinearLayout(this@MainActivity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = Gravity.CENTER_VERTICAL
                    }
                    row.addView(
                        textView("Removido: ${removed.line.product.name}", 13f).apply {
                            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                        },
                    )
                    row.addView(
                        buildActionButton("Desfazer", KomaColors.ACCENT, KomaColors.ACCENT_INK, minHeightDp = 44) {
                            val list = drafts.getOrPut(table.id) { mutableListOf() }
                            val safeIndex = removed.index.coerceIn(0, list.size)
                            list.add(safeIndex, removed.line)
                            lastRemovedDraft = null
                            saveDrafts()
                            render()
                        },
                    )
                    addView(row)
                },
            )
        }

        // Target comanda selector
        if (checks.isNotEmpty()) {
            val targetCard = cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 12).apply { bottomMargin(12) }
            targetCard.addView(textView("Destino do lançamento", 13f, bold = true, color = KomaColors.INK_MUTED))
            val chipRow = scrollChips {
                checks.forEach { chk ->
                    addView(
                        pillButton(chk.displayName, orderTargetCheckId == chk.id) {
                            orderTargetCheckId = chk.id
                            render()
                        }.apply { rightMargin(8) },
                    )
                }
                addView(
                    pillButton("+ Nova comanda", orderTargetCheckId == null) {
                        orderTargetCheckId = null
                        render()
                    },
                )
            }.apply { topMargin(8) }
            targetCard.addView(chipRow)
            if (orderTargetCheckId == null) {
                val idInput = inputField("Nome da nova comanda (opcional)", newOrderCheckName).apply {
                    topMargin(10)
                    addTextChangedListener(simpleWatcher { newOrderCheckName = it })
                }
                targetCard.addView(idInput)
            }
            content.addView(targetCard)
        }

        if (lines.isEmpty()) {
            content.addView(
                cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 18).apply {
                    addView(textView("Rascunho vazio.", 15f, bold = true))
                    addView(
                        buildActionButton("Adicionar itens", KomaColors.ACCENT, KomaColors.ACCENT_INK) {
                            startLaunchForTable(table, orderTargetCheckId)
                        }.apply { topMargin(12) },
                    )
                },
            )
            scroll.addView(content)
            root.addView(scroll)
            return
        }

        lines.forEachIndexed { index, line ->
            val card = cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 14).apply {
                bottomMargin(10)
                val top = LinearLayout(this@MainActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                }
                top.addView(
                    textView(line.product.name, 15f, bold = true).apply {
                        layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                    },
                )
                top.addView(textView(money(line.total), 15f, bold = true, color = KomaColors.ACCENT, tabular = true))
                addView(top)

                if (line.options.isNotEmpty()) {
                    val groupedOpts = line.options.groupingBy { it.name }.eachCount()
                        .entries.joinToString(", ") { (n, q) -> if (q > 1) "${q}x $n" else n }
                    addView(textView(groupedOpts, 12f, color = KomaColors.INK_MUTED).apply { topMargin(4) })
                }
                if (line.note.isNotBlank()) {
                    addView(textView("Obs: ${line.note}", 12f, color = KomaColors.WARN_INK).apply { topMargin(4) })
                }
                if (line.clientName.isNotBlank()) {
                    addView(textView("Pessoa: ${line.clientName}", 12f, color = KomaColors.INK_MUTED).apply { topMargin(2) })
                }

                val row = LinearLayout(this@MainActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    topMargin(10)
                }
                row.addView(
                    stepperControl(
                        qty = line.quantity,
                        onMinus = {
                            if (line.quantity > 1) {
                                drafts[table.id]?.set(index, line.copy(quantity = line.quantity - 1))
                            } else {
                                removeDraftLine(table.id, index)
                            }
                            saveDrafts()
                            render()
                        },
                        onPlus = {
                            drafts[table.id]?.set(index, line.copy(quantity = line.quantity + 1))
                            saveDrafts()
                            render()
                        },
                    ),
                )
                val fullProduct = cachedMenu?.products?.firstOrNull { it.id == line.product.id } ?: line.product
                row.addView(
                    buildActionButton("Editar", KomaColors.RAISED, KomaColors.INK, minHeightDp = 44) {
                        val variants = cachedMenu?.products?.filter {
                            fullProduct.familyId.isNotBlank() && it.familyId == fullProduct.familyId
                        }.orEmpty().ifEmpty { listOf(fullProduct) }
                        startCustomization(fullProduct, variants, editIndex = index)
                    }.apply { leftMargin(8) },
                )
                row.addView(
                    buildActionButton("Remover", KomaColors.DANGER_BG, KomaColors.DANGER_INK, minHeightDp = 44) {
                        removeDraftLine(table.id, index)
                        saveDrafts()
                        render()
                    }.apply { leftMargin(8) },
                )
                addView(row)
            }
            content.addView(card)
        }

        scroll.addView(content)
        root.addView(scroll)

        val grandTotal = lines.sumOf { it.total }
        root.addView(
            stickyFooter(
                listOf(
                    FooterAction(
                        label = "+ Itens",
                        bgColor = KomaColors.RAISED,
                        fgColor = KomaColors.INK,
                        enabled = !busy,
                    ) {
                        startLaunchForTable(table, orderTargetCheckId)
                    },
                    FooterAction(
                        label = if (busy) "Enviando..." else "Enviar cozinha · ${money(grandTotal)}",
                        bgColor = KomaColors.ACCENT,
                        fgColor = KomaColors.ACCENT_INK,
                        enabled = !busy && lines.isNotEmpty(),
                    ) {
                        val targetCheck = checks.firstOrNull { it.id == orderTargetCheckId }
                        val order = PendingOrder.create(
                            table = table,
                            check = targetCheck,
                            operator = s.operator,
                            lines = lines,
                            checkIdentifier = if (targetCheck == null) newOrderCheckName else null,
                        )
                        submitPendingOrder(order, s.operator, clearDraftTableId = table.id)
                    },
                ),
            ),
        )
    }

    private fun removeDraftLine(tableId: Int, index: Int) {
        val list = drafts[tableId] ?: return
        if (index in list.indices) {
            val removed = list.removeAt(index)
            lastRemovedDraft = RemovedDraftEntry(tableId, index, removed)
        }
    }

    private fun submitPendingOrder(order: PendingOrder, operator: Operator, clearDraftTableId: Int?) {
        if (busy) return
        busy = true
        clearBanner()
        render()
        runAsync {
            val displayNumber = api.submit(order, operator.id) { persisted ->
                orderStore.save(apiUrl, persisted)
                pendingOrder = persisted
            }
            val table = Table(order.tableId, order.tableName)
            val detail = runCatching { api.detail(table) }.getOrNull()
            val tables = runCatching { api.salon() }.getOrNull()
            Triple(displayNumber, detail, tables)
        }.onSuccess { (displayNumber, detail, tables) ->
            busy = false
            pendingOrder = null
            if (clearDraftTableId != null) {
                drafts.remove(clearDraftTableId)
                lastRemovedDraft = null
                saveDrafts()
            }
            if (tables != null) salonSummaries = tables
            if (detail != null) {
                activeTable = detail.table
                tableDetail = detail
                screen = Screen.TABLE
            } else {
                screen = Screen.SALON
            }
            val label = if (displayNumber.isNotBlank()) "Pedido #$displayNumber enviado!" else "Pedido enviado para a cozinha!"
            setInfo(label)
            render()
        }.onFailure { err ->
            busy = false
            pendingOrder = orderStore.load(apiUrl)
            handleAsyncError(err) { submitPendingOrder(pendingOrder ?: order, operator, clearDraftTableId) }
        }
    }

    // -------------------------------------------------------------------------
    // SCREEN: PAYMENT & TABLE RELEASE
    // -------------------------------------------------------------------------

    private fun openPaymentScreen(table: Table, detail: TableDetail) {
        activeTable = table
        tableDetail = detail
        paymentScope = PaymentScope.VALUE
        paymentMethod = PaymentMethod.CREDIT
        paymentCapture = CaptureOption.EXTERNAL_POS
        paymentAmountCents = detail.remainingTotal
        paymentSelectedItemIds.clear()
        cashReceivedCents = null
        activeTerminalIntent = null
        clearBanner()
        screen = Screen.PAYMENT
        render()
    }

    private fun renderPayment() {
        val table = activeTable ?: return backToSalon()
        val detail = tableDetail ?: return openTable(table)
        val s = session ?: return renderLogin()
        val remaining = detail.remainingTotal

        root.addView(
            topHeader(
                title = "Receber · ${table.name}",
                subtitle = "Em aberto: ${money(remaining)}",
                onBack = {
                    if (activeTerminalIntent == null && !busy) {
                        screen = Screen.TABLE
                        render()
                    }
                },
            ),
        )

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f,
            )
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(24))
        }

        if (!s.permissions.canClose) {
            content.addView(
                cardLayout(KomaColors.DANGER_BG, KomaColors.DANGER_BORDER, pad = 16).apply {
                    addView(textView("Sem permissão de fechamento", 15f, bold = true, color = KomaColors.DANGER_INK))
                    addView(textView("O administrador desabilitou fechamento de conta para este garçom.", 13f, color = KomaColors.DANGER_INK).apply { topMargin(6) })
                },
            )
            scroll.addView(content)
            root.addView(scroll)
            return
        }

        bannerMessage?.let { msg ->
            content.addView(bannerView(msg, bannerError, bannerRetryAction).apply { bottomMargin(10) })
        }

        // Pending PlugPag / terminal recovery view
        activeTerminalIntent?.let { activeIntent ->
            content.addView(buildActiveTerminalRecoveryCard(activeIntent))
            scroll.addView(content)
            root.addView(scroll)
            return
        }

        // Step 1: Scope (Value vs Items)
        val scopeCard = cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 14).apply { bottomMargin(12) }
        scopeCard.addView(textView("1. Quanto cobrar", 15f, bold = true))
        val scopeRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            topMargin(10)
        }
        PaymentScope.values().forEachIndexed { idx, sc ->
            scopeRow.addView(
                pillButton(sc.label, paymentScope == sc, enabled = !busy) {
                    paymentScope = sc
                    if (sc == PaymentScope.VALUE) {
                        paymentAmountCents = remaining
                    } else {
                        paymentAmountCents = detail.items
                            .filter { it.id in paymentSelectedItemIds }
                            .sumOf { it.priceCents }
                            .coerceAtMost(remaining)
                    }
                    render()
                }.apply {
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                        if (idx == 0) rightMargin = dp(6) else leftMargin = dp(6)
                    }
                },
            )
        }
        scopeCard.addView(scopeRow)

        if (paymentScope == PaymentScope.VALUE) {
            scopeCard.addView(
                textView(money(paymentAmountCents), 28f, bold = true, color = KomaColors.ACCENT, tabular = true).apply {
                    gravity = Gravity.CENTER_HORIZONTAL
                    topMargin(14)
                },
            )
            // Fraction shortcuts
            val fractionRow = scrollChips {
                listOf(
                    "Total" to remaining,
                    "1/2" to (remaining / 2L),
                    "1/3" to (remaining / 3L),
                    "1/4" to (remaining / 4L),
                ).forEach { (label, amount) ->
                    if (amount > 0L) {
                        addView(
                            pillButton("$label · ${money(amount)}", paymentAmountCents == amount, enabled = !busy) {
                                paymentAmountCents = amount
                                render()
                            }.apply { rightMargin(8) },
                        )
                    }
                }
            }.apply { topMargin(10) }
            scopeCard.addView(fractionRow)
            // Touch numeric keypad (cents)
            scopeCard.addView(buildTouchAmountNumpad(remaining).apply { topMargin(12) })
        } else {
            val unpaidItems = detail.items.filter { !it.paid && !it.canceled }
            if (unpaidItems.isEmpty()) {
                scopeCard.addView(textView("Todos os itens individuais já constam pagos.", 13f, color = KomaColors.INK_MUTED).apply { topMargin(10) })
            } else {
                val quickAll = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    topMargin(10)
                }
                quickAll.addView(
                    buildActionButton("Marcar todos", KomaColors.RAISED, KomaColors.INK, minHeightDp = 44) {
                        paymentSelectedItemIds.addAll(unpaidItems.map { it.id })
                        paymentAmountCents = unpaidItems.sumOf { it.priceCents }.coerceAtMost(remaining)
                        render()
                    }.apply { rightMargin(8) },
                )
                quickAll.addView(
                    buildActionButton("Limpar", KomaColors.RAISED, KomaColors.INK_MUTED, minHeightDp = 44) {
                        paymentSelectedItemIds.clear()
                        paymentAmountCents = 0L
                        render()
                    },
                )
                scopeCard.addView(quickAll)

                unpaidItems.forEach { item ->
                    val checked = item.id in paymentSelectedItemIds
                    val row = LinearLayout(this).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = Gravity.CENTER_VERTICAL
                        minimumHeight = dp(48)
                        setPadding(dp(12), dp(8), dp(12), dp(8))
                        background = roundedDrawable(
                            fill = if (checked) KomaColors.RAISED else KomaColors.CANVAS,
                            stroke = if (checked) KomaColors.ACCENT else KomaColors.CARD_BORDER,
                            radiusDp = 10,
                        )
                        topMargin(8)
                        isClickable = true
                        setOnClickListener {
                            if (checked) paymentSelectedItemIds.remove(item.id) else paymentSelectedItemIds.add(item.id)
                            paymentAmountCents = unpaidItems
                                .filter { it.id in paymentSelectedItemIds }
                                .sumOf { it.priceCents }
                                .coerceAtMost(remaining)
                            render()
                        }
                    }
                    row.addView(
                        textView(item.name, 14f, bold = checked).apply {
                            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                        },
                    )
                    row.addView(textView(money(item.priceCents), 14f, bold = true, color = if (checked) KomaColors.ACCENT else KomaColors.INK, tabular = true))
                    scopeCard.addView(row)
                }
                scopeCard.addView(
                    textView("Selecionado: ${money(paymentAmountCents)}", 16f, bold = true, color = KomaColors.ACCENT, tabular = true)
                        .apply { topMargin(10) },
                )
            }
        }
        content.addView(scopeCard)

        // Step 2: Method
        val methodCard = cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 14).apply { bottomMargin(12) }
        methodCard.addView(textView("2. Forma de pagamento", 15f, bold = true))
        val methodRow = scrollChips {
            PaymentMethod.values().forEach { method ->
                addView(
                    pillButton(method.label, paymentMethod == method, enabled = !busy) {
                        paymentMethod = method
                        if (method == PaymentMethod.CASH) {
                            paymentCapture = CaptureOption.CASH_MANUAL
                            cashReceivedCents = paymentAmountCents
                        } else if (paymentCapture == CaptureOption.CASH_MANUAL) {
                            paymentCapture = CaptureOption.EXTERNAL_POS
                        }
                        render()
                    }.apply { rightMargin(8) },
                )
            }
        }.apply { topMargin(10) }
        methodCard.addView(methodRow)
        content.addView(methodCard)

        // Step 3: Capture / Cash change
        val captureCard = cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 14).apply { bottomMargin(12) }
        if (paymentMethod == PaymentMethod.CASH) {
            captureCard.addView(textView("3. Valor recebido e troco", 15f, bold = true))
            val received = cashReceivedCents ?: paymentAmountCents
            val change = (received - paymentAmountCents).coerceAtLeast(0L)
            captureCard.addView(
                textView("Recebido: ${money(received)}", 20f, bold = true, tabular = true).apply { topMargin(10) },
            )
            captureCard.addView(
                textView(
                    if (received < paymentAmountCents) "Falta ${money(paymentAmountCents - received)}" else "Troco: ${money(change)}",
                    16f,
                    bold = true,
                    color = if (received < paymentAmountCents) KomaColors.DANGER_INK else KomaColors.READY_BORDER,
                    tabular = true,
                ).apply { topMargin(4) },
            )
            val cashChips = scrollChips {
                listOf(
                    "Exato" to paymentAmountCents,
                    "+R$ 5" to (received + 500L),
                    "+R$ 10" to (received + 1000L),
                    "+R$ 20" to (received + 2000L),
                    "R$ 50" to 5000L,
                    "R$ 100" to 10000L,
                    "R$ 200" to 20000L,
                ).forEach { (label, valCents) ->
                    addView(
                        pillButton(label, received == valCents, enabled = !busy) {
                            cashReceivedCents = valCents
                            render()
                        }.apply { rightMargin(8) },
                    )
                }
            }.apply { topMargin(10) }
            captureCard.addView(cashChips)
        } else {
            val plugPagHardware = plugPagClient.isServiceAvailable()
            val canRunIntegrated = plugPagHardware || s.providerIntegratedAvailable
            captureCard.addView(textView("3. Onde cobrar", 15f, bold = true))

            val externalSelected = paymentCapture == CaptureOption.EXTERNAL_POS
            captureCard.addView(
                selectableOptionCard(
                    title = "Outra maquininha (registrar pagamento)",
                    subtitle = "Você passa na maquininha avulsa e registra a confirmação no KÔMA.",
                    selected = externalSelected,
                    enabled = !busy,
                ) {
                    paymentCapture = CaptureOption.EXTERNAL_POS
                    render()
                }.apply { topMargin(10) },
            )

            val plugPagSelected = paymentCapture == CaptureOption.INTEGRATED_PAGBANK
            val plugPagSubtitle = when {
                plugPagHardware && plugPagClient.isAuthenticated() ->
                    "Terminal PagBank PlugPag pronto neste dispositivo."
                plugPagHardware ->
                    "Serviço PlugPag detectado, aguardando ativação do terminal."
                s.providerIntegratedAvailable ->
                    "PlugPag ausente neste celular — modo simulado ativo no backend."
                else ->
                    "${plugPagClient.statusDescription()} (Disponível apenas em terminal PagBank homologado.)"
            }
            captureCard.addView(
                selectableOptionCard(
                    title = if (plugPagHardware) {
                        "Nesta maquininha (PagBank PlugPag)"
                    } else if (s.providerIntegratedAvailable) {
                        "Nesta maquininha (Simulador integrado)"
                    } else {
                        "Nesta maquininha (PagBank indisponível)"
                    },
                    subtitle = plugPagSubtitle,
                    selected = plugPagSelected,
                    enabled = canRunIntegrated && !busy,
                ) {
                    paymentCapture = CaptureOption.INTEGRATED_PAGBANK
                    render()
                }.apply { topMargin(10) },
            )

            if (plugPagHardware && !plugPagClient.isAuthenticated()) {
                captureCard.addView(
                    buildActionButton("Ativar terminal PagBank", KomaColors.RAISED, KomaColors.ACCENT, minHeightDp = 44) {
                        showPinpadActivationDialog()
                    }.apply { topMargin(10) },
                )
            }
            if (plugPagSelected && paymentAmountCents in 1L..99L) {
                captureCard.addView(
                    textView("Valor mínimo no PagBank PlugPag: R$ 1,00.", 12f, color = KomaColors.WARN_INK)
                        .apply { topMargin(8) },
                )
            }
        }
        content.addView(captureCard)

        scroll.addView(content)
        root.addView(scroll)

        // Bottom confirm CTA
        val validAmount = paymentAmountCents in 1L..remaining
        val validCash = paymentMethod != PaymentMethod.CASH || (cashReceivedCents ?: paymentAmountCents) >= paymentAmountCents
        val validPlugPag = paymentCapture != CaptureOption.INTEGRATED_PAGBANK || paymentAmountCents >= 100L
        val canSubmit = !busy && validAmount && validCash && validPlugPag

        val actionLabel = when {
            busy -> "Processando pagamento..."
            paymentMethod == PaymentMethod.CASH -> "Confirmar Dinheiro · ${money(paymentAmountCents)}"
            paymentCapture == CaptureOption.INTEGRATED_PAGBANK -> "Cobrar na maquininha · ${money(paymentAmountCents)}"
            else -> "Registrar pagamento · ${money(paymentAmountCents)}"
        }
        root.addView(
            stickyFooter(
                listOf(
                    FooterAction(
                        label = actionLabel,
                        bgColor = if (canSubmit) KomaColors.ACCENT else KomaColors.DISABLED_BG,
                        fgColor = if (canSubmit) KomaColors.ACCENT_INK else KomaColors.DISABLED_INK,
                        enabled = canSubmit,
                    ) {
                        startPaymentExecution(table, detail)
                    },
                ),
            ),
        )
    }

    private fun buildTouchAmountNumpad(maxCents: Long): LinearLayout {
        val pad = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val rows = listOf(
            listOf("1", "2", "3"),
            listOf("4", "5", "6"),
            listOf("7", "8", "9"),
            listOf("00", "0", "Apagar"),
        )
        rows.forEach { keys ->
            val r = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                topMargin(6)
            }
            keys.forEachIndexed { idx, key ->
                val btn = buildActionButton(
                    title = key,
                    bgColor = if (key == "Apagar") KomaColors.DANGER_BG else KomaColors.RAISED,
                    textColor = if (key == "Apagar") KomaColors.DANGER_INK else KomaColors.INK,
                    minHeightDp = 46,
                    enabled = !busy,
                ) {
                    val next = when (key) {
                        "Apagar" -> paymentAmountCents / 10L
                        "00" -> (paymentAmountCents * 100L).coerceAtMost(maxCents)
                        else -> {
                            val digit = key.toLong()
                            (paymentAmountCents * 10L + digit).coerceAtMost(maxCents)
                        }
                    }
                    paymentAmountCents = next
                    render()
                }.apply {
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                        if (idx > 0) leftMargin = dp(4)
                        if (idx < 2) rightMargin = dp(4)
                    }
                }
                r.addView(btn)
            }
            pad.addView(r)
        }
        return pad
    }

    private fun buildActiveTerminalRecoveryCard(active: ActiveTerminalIntent): LinearLayout =
        cardLayout(KomaColors.SURFACE, KomaColors.WARN_INK, pad = 16).apply {
            addView(textView("Cobrança em andamento no terminal", 16f, bold = true, color = KomaColors.WARN_INK))
            addView(
                textView(
                    "${money(active.intent.amountCents)} · Ref PagBank: ${StableOperationKey.userReference10(active.operationKey)}",
                    14f,
                    bold = true,
                    tabular = true,
                ).apply { topMargin(8) },
            )
            addView(
                textView(
                    "Se a cobrança já foi aprovada na maquininha ou caiu a conexão, consulte a última transação aprovada sem cobrar novamente.",
                    13f,
                    color = KomaColors.INK_MUTED,
                ).apply { topMargin(6) },
            )
            addView(
                buildActionButton(
                    title = if (busy) "Consultando terminal..." else "Verificar pagamento no terminal",
                    bgColor = KomaColors.ACCENT,
                    textColor = KomaColors.ACCENT_INK,
                    enabled = !busy,
                ) {
                    runIntegratedTerminalStep(active)
                }.apply { topMargin(14) },
            )
            addView(
                buildActionButton(
                    title = "Cancelar intenção",
                    bgColor = KomaColors.DANGER_BG,
                    textColor = KomaColors.DANGER_INK,
                    enabled = !busy,
                ) {
                    cancelActiveIntent(active)
                }.apply { topMargin(10) },
            )
        }

    private fun startPaymentExecution(table: Table, detail: TableDetail) {
        if (busy) return
        val amount = paymentAmountCents
        val itemIds = if (paymentScope == PaymentScope.ITEMS) paymentSelectedItemIds.toList() else emptyList()

        if (paymentMethod == PaymentMethod.CASH || paymentCapture == CaptureOption.EXTERNAL_POS) {
            val captureParam = if (paymentMethod == PaymentMethod.CASH) null else "registro_externo"
            val received = if (paymentMethod == PaymentMethod.CASH) (cashReceivedCents ?: amount) else null
            busy = true
            clearBanner()
            render()
            runAsync {
                val created = api.createPaymentIntent(
                    tableId = table.id,
                    amountCents = amount,
                    method = paymentMethod.apiValue,
                    capture = captureParam,
                    scope = paymentScope.apiValue,
                    itemIds = itemIds,
                )
                val outcome = api.confirmManualPayment(created.id, received)
                val updatedTables = runCatching { api.salon() }.getOrNull()
                val updatedDetail = if (outcome.tableReleased) null else runCatching { api.detail(table) }.getOrNull()
                Triple(outcome, updatedDetail, updatedTables)
            }.onSuccess { (outcome, updatedDetail, updatedTables) ->
                busy = false
                if (updatedTables != null) salonSummaries = updatedTables
                if (outcome.tableReleased) {
                    tableDetail = null
                    activeTable = null
                    screen = Screen.SALON
                    val trocoNote = if (outcome.trocoCents > 0L) " Troco: ${money(outcome.trocoCents)}." else ""
                    setInfo("Pagamento confirmado! ${table.name} liberada.$trocoNote")
                } else {
                    tableDetail = updatedDetail
                    screen = Screen.TABLE
                    val trocoNote = if (outcome.trocoCents > 0L) " · Troco: ${money(outcome.trocoCents)}" else ""
                    setInfo("Pagamento parcial de ${money(outcome.paidCents)} confirmado$trocoNote.")
                }
                render()
            }.onFailure { err ->
                busy = false
                handleAsyncError(err) { render() }
            }
            return
        }

        // Integrated PagBank (or simulator in dev backend)
        busy = true
        clearBanner()
        render()
        val plugPagHardware = plugPagClient.isServiceAvailable()
        runAsync {
            val created = api.createPaymentIntent(
                tableId = table.id,
                amountCents = amount,
                method = paymentMethod.apiValue,
                capture = "provider_integrado",
                scope = paymentScope.apiValue,
                itemIds = itemIds,
            )
            val opKey = StableOperationKey.forIntent(created.id, terminalState.terminalId, "pagbank")
            ActiveTerminalIntent(created, opKey, table, simulatedBackend = !plugPagHardware)
        }.onSuccess { active ->
            busy = false
            activeTerminalIntent = active
            runIntegratedTerminalStep(active)
        }.onFailure { err ->
            busy = false
            handleAsyncError(err) { render() }
        }
    }

    private fun runIntegratedTerminalStep(active: ActiveTerminalIntent) {
        if (busy) return
        busy = true
        clearBanner()
        render()
        runAsync {
            val bridge = if (active.simulatedBackend) {
                FakeTerminalPaymentBridge()
            } else {
                PlugPagTerminalPaymentBridge(plugPagClient)
            }
            val runtime = TerminalRuntime(
                backend = terminalBackend,
                coordinator = TerminalCoordinator(bridge, operationStore),
                provider = "pagbank",
                terminalId = terminalState.terminalId,
            )
            val ack = runtime.runOnce(active.intent.id, active.operationKey)
            val detail = runCatching { api.detail(active.table) }.getOrNull()
            val tables = runCatching { api.salon() }.getOrNull()
            Triple(ack, detail, tables)
        }.onSuccess { (ack, detail, tables) ->
            busy = false
            if (tables != null) salonSummaries = tables
            if (ack.status == "liquidada") {
                activeTerminalIntent = null
                val stillOccupied = detail?.checks?.isNotEmpty() == true
                if (!stillOccupied) {
                    tableDetail = null
                    activeTable = null
                    screen = Screen.SALON
                    setInfo("Pagamento aprovado e confirmado! ${active.table.name} liberada.")
                } else {
                    tableDetail = detail
                    screen = Screen.TABLE
                    setInfo("Pagamento aprovado (${money(active.intent.amountCents)}).")
                }
            } else if (ack.status in setOf("recusada", "cancelada", "falha", "expirada")) {
                activeTerminalIntent = null
                setError("Pagamento não aprovado (${ack.status}). Tente novamente ou escolha outra forma.")
            } else {
                // Remains in processando -> keep recovery card visible
                setInfo("Status atual: ${ack.status}. Use Verificar pagamento caso já tenha passado o cartão.")
            }
            render()
        }.onFailure { err ->
            busy = false
            setError(messageFor(err))
            render()
        }
    }

    private fun cancelActiveIntent(active: ActiveTerminalIntent) {
        if (busy) return
        busy = true
        clearBanner()
        render()
        runAsync {
            api.cancelPaymentIntent(active.intent.id, "Cancelado no SmartPOS antes da liquidação")
        }.onSuccess { status ->
            busy = false
            activeTerminalIntent = null
            setInfo("Intenção encerrada ($status).")
            render()
        }.onFailure { err ->
            busy = false
            handleAsyncError(err) { render() }
        }
    }

    private fun showPinpadActivationDialog() {
        val input = inputField("Código de ativação PagBank", "")
        AlertDialog.Builder(this)
            .setTitle("Ativar terminal PagBank")
            .setView(input)
            .setPositiveButton("Ativar") { _, _ ->
                val code = input.text.toString().trim()
                if (code.isBlank()) return@setPositiveButton
                busy = true
                render()
                runAsync { plugPagClient.activatePinpad(code) }
                    .onSuccess { res ->
                        busy = false
                        if (res.result == 0) {
                            setInfo("Terminal PagBank ativado com sucesso.")
                        } else {
                            setError(res.message ?: "Falha na ativação (${res.errorCode ?: res.result}).")
                        }
                        render()
                    }
                    .onFailure { err ->
                        busy = false
                        setError(messageFor(err))
                        render()
                    }
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    // -------------------------------------------------------------------------
    // SCREEN: RECENT OPERATIONS & RECEIPT
    // -------------------------------------------------------------------------

    private fun openHistory() {
        busy = true
        loadingText = "Carregando últimas cobranças..."
        clearBanner()
        screen = Screen.HISTORY
        render()
        runAsync { api.recentOperations(5) }
            .onSuccess { list ->
                busy = false
                loadingText = null
                recentOps = list
                render()
            }
            .onFailure { err ->
                busy = false
                loadingText = null
                handleAsyncError(err) { openHistory() }
            }
    }

    private fun renderHistory() {
        root.addView(
            topHeader(
                title = "Histórico recente",
                subtitle = "Últimas cobranças SmartPOS",
                onBack = { backToSalon() },
                rightActions = listOf("Atualizar" to { openHistory() }),
            ),
        )

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f,
            )
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(24))
        }

        loadingText?.let { msg ->
            content.addView(loadingCard(msg))
            scroll.addView(content)
            root.addView(scroll)
            return
        }

        bannerMessage?.let { msg ->
            content.addView(bannerView(msg, bannerError, bannerRetryAction).apply { bottomMargin(10) })
        }

        if (recentOps.isEmpty()) {
            content.addView(
                cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 18).apply {
                    addView(textView("Nenhuma operação recente registrada.", 14f, bold = true))
                },
            )
        } else {
            recentOps.forEach { op ->
                val card = cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 14).apply {
                    bottomMargin(10)
                    isClickable = true
                    setOnClickListener { showReceiptDialog(op) }

                    val top = LinearLayout(this@MainActivity).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = Gravity.CENTER_VERTICAL
                    }
                    top.addView(
                        textView("${op.tableName} · ${money(op.amountCents)}", 16f, bold = true, tabular = true).apply {
                            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                        },
                    )
                    val (bBg, bFg) = when (op.status) {
                        "liquidada" -> KomaColors.READY_CAP to KomaColors.READY_INK
                        "pendente", "processando" -> KomaColors.WARN_BG to KomaColors.WARN_INK
                        "recusada", "falha" -> KomaColors.DANGER_BG to KomaColors.DANGER_INK
                        else -> KomaColors.RAISED to KomaColors.INK_MUTED
                    }
                    top.addView(badgePill(op.status.replaceFirstChar { it.uppercase() }, bBg, bFg))
                    addView(top)

                    val captureLabel = when (op.capture) {
                        "provider_integrado" -> "Maquininha integrada"
                        "registro_externo" -> "Maquininha externa"
                        else -> "Dinheiro / manual"
                    }
                    addView(
                        textView("${op.method.uppercase()} · $captureLabel · ${op.operatorName}", 12f, color = KomaColors.INK_MUTED)
                            .apply { topMargin(6) },
                    )
                    if (!op.providerReference.isNullOrBlank()) {
                        addView(textView("Ref: ${op.providerReference}", 12f, color = KomaColors.ACCENT).apply { topMargin(4) })
                    }
                    if (!op.providerLastError.isNullOrBlank()) {
                        addView(textView("Detalhe: ${op.providerLastError}", 12f, color = KomaColors.DANGER_INK).apply { topMargin(4) })
                    }
                }
                content.addView(card)
            }
        }

        scroll.addView(content)
        root.addView(scroll)
    }

    private fun showReceiptDialog(op: RecentOperation) {
        val restName = session?.restaurant?.name ?: terminalState.boundRestaurant?.name ?: "KÔMA"
        val receiptText = buildString {
            appendLine("COMPROVANTE DE OPERAÇÃO")
            appendLine(restName)
            appendLine("------------------------------")
            appendLine("Mesa: ${op.tableName}")
            appendLine("Valor: ${money(op.amountCents)}")
            appendLine("Forma: ${op.method.uppercase()} (${op.capture})")
            appendLine("Status: ${op.status}")
            appendLine("Operador: ${op.operatorName}")
            if (!op.providerReference.isNullOrBlank()) appendLine("Referência: ${op.providerReference}")
            if (!op.paymentId.isNullOrBlank()) appendLine("Pagamento ID: ${op.paymentId}")
            appendLine("Intent ID: ${op.intentId}")
            appendLine("Data: ${op.createdAt}")
        }
        AlertDialog.Builder(this)
            .setTitle("Comprovante")
            .setMessage(receiptText)
            .setPositiveButton("Compartilhar") { _, _ ->
                val share = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, receiptText)
                }
                startActivity(Intent.createChooser(share, "Enviar comprovante"))
            }
            .setNegativeButton("Fechar", null)
            .show()
    }

    // -------------------------------------------------------------------------
    // OPERATOR SWITCHER & ERROR HANDLING
    // -------------------------------------------------------------------------

    private fun showOperatorSwitcher() {
        val items = mutableListOf<String>()
        val actions = mutableListOf<() -> Unit>()
        val activeId = terminalState.activeOperatorId

        terminalState.operators.forEach { op ->
            val tag = when {
                op.operator.id == activeId -> "(Ativo agora)"
                op.hasActiveToken() -> "(Troca rápida)"
                else -> "(Confirmar senha)"
            }
            items.add("${op.operator.name} $tag")
            actions.add {
                if (op.operator.id == activeId) return@add
                if (op.hasActiveToken()) {
                    activeToken = op.token
                    terminalState = terminalStore.switchOperator(apiUrl, op.operator.id)
                    usernameDraft = op.username
                    restoreBoundSession(op)
                } else {
                    activeToken = ""
                    session = null
                    usernameDraft = op.username
                    passwordDraft = ""
                    screen = Screen.LOGIN
                    render()
                }
            }
        }
        items.add("+ Entrar com outro operador")
        actions.add {
            activeToken = ""
            session = null
            usernameDraft = ""
            passwordDraft = ""
            screen = Screen.LOGIN
            render()
        }
        items.add("Desvincular terminal do restaurante")
        actions.add { confirmUnbindTerminal() }

        AlertDialog.Builder(this)
            .setTitle("Operadores do terminal")
            .setItems(items.toTypedArray()) { _, which -> actions[which]() }
            .setNegativeButton("Fechar", null)
            .show()
    }

    private fun handleAsyncError(err: Throwable, retry: (() -> Unit)? = null) {
        if (err is ApiFailure && err.requiresReauth) {
            val activeOp = terminalState.activeOperator
            if (activeOp != null) {
                terminalState = terminalStore.invalidateOperatorToken(apiUrl, activeOp.operator.id)
                usernameDraft = activeOp.username
            }
            activeToken = ""
            session = null
            passwordDraft = ""
            loadingText = null
            screen = Screen.LOGIN
            setError(err.message)
            render()
            return
        }
        setError(messageFor(err), retry = retry)
        render()
    }

    private fun backToSalon() {
        activeTable = null
        tableDetail = null
        clearBanner()
        screen = Screen.SALON
        render()
    }

    // -------------------------------------------------------------------------
    // UI COMPONENT FACTORIES (KÔMA DESIGN SYSTEM, ZERO EMOJIS, >=48DP TOUCH)
    // -------------------------------------------------------------------------

    private data class FooterAction(
        val label: String,
        val bgColor: Int,
        val fgColor: Int,
        val enabled: Boolean = true,
        val onClick: () -> Unit,
    )

    private fun topHeader(
        title: String,
        subtitle: String,
        onBack: (() -> Unit)? = null,
        rightActions: List<Pair<String, () -> Unit>> = emptyList(),
        statusChip: Pair<String, Triple<Int, Int, Int>>? = null,
    ): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(KomaColors.HEADER)
        setPadding(dp(14), dp(12), dp(14), dp(12))

        val row1 = LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        if (onBack != null) {
            row1.addView(
                buildActionButton("<", KomaColors.RAISED, KomaColors.INK, minHeightDp = 44, minWidthDp = 48) {
                    onBack()
                }.apply { rightMargin(10) },
            )
        }
        val titleCol = LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        titleCol.addView(
            textView(title, 18f, bold = true).apply {
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
            },
        )
        titleCol.addView(
            textView(subtitle, 12f, color = KomaColors.FREE_INK).apply {
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
            },
        )
        row1.addView(titleCol)
        if (statusChip != null) {
            row1.addView(badgePill(statusChip.first, statusChip.second.first, statusChip.second.second))
        }
        addView(row1)

        if (rightActions.isNotEmpty()) {
            val actionRow = scrollChips {
                rightActions.forEach { (label, onClick) ->
                    addView(
                        pillButton(
                            label = label,
                            selected = false,
                            bgOverride = KomaColors.RAISED,
                            fgOverride = KomaColors.INK,
                            enabled = !busy,
                        ) { onClick() }.apply { rightMargin(8) },
                    )
                }
            }.apply { topMargin(10) }
            addView(actionRow)
        }
    }

    private fun stickyFooter(actions: List<FooterAction>): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        setBackgroundColor(KomaColors.HEADER)
        setPadding(dp(12), dp(10), dp(12), dp(12))
        actions.forEachIndexed { idx, action ->
            val btn = buildActionButton(
                title = action.label,
                bgColor = action.bgColor,
                textColor = action.fgColor,
                minHeightDp = 50,
                enabled = action.enabled,
                onClick = action.onClick,
            ).apply {
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                    if (idx > 0) leftMargin = dp(4)
                    if (idx < actions.lastIndex) rightMargin = dp(4)
                }
            }
            addView(btn)
        }
    }

    private fun cardLayout(bg: Int, border: Int, pad: Int, radius: Int = 14): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(pad), dp(pad), dp(pad), dp(pad))
            background = roundedDrawable(bg, border, radius)
        }

    private fun loadingCard(message: String): LinearLayout =
        cardLayout(KomaColors.SURFACE, KomaColors.CARD_BORDER, pad = 24).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            addView(ProgressBar(this@MainActivity))
            addView(textView(message, 14f, bold = true).apply { topMargin(12) })
        }

    private fun bannerView(message: String, isError: Boolean, retry: (() -> Unit)?): LinearLayout =
        cardLayout(
            bg = if (isError) KomaColors.DANGER_BG else KomaColors.RAISED,
            border = if (isError) KomaColors.DANGER_BORDER else KomaColors.ACCENT,
            pad = 12,
        ).apply {
            addView(
                textView(
                    message,
                    13f,
                    bold = true,
                    color = if (isError) KomaColors.DANGER_INK else KomaColors.ACCENT,
                ),
            )
            if (retry != null) {
                addView(
                    buildActionButton("Tentar novamente", KomaColors.ACCENT, KomaColors.ACCENT_INK, minHeightDp = 44) {
                        retry()
                    }.apply { topMargin(10) },
                )
            }
        }

    private fun selectableOptionCard(
        title: String,
        subtitle: String,
        selected: Boolean,
        enabled: Boolean,
        onClick: () -> Unit,
    ): LinearLayout = cardLayout(
        bg = when {
            !enabled -> KomaColors.DISABLED_BG
            selected -> KomaColors.RAISED
            else -> KomaColors.CANVAS
        },
        border = when {
            !enabled -> KomaColors.CARD_BORDER
            selected -> KomaColors.ACCENT
            else -> KomaColors.CARD_BORDER
        },
        pad = 12,
        radius = 12,
    ).apply {
        isEnabled = enabled
        isClickable = enabled
        if (enabled) setOnClickListener { onClick() }
        addView(
            textView(
                title,
                14f,
                bold = true,
                color = if (enabled) KomaColors.INK else KomaColors.DISABLED_INK,
            ),
        )
        addView(
            textView(
                subtitle,
                12f,
                color = if (enabled) KomaColors.INK_MUTED else KomaColors.DISABLED_INK,
            ).apply { topMargin(4) },
        )
    }

    private fun buildActionButton(
        title: String,
        bgColor: Int,
        textColor: Int,
        borderColor: Int? = null,
        minHeightDp: Int = 48,
        minWidthDp: Int = 48,
        enabled: Boolean = true,
        onClick: () -> Unit,
    ): Button = Button(this).apply {
        text = title
        isAllCaps = false
        textSize = 14f
        typeface = Typeface.DEFAULT_BOLD
        fontFeatureSettings = "tnum"
        setTextColor(if (enabled) textColor else KomaColors.DISABLED_INK)
        minimumHeight = dp(minHeightDp)
        minHeight = dp(minHeightDp)
        minimumWidth = dp(minWidthDp)
        setPadding(dp(14), dp(8), dp(14), dp(8))
        background = roundedDrawable(
            fill = if (enabled) bgColor else KomaColors.DISABLED_BG,
            stroke = borderColor,
            radiusDp = 12,
        )
        isEnabled = enabled
        setOnClickListener { onClick() }
    }

    private fun pillButton(
        label: String,
        selected: Boolean,
        bgOverride: Int? = null,
        fgOverride: Int? = null,
        enabled: Boolean = true,
        onClick: () -> Unit,
    ): Button = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 13f
        typeface = if (selected) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        fontFeatureSettings = "tnum"
        val bg = when {
            !enabled -> KomaColors.DISABLED_BG
            selected -> KomaColors.ACCENT
            else -> bgOverride ?: KomaColors.RAISED
        }
        val fg = when {
            !enabled -> KomaColors.DISABLED_INK
            selected -> KomaColors.ACCENT_INK
            else -> fgOverride ?: KomaColors.INK
        }
        setTextColor(fg)
        minimumHeight = dp(44)
        minHeight = dp(44)
        setPadding(dp(14), dp(6), dp(14), dp(6))
        background = roundedDrawable(
            fill = bg,
            stroke = if (selected) KomaColors.READY_BORDER else KomaColors.CARD_BORDER,
            radiusDp = 22,
        )
        isEnabled = enabled
        setOnClickListener { onClick() }
    }

    private fun stepperControl(
        qty: Int,
        plusEnabled: Boolean = true,
        onMinus: () -> Unit,
        onPlus: () -> Unit,
    ): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(
            buildActionButton("-", KomaColors.RAISED, KomaColors.INK, minHeightDp = 44, minWidthDp = 46, enabled = qty > 0) {
                onMinus()
            },
        )
        addView(
            textView(qty.toString(), 15f, bold = true, tabular = true).apply {
                gravity = Gravity.CENTER
                minWidth = dp(34)
                setPadding(dp(6), 0, dp(6), 0)
            },
        )
        addView(
            buildActionButton("+", KomaColors.RAISED, KomaColors.ACCENT, minHeightDp = 44, minWidthDp = 46, enabled = plusEnabled) {
                onPlus()
            },
        )
    }

    private fun badgePill(label: String, bg: Int, fg: Int): TextView = TextView(this).apply {
        text = label
        textSize = 11f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(fg)
        setPadding(dp(8), dp(4), dp(8), dp(4))
        background = roundedDrawable(bg, stroke = null, radiusDp = 12)
    }

    private fun metricCol(label: String, value: String, valueColor: Int): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            addView(textView(label, 12f, color = KomaColors.INK_MUTED))
            addView(textView(value, 16f, bold = true, color = valueColor, tabular = true).apply { topMargin(4) })
        }

    private fun scrollChips(build: LinearLayout.() -> Unit): HorizontalScrollView =
        HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            addView(
                LinearLayout(this@MainActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    build()
                },
            )
        }

    private fun textView(
        content: String,
        sizeSp: Float,
        bold: Boolean = false,
        color: Int = KomaColors.INK,
        tabular: Boolean = false,
    ): TextView = TextView(this).apply {
        text = content
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        setTextColor(color)
        if (tabular) fontFeatureSettings = "tnum"
    }

    private fun inputField(hintText: String, initialValue: String): EditText = EditText(this).apply {
        hint = hintText
        setText(initialValue)
        setTextColor(KomaColors.INK)
        setHintTextColor(KomaColors.INK_MUTED)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        minimumHeight = dp(48)
        setPadding(dp(14), dp(10), dp(14), dp(10))
        background = roundedDrawable(KomaColors.CANVAS, KomaColors.CARD_BORDER, radiusDp = 10)
    }

    private fun statePalette(state: TableVisualState): Triple<Int, Int, Int> = when (state) {
        TableVisualState.FREE -> Triple(KomaColors.FREE_CAP, KomaColors.FREE_INK, KomaColors.CARD_BORDER)
        TableVisualState.READY -> Triple(KomaColors.READY_CAP, KomaColors.READY_INK, KomaColors.READY_BORDER)
        TableVisualState.OCCUPIED, TableVisualState.MERGED -> Triple(KomaColors.OCCUPIED_CAP, KomaColors.OCCUPIED_INK, KomaColors.OCCUPIED_BORDER)
        TableVisualState.PAYMENT -> Triple(KomaColors.PAYMENT_CAP, KomaColors.PAYMENT_INK, KomaColors.PAYMENT_BORDER)
        TableVisualState.SERVED -> Triple(KomaColors.SERVED_CAP, KomaColors.SERVED_INK, KomaColors.FREE_CAP)
    }

    private fun roundedDrawable(fill: Int, stroke: Int? = null, radiusDp: Int = 12): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(radiusDp).toFloat()
            setColor(fill)
            if (stroke != null) setStroke(dp(1), stroke)
        }

    private fun noteContains(note: String, chip: String): Boolean =
        note.split(",").any { it.trim().equals(chip.trim(), ignoreCase = true) }

    private fun toggleNoteToken(note: String, chip: String): String {
        val parts = note.split(",").map { it.trim() }.filter { it.isNotBlank() }.toMutableList()
        val existingIdx = parts.indexOfFirst { it.equals(chip.trim(), ignoreCase = true) }
        if (existingIdx >= 0) parts.removeAt(existingIdx) else parts.add(chip.trim())
        return parts.joinToString(", ")
    }

    private fun simpleWatcher(onChanged: (String) -> Unit): TextWatcher = object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
        override fun afterTextChanged(s: Editable?) {
            onChanged(s?.toString().orEmpty())
        }
    }

    private fun View.topMargin(valueDp: Int) {
        val lp = (layoutParams as? ViewGroup.MarginLayoutParams)
            ?: LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        lp.topMargin = dp(valueDp)
        layoutParams = lp
    }

    private fun View.bottomMargin(valueDp: Int) {
        val lp = (layoutParams as? ViewGroup.MarginLayoutParams)
            ?: LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        lp.bottomMargin = dp(valueDp)
        layoutParams = lp
    }

    private fun View.leftMargin(valueDp: Int) {
        val lp = (layoutParams as? ViewGroup.MarginLayoutParams)
            ?: LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        lp.leftMargin = dp(valueDp)
        layoutParams = lp
    }

    private fun View.rightMargin(valueDp: Int) {
        val lp = (layoutParams as? ViewGroup.MarginLayoutParams)
            ?: LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        lp.rightMargin = dp(valueDp)
        layoutParams = lp
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun clearBanner() {
        bannerMessage = null
        bannerError = false
        bannerRetryAction = null
    }

    private fun setInfo(message: String) {
        bannerMessage = message
        bannerError = false
        bannerRetryAction = null
    }

    private fun setError(message: String, retry: (() -> Unit)? = null) {
        bannerMessage = message
        bannerError = true
        bannerRetryAction = retry
    }

    private fun messageFor(err: Throwable): String = when (err) {
        is ApiFailure -> err.message ?: "Erro na comunicação com o KÔMA."
        is IOException -> "Sem conexão com o KÔMA. Verifique o Wi-Fi ou 4G e tente novamente."
        else -> err.message?.takeIf { it.isNotBlank() } ?: "Falha inesperada na operação."
    }

    // -------------------------------------------------------------------------
    // SAFE BACKGROUND DISPATCH
    // -------------------------------------------------------------------------

    private class AsyncTaskHandle<T>(
        private val mainHandler: Handler,
        private val destroyed: AtomicBoolean,
        executor: ExecutorService,
        work: () -> T,
    ) {
        private var onOk: ((T) -> Unit)? = null
        private var onErr: ((Throwable) -> Unit)? = null

        init {
            executor.execute {
                val result = runCatching(work)
                if (destroyed.get()) return@execute
                mainHandler.post {
                    if (destroyed.get()) return@post
                    result.fold(
                        onSuccess = { onOk?.invoke(it) },
                        onFailure = { onErr?.invoke(it) },
                    )
                }
            }
        }

        fun onSuccess(block: (T) -> Unit): AsyncTaskHandle<T> {
            onOk = block
            return this
        }

        fun onFailure(block: (Throwable) -> Unit): AsyncTaskHandle<T> {
            onErr = block
            return this
        }
    }

    private fun <T> runAsync(work: () -> T): AsyncTaskHandle<T> =
        AsyncTaskHandle(mainHandler, destroyed, executor, work)
}
