package br.com.koma.smartpos.dev

import android.app.Activity
import android.app.AlertDialog
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.text.method.PasswordTransformationMethod
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import java.io.IOException
import java.util.concurrent.Executors
import br.com.koma.smartpos.bridge.JdkHttpTransport

class MainActivity : Activity() {
    private enum class Screen { LOGIN, SALON, TABLE, MENU, CUSTOMIZE, REVIEW, PENDING }

    private val worker = Executors.newSingleThreadExecutor()
    private val requests by lazy { PendingOrderStore(filesDir) }
    private val baseUrl get() = BuildConfig.KOMA_API_URL
    private lateinit var api: WaiterApi
    private var token = ""
    private var session: Session? = null
    private var screen = Screen.LOGIN
    private var salon = Salon(emptyList(), emptyList())
    private var table: Table? = null
    private var check: Check? = null
    private var consumption = emptyList<Consumption>()
    private var menu: Menu? = null
    private var category: Category? = null
    private val lines = mutableListOf<Line>()
    private var pending: PendingOrder? = null
    private var busy = false
    private var notice = ""
    private lateinit var root: LinearLayout
    private lateinit var body: LinearLayout
    private lateinit var footer: LinearLayout
    private lateinit var feedback: TextView
    private lateinit var progress: ProgressBar

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        @Suppress("DEPRECATION")
        window.statusBarColor = page
        @Suppress("DEPRECATION")
        window.navigationBarColor = page
        api = WaiterApi(JdkHttpTransport(baseUrl, { token }, connectTimeoutMs = 8_000, readTimeoutMs = 15_000))
        showLogin()
    }

    override fun onDestroy() {
        worker.shutdown()
        super.onDestroy()
    }

    @Deprecated("Android 7 and later terminal firmware")
    override fun onBackPressed() {
        if (busy) return
        when (screen) {
            Screen.LOGIN -> super.onBackPressed()
            Screen.SALON -> confirmLogout()
            Screen.TABLE -> showSalon()
            Screen.MENU -> backFromMenu()
            Screen.CUSTOMIZE, Screen.REVIEW -> showMenu()
            Screen.PENDING -> confirmLogout()
        }
    }

    private fun showLogin(message: String = "") {
        frame(Screen.LOGIN, "KÔMA", "Garçom", "Use sua conta do restaurante.")
        val username = field("E-mail ou telefone", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)
        val password = field("Senha", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
            .apply { transformationMethod = PasswordTransformationMethod.getInstance() }
        body.addView(username)
        body.addView(password)
        fun login(restaurantId: Int? = null) {
            val login = username.text.toString().trim()
            val secret = password.text.toString()
            if (login.isBlank() || secret.isBlank()) {
                report("Preencha o usuário e a senha.")
                return
            }
            hideKeyboard()
            runRequest(action = {
                token = api.authenticate(login, secret, restaurantId)
                try {
                    api.session()
                } catch (failure: Exception) {
                    token = ""
                    throw failure
                }
            }, onError = { failure ->
                if (failure is ApiFailure && failure.restaurants.isNotEmpty()) {
                    AlertDialog.Builder(this).setTitle("Escolha o restaurante")
                        .setItems(failure.restaurants.map { it.name }.toTypedArray()) { _, index ->
                            login(failure.restaurants[index].id)
                        }.setNegativeButton("Voltar", null).show()
                } else {
                    report(messageFor(failure))
                }
            }) { active ->
                password.text.clear()
                session = active
                if (loadPending()) {
                    if (pending != null) showPending() else loadSalon(active)
                }
            }
        }
        footer.button("Entrar", primary = true) { login() }
        report(message)
    }

    private fun confirmLogout() {
        AlertDialog.Builder(this).setTitle("Sair do KÔMA?")
            .setMessage(when {
                pending != null -> "O envio pendente ficará disponível quando você entrar novamente."
                lines.isNotEmpty() -> "Os itens que ainda não foram enviados serão descartados."
                else -> "Você poderá entrar novamente com sua conta."
            })
            .setNegativeButton("Voltar", null)
            .setPositiveButton("Sair") { _, _ -> logout() }.show()
    }

    private fun logout(message: String = "") {
        token = ""
        session = null
        pending = null
        table = null
        check = null
        lines.clear()
        menu = null
        category = null
        consumption = emptyList()
        salon = Salon(emptyList(), emptyList())
        notice = ""
        showLogin(message)
    }

    private fun loadSalon(context: Session? = null) {
        showSalon(loading = true)
        runRequest(action = {
            val active = context ?: api.session()
            active to if (active.enabled && active.open) api.salon() else Salon(emptyList(), emptyList())
        }) { (active, fresh) ->
            session = active
            salon = fresh
            showSalon()
        }
    }

    private fun showSalon(loading: Boolean = false) {
        table = null
        check = null
        val active = requireNotNull(session)
        frame(Screen.SALON, active.restaurant.name, "Mesas", active.operator.name)
        if (notice.isNotEmpty()) {
            body.label(notice, 15, accentDark, bold = true)
            notice = ""
        }
        if (!loading) {
            when {
                !active.enabled -> body.label("SmartPOS indisponível neste restaurante.", 16)
                !active.open -> body.label("Caixa fechado. Peça a abertura do turno para lançar pedidos.", 16)
                salon.tables.isEmpty() -> body.label("Nenhuma mesa disponível.", 16)
                else -> {
                    val occupied = salon.checks.mapTo(hashSetOf()) { it.tableId }
                    salon.tables.chunked(2).forEach { pair ->
                        val row = row()
                        body.addView(row)
                        pair.forEach { entry ->
                            val status = if (entry.id in occupied) "Em atendimento" else "Livre"
                            val item = button("${entry.name}\n$status", false) { loadTable(entry) }.apply {
                                gravity = Gravity.CENTER_VERTICAL or Gravity.START
                                minHeight = dp(68)
                            }
                            row.addView(item, LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = dp(6) })
                        }
                        if (pair.size == 1) row.addView(View(this), LinearLayout.LayoutParams(0, 0, 1f))
                    }
                }
            }
        }
        footer.addView(row().apply {
            addView(button("Atualizar", false) { loadSalon() }, LinearLayout.LayoutParams(0, -2, 1f))
            addView(button("Sair", false) { confirmLogout() }, LinearLayout.LayoutParams(0, -2, 1f))
        })
    }

    private fun loadTable(entry: Table) {
        runRequest(action = { api.consumption(entry) }) { fresh ->
            table = entry
            check = salon.checks.firstOrNull { it.tableId == entry.id && it.name.isBlank() }
                ?: salon.checks.firstOrNull { it.tableId == entry.id }
            consumption = fresh
            showTable()
        }
    }

    private fun showTable() {
        val current = requireNotNull(table)
        frame(Screen.TABLE, "Salão", current.name, back = { showSalon() })
        if (consumption.isEmpty()) body.label("Nenhum item lançado.", 15, muted)
        consumption.forEach {
            val subtitle = listOfNotNull(it.orderNumber.takeIf(String::isNotBlank)?.let { n -> "Pedido $n" },
                it.status.takeIf(String::isNotBlank)).joinToString(" · ")
            body.entry(it.name, subtitle)
        }
        footer.button("Novo pedido", primary = true) {
            runRequest(action = { api.menu() }) { fresh ->
                category = null
                menu = fresh
                showMenu()
            }
        }
    }

    private fun showMenu() {
        val current = requireNotNull(table)
        val catalog = requireNotNull(menu)
        val selected = category
        frame(Screen.MENU, current.name, selected?.name ?: "Cardápio", back = { backFromMenu() })
        if (selected == null) {
            if (catalog.categories.isEmpty()) body.label("Nenhum produto disponível.", 16, muted)
            catalog.categories.forEach { entry ->
                body.button(entry.name) { category = entry; showMenu() }
            }
        } else {
            catalog.products.filter { it.categoryId == selected.id }.forEach { product ->
                body.button("${product.name}\n${money(product.price)}") {
                    if (totalUnits() >= 200) report("O pedido atingiu o limite de 200 itens.")
                    else if (product.groups.isEmpty()) {
                        addLine(Line(product, emptyList(), "", 1))
                        report("")
                        updateMenuFooter()
                    } else customize(product)
                }
            }
        }
        updateMenuFooter()
    }

    private fun updateMenuFooter() {
        footer.removeAllViews()
        footer.button("Revisar pedido · ${totalUnits()}", primary = true, enabled = lines.isNotEmpty()) {
            showReview()
        }
    }

    private fun backFromMenu() {
        when {
            category != null -> { category = null; showMenu() }
            lines.isEmpty() -> showTable()
            else -> AlertDialog.Builder(this).setTitle("Descartar este pedido?")
                .setNegativeButton("Continuar pedido", null)
                .setPositiveButton("Descartar") { _, _ -> lines.clear(); showTable() }.show()
        }
    }

    private fun customize(product: Product) {
        frame(Screen.CUSTOMIZE, requireNotNull(table).name, product.name, money(product.price), back = { showMenu() })
        val selection = linkedMapOf<Option, Int>()
        product.groups.forEach { group ->
            body.label(group.name, 17, ink, bold = true)
            body.label(groupHint(group), 14, muted)
            group.options.forEach { option ->
                val label = if (option.price == 0L) option.name else "${option.name} · +${money(option.price)}"
                if (group.portions) {
                    val controls = row()
                    body.addView(controls)
                    val count = TextView(this).apply { gravity = Gravity.CENTER; text = "0"; setTextColor(ink) }
                    controls.addView(TextView(this).apply {
                        text = label
                        setTextColor(ink)
                        textSize = 15f
                    }, LinearLayout.LayoutParams(0, -2, 1f))
                    controls.addView(button("−", false) {
                        val next = ((selection[option] ?: 0) - 1).coerceAtLeast(0)
                        if (next == 0) selection.remove(option) else selection[option] = next
                        count.text = next.toString()
                    }.apply { contentDescription = "Diminuir ${option.name}" })
                    controls.addView(count, LinearLayout.LayoutParams(dp(30), -2))
                    controls.addView(button("+", false) {
                        if (group.options.sumOf { selection[it] ?: 0 } < group.max) {
                            val next = (selection[option] ?: 0) + 1
                            selection[option] = next
                            count.text = next.toString()
                        } else report("Limite de escolhas em ${group.name}.")
                    }.apply { contentDescription = "Aumentar ${option.name}" })
                } else {
                    body.addView(CheckBox(this).apply {
                        text = label
                        textSize = 15f
                        setTextColor(ink)
                        buttonTintList = ColorStateList.valueOf(accentDark)
                        minHeight = dp(48)
                        setOnCheckedChangeListener { box, checked ->
                            if (!checked) selection.remove(option)
                            else if (group.options.count { selection.containsKey(it) } < group.max) selection[option] = 1
                            else {
                                box.isChecked = false
                                report("Limite de escolhas em ${group.name}.")
                            }
                        }
                    })
                }
            }
        }
        val note = noteField()
        body.addView(note)
        footer.button("Adicionar ao pedido", primary = true) {
            val missingGroup = product.groups.firstOrNull { group -> group.options.sumOf { selection[it] ?: 0 } < group.min }
            if (missingGroup != null) report("Complete as escolhas em ${missingGroup.name}.")
            else {
                hideKeyboard()
                addLine(Line(product, selection.flatMap { (option, count) -> List(count) { option } },
                    note.text.toString().trim(), 1))
                showMenu()
            }
        }
    }

    private fun groupHint(group: Group): String = when {
        group.min == group.max -> "Escolha ${group.min}"
        group.min == 0 -> "Opcional · até ${group.max}"
        else -> "Escolha de ${group.min} a ${group.max}"
    }

    private fun addLine(line: Line) {
        val index = lines.indexOfFirst {
            it.product == line.product && it.note == line.note && it.options.groupingBy(Option::id).eachCount() ==
                line.options.groupingBy(Option::id).eachCount()
        }
        if (index < 0) lines.add(line) else lines[index] = lines[index].copy(quantity = lines[index].quantity + 1)
    }

    private fun showReview() {
        val current = requireNotNull(table)
        frame(Screen.REVIEW, current.name, "Revisar pedido", back = { showMenu() })
        val checks = salon.checks.filter { it.tableId == current.id }
        if (checks.size > 1) body.button("Comanda · ${check?.label.orEmpty()}") {
            AlertDialog.Builder(this).setTitle("Selecionar comanda")
                .setItems(checks.map { it.label }.toTypedArray()) { _, index ->
                    check = checks[index]
                    showReview()
                }.show()
        }
        lines.forEachIndexed { index, line ->
            body.entry("${line.quantity} × ${line.product.name}", money(line.unitPrice * line.quantity))
            val notes = (line.options.map { it.name } + listOf(line.note)).filter(String::isNotBlank)
            if (notes.isNotEmpty()) body.label(notes.joinToString(" · "), 14, muted)
            body.addView(row().apply {
                addView(button("−", false) { changeQuantity(index, -1) }.apply {
                    contentDescription = "Diminuir ${line.product.name}"
                })
                addView(button("+", false, enabled = totalUnits() < 200) { changeQuantity(index, 1) }.apply {
                    contentDescription = "Aumentar ${line.product.name}"
                })
                addView(button("Observação", false) {
                    val note = noteField().apply { setText(line.note) }
                    AlertDialog.Builder(this@MainActivity).setTitle(line.product.name).setView(note)
                        .setNegativeButton("Voltar", null)
                        .setPositiveButton("Salvar") { _, _ ->
                            lines[index] = line.copy(note = note.text.toString().trim())
                            showReview()
                        }.show()
                }, LinearLayout.LayoutParams(0, -2, 1f))
            })
        }
        if (lines.isEmpty()) body.label("Nenhum item no pedido.", 16, muted)
        val total = money(lines.sumOf { it.unitPrice * it.quantity })
        footer.label("Subtotal estimado · $total", 16, ink, bold = true)
        footer.button("Enviar pedido", primary = true, enabled = lines.isNotEmpty()) {
            val order = PendingOrder.create(current, check, requireNotNull(session).operator, lines)
            submit(order)
        }
    }

    private fun changeQuantity(index: Int, delta: Int) {
        val next = lines[index].quantity + delta
        if (next <= 0) lines.removeAt(index) else lines[index] = lines[index].copy(quantity = next)
        showReview()
    }

    private fun totalUnits() = lines.sumOf(Line::quantity)

    private fun storageKey(active: Session = requireNotNull(session)) =
        "$baseUrl/${active.restaurant.id}/${active.operator.id}"

    private fun loadPending(): Boolean = try {
        pending = requests.read(storageKey())
        true
    } catch (_: Exception) {
        frame(Screen.PENDING, requireNotNull(session).restaurant.name, "Envio indisponível")
        body.label("Confira no caixa se o pedido foi registrado antes de relançar os itens.", 16)
        footer.button("Sair") { confirmLogout() }
        false
    }

    private fun submit(order: PendingOrder) {
        val active = requireNotNull(session)
        val key = storageKey(active)
        runRequest(action = {
            api.submit(order, active.operator.id) { saved ->
                try {
                    requests.write(key, saved)
                } catch (failure: Exception) {
                    throw IOException("Falha ao guardar o envio.", failure)
                }
            }
        }, onError = { failure ->
            if (!loadPending()) return@runRequest
            if (failure is ApiFailure && failure.status == 401) {
                logout("Sessão encerrada. Entre novamente.")
            } else if (pending != null) {
                showPending()
                report(if (failure is ApiFailure && !failure.uncertain) messageFor(failure)
                    else "Envio sem confirmação. Tente confirmar novamente.")
            } else report(messageFor(failure))
        }) { number ->
            pending = null
            lines.clear()
            menu = null
            category = null
            notice = if (number.isBlank()) "Pedido registrado." else "Pedido $number registrado."
            loadSalon()
        }
    }

    private fun showPending() {
        val order = requireNotNull(pending)
        frame(Screen.PENDING, order.tableName, "Envio pendente")
        body.label("Confirme o envio antes de lançar os mesmos itens de novo.", 16)
        footer.button("Confirmar envio", primary = true) { submit(order) }
        footer.button("Sair") { confirmLogout() }
    }

    private fun messageFor(failure: Exception) = when (failure) {
        is ApiFailure -> failure.message.orEmpty()
        is IOException -> "Falha de conexão ou de armazenamento. Tente novamente."
        else -> "Não foi possível ler a resposta do KÔMA."
    }

    private fun <T> runRequest(
        action: () -> T,
        onError: (Exception) -> Unit = { failure ->
            if (failure is ApiFailure && failure.status == 401 && session != null) {
                logout("Sessão encerrada. Entre novamente.")
            } else report(messageFor(failure))
        },
        onSuccess: (T) -> Unit,
    ) {
        if (busy) return
        setBusy(true)
        report("")
        worker.execute {
            val result = try { Result.success(action()) } catch (failure: Exception) { Result.failure(failure) }
            runOnUiThread {
                if (isDestroyed || isFinishing) return@runOnUiThread
                setBusy(false)
                result.fold(onSuccess) { onError(it as Exception) }
            }
        }
    }

    private fun setBusy(value: Boolean) {
        busy = value
        progress.visibility = if (value) View.VISIBLE else View.INVISIBLE
    }

    private fun report(message: String) {
        feedback.text = message
        feedback.visibility = if (message.isBlank()) View.GONE else View.VISIBLE
    }

    private fun frame(target: Screen, context: String, title: String, subtitle: String = "", back: (() -> Unit)? = null) {
        screen = target
        root = column().apply {
            setBackgroundColor(page)
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
            setPadding(dp(16), dp(6), dp(16), dp(8))
        }
        @Suppress("DEPRECATION")
        root.setOnApplyWindowInsetsListener { view, insets ->
            view.setPadding(dp(16) + insets.systemWindowInsetLeft, dp(6) + insets.systemWindowInsetTop,
                dp(16) + insets.systemWindowInsetRight, dp(8) + insets.systemWindowInsetBottom)
            insets
        }
        setContentView(root)
        if (back != null) root.button("‹ Voltar", action = back)
        root.label(context, 14, accentDark, bold = true)
        root.label(title, 26, ink, bold = true)
        if (subtitle.isNotBlank()) root.label(subtitle, 14, muted)
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = true
            indeterminateTintList = ColorStateList.valueOf(accentDark)
            visibility = View.INVISIBLE
            contentDescription = "Carregando"
        }
        root.addView(progress, LinearLayout.LayoutParams(-1, dp(6)))
        body = column()
        root.addView(ScrollView(this).apply {
            addView(body)
            isFillViewport = true
        }, LinearLayout.LayoutParams(-1, 0, 1f))
        feedback = root.label("", 14, Color.rgb(158, 32, 44)).apply {
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        footer = column()
        root.addView(footer)
        report("")
    }

    private fun noteField() = field("Observação (opcional)", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES)
        .apply { filters = arrayOf(InputFilter.LengthFilter(180)) }

    private fun field(label: String, type: Int) = EditText(this).apply {
        hint = label
        contentDescription = label
        setSingleLine(true)
        inputType = type
        setTextColor(ink)
        setHintTextColor(muted)
        textSize = 16f
        minHeight = dp(52)
        setPadding(dp(12), dp(8), dp(12), dp(8))
        background = shape(Color.WHITE, border)
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) }
    }

    private fun LinearLayout.entry(title: String, subtitle: String) {
        addView(column().apply {
            setPadding(dp(12), dp(4), dp(12), dp(4))
            background = shape(Color.WHITE, border)
            label(title, 16, ink, bold = true)
            if (subtitle.isNotBlank()) label(subtitle, 14, muted)
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(6) }
        })
    }

    private fun LinearLayout.label(value: String, size: Int, color: Int = ink, bold: Boolean = false): TextView =
        TextView(this@MainActivity).apply {
            text = value
            textSize = size.toFloat()
            setTextColor(color)
            setPadding(0, dp(3), 0, dp(5))
            if (bold) setTypeface(typeface, Typeface.BOLD)
            addView(this)
        }

    private fun LinearLayout.button(label: String, primary: Boolean = false, enabled: Boolean = true, action: () -> Unit) {
        addView(this@MainActivity.button(label, primary, enabled, action),
            LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(6) })
    }

    private fun button(label: String, primary: Boolean, enabled: Boolean = true, action: () -> Unit): Button =
        Button(this).apply {
            text = label
            textSize = 15f
            isAllCaps = false
            setTextColor(if (enabled) ink else muted)
            minHeight = dp(48)
            minWidth = dp(48)
            setPadding(dp(10), dp(6), dp(10), dp(6))
            background = android.graphics.drawable.RippleDrawable(
                ColorStateList.valueOf(Color.argb(30, 0, 71, 52)),
                shape(if (primary && enabled) mint else Color.WHITE, if (primary && enabled) mint else border), null,
            )
            isEnabled = enabled
            setOnClickListener { if (!busy) action() }
        }

    private fun hideKeyboard() {
        val view = currentFocus ?: return
        getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(view.windowToken, 0)
        view.clearFocus()
    }

    private fun shape(fill: Int, stroke: Int) = GradientDrawable().apply {
        setColor(fill)
        setStroke(dp(1), stroke)
        cornerRadius = dp(12).toFloat()
    }

    private fun row() = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
    private fun column() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    private fun dp(value: Int) = (value * resources.displayMetrics.density + 0.5f).toInt()

    private companion object {
        val page = Color.rgb(245, 249, 247)
        val mint = Color.rgb(5, 196, 157)
        val accentDark = Color.rgb(0, 104, 84)
        val ink = Color.rgb(7, 28, 23)
        val muted = Color.rgb(73, 92, 85)
        val border = Color.rgb(210, 224, 216)
    }
}
