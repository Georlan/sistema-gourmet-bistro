package br.com.koma.print.core

import java.nio.charset.Charset
import java.text.Normalizer
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Renderizador ESC/POS do KÔMA Print Android compatível com o Core Universal de Impressão.
 *
 * Não conhece regras de negócio nem monta pedido na borda: recebe o `payload_text`
 * canônico do `PrintJob` e projeta para a largura física (ex.: Kapbom KA-1445, 58 mm, 32 colunas).
 */
object EscPos58Renderer {
    val INITIALIZE: ByteArray = byteArrayOf(0x1B, 0x40) // ESC @
    val PORTUGUESE_CODE_PAGE: ByteArray = byteArrayOf(0x1B, 0x74, 0x03) // ESC t 3 (PC860)
    val PARTIAL_CUT: ByteArray = byteArrayOf(0x1D, 0x56, 0x42, 0x00) // GS V B 0

    const val SIMULATED_CUT_MARKER = "[CUT]"
    const val DOUBLE_HEIGHT_ON = "\u001B!\u0010"
    const val NORMAL_SIZE = "\u001B!\u0000"
    const val BOLD_ON = "\u001BE\u0001"
    const val BOLD_OFF = "\u001BE\u0000"

    private val ANY_CONTROL_REGEX = Regex("\\u001B(?:M|E|!|3)[\\s\\S]")
    private val LEADING_CONTROL_REGEX = Regex("^(?:\\u001B(?:M|E|!|3)[\\s\\S])+")
    private val TRAILING_CONTROL_REGEX = Regex("(?:\\u001B(?:M|E|!|3)[\\s\\S])+$")
    private val MULTI_SPACE_REGEX = Regex(" {2,}")
    private val ACCOUNT_HEADER_REGEX = Regex("^CONTAS?:\\s*#", RegexOption.IGNORE_CASE)
    private val MESA_ABERTURA_REGEX = Regex(
        "MESA:\\s*(.+?)\\s+ABERTURA:\\s*(\\d{1,2}:\\d{2})",
        RegexOption.IGNORE_CASE,
    )
    private val DATA_HORA_REGEX = Regex(
        "DATA:\\s*([^\\s]+).*?HORA:\\s*(\\d{1,2}:\\d{2})",
        RegexOption.IGNORE_CASE,
    )
    private val MESA_SIMPLE_REGEX = Regex("^MESA:\\s*\\S+$", RegexOption.IGNORE_CASE)
    private val PEDIDO_SIMPLE_REGEX = Regex("^PEDIDO\\s+#\\S+$", RegexOption.IGNORE_CASE)
    private val ITEM_LINE_REGEX = Regex("^\\d+x\\s+", RegexOption.IGNORE_CASE)
    private val COMPOSITION_LABEL_REGEX = Regex("^([^:]{2,40}):\\s*")

    fun visibleText(value: String): String = ANY_CONTROL_REGEX.replace(value, "")

    private data class EdgeControls(
        val leading: String,
        val visible: String,
        val trailing: String,
    )

    private fun extractEdgeControls(line: String): EdgeControls {
        var rest = line
        val leadingMatch = LEADING_CONTROL_REGEX.find(rest)
        val leading = leadingMatch?.value.orEmpty()
        if (leadingMatch != null) {
            rest = rest.substring(leadingMatch.range.last + 1)
        }

        val trailingMatch = TRAILING_CONTROL_REGEX.find(rest)
        val trailing = trailingMatch?.value.orEmpty()
        if (trailingMatch != null) {
            rest = rest.substring(0, trailingMatch.range.first)
        }

        return EdgeControls(
            leading = leading,
            visible = visibleText(rest),
            trailing = trailing,
        )
    }

    private fun preserveControls(line: String, replacementVisible: String): String {
        val controls = extractEdgeControls(line)
        return controls.leading + replacementVisible + controls.trailing
    }

    fun sourceColumns(payloadText: String): Int {
        val separatorLengths = payloadText.lineSequence()
            .map { visibleText(it).trim() }
            .filter { it.isNotEmpty() && it.all { ch -> ch == it[0] } && (it[0] == '-' || it[0] == '=') }
            .map { it.length }
            .toList()
        if (separatorLengths.isNotEmpty()) {
            return separatorLengths.maxOrNull() ?: 0
        }
        return payloadText.lineSequence()
            .map { visibleText(it) }
            .filter { it.isNotBlank() }
            .maxOfOrNull { it.length } ?: 0
    }

    private fun centerInWidth(text: String, width: Int): String {
        if (text.length >= width) return text
        val totalPad = width - text.length
        val leftPad = totalPad / 2
        val rightPad = totalPad - leftPad
        return " ".repeat(leftPad) + text + " ".repeat(rightPad)
    }

    private fun wrapWords(text: String, width: Int): List<String> {
        val cleanWidth = max(width, 1)
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return listOf("")
        if (trimmed.length <= cleanWidth) return listOf(trimmed)

        val result = mutableListOf<String>()
        var current = StringBuilder()

        for (word in trimmed.split(Regex("\\s+"))) {
            if (word.isEmpty()) continue
            if (current.isEmpty()) {
                var remainingWord = word
                while (remainingWord.length > cleanWidth) {
                    result.add(remainingWord.substring(0, cleanWidth))
                    remainingWord = remainingWord.substring(cleanWidth)
                }
                if (remainingWord.isNotEmpty()) {
                    current.append(remainingWord)
                }
            } else if (current.length + 1 + word.length <= cleanWidth) {
                current.append(' ').append(word)
            } else {
                result.add(current.toString())
                current = StringBuilder()
                var remainingWord = word
                while (remainingWord.length > cleanWidth) {
                    result.add(remainingWord.substring(0, cleanWidth))
                    remainingWord = remainingWord.substring(cleanWidth)
                }
                if (remainingWord.isNotEmpty()) {
                    current.append(remainingWord)
                }
            }
        }
        if (current.isNotEmpty()) {
            result.add(current.toString())
        }
        return if (result.isEmpty()) listOf(trimmed.take(cleanWidth)) else result
    }

    private fun wrapVisibleLine(visible: String, columns: Int): List<String> {
        if (visible.isEmpty()) return listOf("")
        val stripped = visible.trim()
        if (stripped.isEmpty()) return listOf("")

        if (stripped.all { it == stripped[0] } && (stripped[0] == '-' || stripped[0] == '=')) {
            return listOf(stripped[0].toString().repeat(columns))
        }

        val leftPadding = visible.indexOfFirst { it != ' ' }.let { if (it < 0) visible.length else it }
        val rightPadding = visible.length - (visible.indexOfLast { it != ' ' } + 1)

        if (
            leftPadding > 0 &&
            rightPadding > 0 &&
            abs(leftPadding - rightPadding) <= 2 &&
            stripped.length <= columns
        ) {
            return listOf(centerInWidth(stripped, columns))
        }

        val gaps = MULTI_SPACE_REGEX.findAll(stripped).toList()
        if (gaps.isNotEmpty()) {
            val widestGap = gaps.maxByOrNull { it.value.length }!!
            val left = stripped.substring(0, widestGap.range.first).trimEnd()
            val right = stripped.substring(widestGap.range.last + 1).trimStart()
            if (left.isNotEmpty() && right.isNotEmpty()) {
                if (left.length + right.length + 1 <= columns) {
                    return listOf(left.padEnd(columns - right.length, ' ') + right)
                }
                val wrappedLeft = wrapWords(left, columns).toMutableList()
                if (right.length <= columns) {
                    // Reaproveita a última linha de nomes longos para o valor,
                    // sem deslocar preços ou cortar texto na bobina de 58 mm.
                    val itemPrice = ITEM_LINE_REGEX.containsMatchIn(left) &&
                        Regex("""^R\$\s*\d""", RegexOption.IGNORE_CASE).containsMatchIn(right)
                    val lastLine = wrappedLeft.lastOrNull()
                    if (itemPrice && lastLine != null && lastLine.length + right.length + 1 <= columns) {
                        wrappedLeft[wrappedLeft.lastIndex] = lastLine.padEnd(columns - right.length, ' ') + right
                    } else {
                        wrappedLeft.add(right.padStart(columns, ' '))
                    }
                } else {
                    wrappedLeft.addAll(wrapWords(right, columns))
                }
                return wrappedLeft
            }
        }

        if (visible.length <= columns) {
            return listOf(visible)
        }

        val indent = min(leftPadding, max(columns - 1, 0))
        val prefix = " ".repeat(indent)
        val available = max(columns - indent, 1)
        return wrapWords(stripped, available).map { prefix + it }
    }

    fun fitTextToColumns(payloadText: String, columns: Int?): String {
        if (columns == null || columns <= 0) return payloadText
        val srcCols = sourceColumns(payloadText)
        if (srcCols > 0 && columns >= srcCols) return payloadText

        val output = mutableListOf<String>()
        for (rawLine in payloadText.split("\n")) {
            val controls = extractEdgeControls(rawLine)
            val wrapped = wrapVisibleLine(controls.visible, columns).toMutableList()
            if (wrapped.isEmpty()) {
                output.add(controls.leading + controls.trailing)
                continue
            }
            wrapped[0] = controls.leading + wrapped[0]
            wrapped[wrapped.lastIndex] = wrapped[wrapped.lastIndex] + controls.trailing
            output.addAll(wrapped)
        }
        return output.joinToString("\n")
    }

    private fun compactPair(left: String, right: String, columns: Int): List<String> {
        val l = left.trim()
        val r = right.trim()
        if (l.isNotEmpty() && r.isNotEmpty() && l.length + r.length + 1 <= columns) {
            return listOf(l.padEnd(columns - r.length, ' ') + r)
        }
        return listOf(l, r).filter { it.isNotEmpty() }
    }

    fun projectCompactSemantics(payloadText: String, columns: Int): String {
        val rawLines = payloadText.split("\n")
        val lines = rawLines.filter { visibleText(it).trim().lowercase() != "via completa da mesa" }.toMutableList()
        val visible = lines.map { visibleText(it).trim() }.toMutableList()

        val sourceWidth = max(sourceColumns(payloadText), columns)
        for (idx in visible.indices) {
            if (visible[idx].lowercase() == "conta da mesa") {
                lines[idx] = preserveControls(lines[idx], centerInWidth("FECHAMENTO DA MESA", sourceWidth))
                visible[idx] = "FECHAMENTO DA MESA"
                break
            }
        }

        val mesaIdx = visible.indexOfFirst { "MESA:" in it && "ABERTURA:" in it }.takeIf { it >= 0 }
        val accountIdx = visible.indexOfFirst { ACCOUNT_HEADER_REGEX.containsMatchIn(it) }.takeIf { it >= 0 }
        val dateIdx = visible.indexOfFirst { "DATA:" in it && "HORA:" in it }.takeIf { it >= 0 }
        val operatorIdx = visible.indexOfFirst { it.uppercase().startsWith("IMPRESSO POR:") }.takeIf { it >= 0 }

        if (mesaIdx != null && accountIdx != null && dateIdx != null && operatorIdx != null) {
            val mesaMatch = MESA_ABERTURA_REGEX.find(visible[mesaIdx])
            val dateMatch = DATA_HORA_REGEX.find(visible[dateIdx])
            if (mesaMatch != null && dateMatch != null) {
                val tableValue = mesaMatch.groupValues[1].trim()
                val openedAt = mesaMatch.groupValues[2].trim()
                val accountText = visible[accountIdx].trim()
                val dateText = dateMatch.groupValues[1].trim()
                val printedAt = dateMatch.groupValues[2].trim()
                val operator = visible[operatorIdx].substringAfter(":", "").trim()

                val replacement = mutableListOf<String>()
                replacement.addAll(compactPair("MESA: $tableValue", accountText, columns))
                replacement.addAll(compactPair("ABERTA: $openedAt", "IMPRESSA: $printedAt", columns))
                replacement.add("DATA: $dateText")
                replacement.add("OPERADOR: $operator")

                val start = listOf(mesaIdx, accountIdx, dateIdx, operatorIdx).minOrNull()!!
                val end = listOf(mesaIdx, accountIdx, dateIdx, operatorIdx).maxOrNull()!!
                val controls = extractEdgeControls(lines[mesaIdx])
                if (replacement.isNotEmpty()) {
                    replacement[0] = controls.leading + replacement[0] + controls.trailing
                }
                for (removeIdx in end downTo start) {
                    lines.removeAt(removeIdx)
                }
                lines.addAll(start, replacement)
            }
        }

        val updatedVisible = lines.map { visibleText(it).trim() }.toMutableList()
        var index = 0
        while (index < lines.size - 1) {
            val current = updatedVisible[index]
            val next = updatedVisible[index + 1]
            if (MESA_SIMPLE_REGEX.matches(current) && PEDIDO_SIMPLE_REGEX.matches(next)) {
                val combined = compactPair(current, next, columns)
                if (combined.size == 1) {
                    val mergedLine = preserveControls(lines[index], combined[0])
                    lines[index] = mergedLine
                    lines.removeAt(index + 1)
                    updatedVisible[index] = combined[0]
                    updatedVisible.removeAt(index + 1)
                    continue
                }
            }
            index++
        }

        val withoutBrandFooter = lines.filter {
            visibleText(it).trim().lowercase() != "gerenciado por kôma" &&
                visibleText(it).trim().lowercase() != "gerenciado por koma"
        }.toMutableList()

        for (idx in withoutBrandFooter.indices) {
            val text = visibleText(withoutBrandFooter[idx]).trim().lowercase()
            if (text == "documento não fiscal" || text == "documento nao fiscal") {
                withoutBrandFooter[idx] = preserveControls(
                    withoutBrandFooter[idx],
                    centerInWidth("DOCUMENTO NAO FISCAL", sourceWidth),
                )
                break
            }
        }

        return withoutBrandFooter.joinToString("\n")
    }

    private val optionObservationRegex =
        Regex("""^(\s*)OBS:\s*OP[ÇC][ÕO]ES:\s*(.+)$""", RegexOption.IGNORE_CASE)
    private val amountRegex = Regex("""R\$\s*[\d.,]+""", RegexOption.IGNORE_CASE)

    private fun compact58ReceiptSemantics(payloadText: String): String {
        val lines = payloadText.split("\n")
        val visible = lines.map { visibleText(it).trim() }
        val subtotals = visible.filter { it.uppercase().startsWith("SUBTOTAL ITENS:") }
            .mapNotNull { amountRegex.find(it)?.value?.replace(" ", "") }
        val totals = visible.filter { it.uppercase().startsWith("TOTAL DO PEDIDO:") }
            .mapNotNull { amountRegex.find(it)?.value?.replace(" ", "") }
        val adjustments = visible.any {
            val upper = it.uppercase()
            upper.startsWith("TAXA DE ENTREGA:") || upper.startsWith("DESCONTO ") ||
                upper.startsWith("ACRÉSCIMO:") || upper.startsWith("ACRESCIMO:")
        }
        val skipSubtotal = !adjustments && subtotals.size == 1 &&
            totals.size == 1 && subtotals[0] == totals[0]

        var inCustomer = false
        val compacted = mutableListOf<String>()
        for ((index, raw) in lines.withIndex()) {
            val text = visible[index]
            if (text.uppercase() == "CLIENTE") {
                inCustomer = true
            } else if (
                text.uppercase() in setOf("ITENS", "ENTREGA", "PAGAMENTO") ||
                text.uppercase().startsWith("ITENS ")
            ) {
                inCustomer = false
            }

            if (skipSubtotal && text.uppercase().startsWith("SUBTOTAL ITENS:")) continue
            val controls = extractEdgeControls(raw)
            val choices = optionObservationRegex.find(controls.visible)
            val replacement = when {
                choices != null -> choices.groupValues[1] + "OPCOES: " + choices.groupValues[2]
                inCustomer && text.uppercase().startsWith("NOME:") ->
                    controls.visible.trim().substringAfter(":").trim()
                inCustomer && text.uppercase().startsWith("TELEFONE:") ->
                    controls.visible.replaceFirst("TELEFONE:", "TEL:", ignoreCase = true)
                else -> controls.visible
            }
            compacted.add(
                if (choices != null || (inCustomer && text.uppercase().startsWith("NOME:")) ||
                    (inCustomer && text.uppercase().startsWith("TELEFONE:"))
                ) controls.leading + replacement + controls.trailing else raw,
            )
        }
        return compacted.joinToString("\n")
    }

    private fun collapseCompact58Separators(payloadText: String): String {
        val result = mutableListOf<String>()
        var previousSeparator = false
        for (line in payloadText.split("\n")) {
            val text = visibleText(line).trim()
            val separator = text.isNotEmpty() && text.all { it == text[0] } &&
                (text[0] == '-' || text[0] == '=')
            if (!separator || !previousSeparator) result.add(line)
            previousSeparator = separator
        }
        return result.joinToString("\n")
    }

    private fun normalizeLabel(value: String): String {
        val decomposed = Normalizer.normalize(value.lowercase(), Normalizer.Form.NFKD)
        return decomposed.filter { Character.getType(it) != Character.NON_SPACING_MARK.toInt() }
    }

    private fun compositionLabelRank(label: String): Int? {
        val normalized = normalizeLabel(label)
        return when {
            normalized.startsWith("protein") -> 0
            normalized.startsWith("guarnic") -> 1
            normalized.startsWith("salad") -> 2
            else -> null
        }
    }

    private fun extractCompositionLabel(line: String): String? {
        val visible = visibleText(line).trim()
        return COMPOSITION_LABEL_REGEX.find(visible)?.groupValues?.get(1)?.trim()
    }

    fun restoreCompact58CompositionLayout(payloadText: String): String {
        val lines = payloadText.split("\n").toMutableList()
        var index = 0
        while (index < lines.size) {
            val firstLabel = extractCompositionLabel(lines[index])
            if (firstLabel == null || compositionLabelRank(firstLabel) == null) {
                index++
                continue
            }

            data class CompositionChunk(val label: String, val chunkLines: List<String>, val order: Int)

            val chunks = mutableListOf<CompositionChunk>()
            var currentLabel: String? = null
            var currentLines = mutableListOf<String>()
            var chunkOrder = 0
            var cursor = index

            while (cursor < lines.size) {
                val rawLine = lines[cursor]
                val visible = visibleText(rawLine).trim()
                if (visible.isNotEmpty() && visible.all { it == visible[0] } && (visible[0] == '-' || visible[0] == '=')) {
                    break
                }
                if (ITEM_LINE_REGEX.containsMatchIn(visible)) break
                val upper = visible.uppercase()
                if (upper.startsWith("OBS:") || upper == "PAGAMENTO" || upper == "ITENS") break
                if (upper.startsWith("SUBTOTAL ") || upper.startsWith("TOTAL DO ") || upper.startsWith("TOTAL GERAL ")) break
                if (visible.isEmpty()) {
                    cursor++
                    continue
                }

                val label = extractCompositionLabel(rawLine)
                if (label != null) {
                    if (currentLines.isNotEmpty() && currentLabel != null) {
                        chunks.add(CompositionChunk(currentLabel, currentLines.toList(), chunkOrder++))
                    }
                    currentLabel = label
                    currentLines = mutableListOf(rawLine)
                } else if (currentLines.isNotEmpty()) {
                    currentLines.add(rawLine)
                } else {
                    break
                }
                cursor++
            }

            if (currentLines.isNotEmpty() && currentLabel != null) {
                chunks.add(CompositionChunk(currentLabel, currentLines.toList(), chunkOrder))
            }

            if (chunks.isEmpty()) {
                index++
                continue
            }

            val sortedChunks = chunks.sortedWith(
                compareBy<CompositionChunk> { compositionLabelRank(it.label) ?: 3 }
                    .thenBy { it.order },
            )

            val projected = mutableListOf<String>()
            for (chunk in sortedChunks) {
                val normalizedLines = chunk.chunkLines
                    .map { it.replace(BOLD_ON, "").replace(BOLD_OFF, "") }
                    .toMutableList()
                if (normalizedLines.isEmpty()) continue
                normalizedLines[0] = BOLD_ON + normalizedLines[0]
                normalizedLines[normalizedLines.lastIndex] = normalizedLines[normalizedLines.lastIndex] + BOLD_OFF
                projected.addAll(normalizedLines)
            }

            for (removeIdx in (cursor - 1) downTo index) {
                lines.removeAt(removeIdx)
            }
            lines.addAll(index, projected)
            index += projected.size
        }
        return lines.joinToString("\n")
    }

    fun compactTextLayout(payloadText: String, allowDoubleHeight: Boolean): String {
        val adjusted = if (!allowDoubleHeight) {
            payloadText.replace(DOUBLE_HEIGHT_ON, NORMAL_SIZE)
        } else {
            payloadText
        }
        return adjusted.split("\n")
            .filter { line ->
                visibleText(line).isNotBlank() || ANY_CONTROL_REGEX.containsMatchIn(line)
            }
            .joinToString("\n")
    }

    fun applyCharsetPolicy(payloadText: String, policy: String): String {
        if (policy.trim().lowercase() != "ascii_safe") {
            return payloadText
        }
        val decomposed = Normalizer.normalize(payloadText, Normalizer.Form.NFKD)
        val out = StringBuilder(decomposed.length)
        for (ch in decomposed) {
            if (Character.getType(ch) == Character.NON_SPACING_MARK.toInt()) {
                continue
            }
            if (ch.code < 128) {
                out.append(ch)
                continue
            }
            when (ch) {
                '–', '—' -> out.append('-')
                '“', '”' -> out.append('"')
                '‘', '’' -> out.append('\'')
                'º' -> out.append('o')
                'ª' -> out.append('a')
            }
        }
        return out.toString()
    }

    fun buildEscPosPayload(
        payloadText: String,
        profile: PrinterPaperProfile = PrinterPaperProfile.KAPBOM_KA1445_58MM,
        charsetName: String = "IBM860",
    ): ByteArray {
        val restored = payloadText.replace("\\x00", "\u0000")
        val isCompact58 = profile.semanticLayout.lowercase() == "compact_58"
        val projected = if (isCompact58) {
            compact58ReceiptSemantics(
                restoreCompact58CompositionLayout(
                    projectCompactSemantics(restored, profile.columns),
                ),
            )
        } else {
            restored
        }
        var fitted = fitTextToColumns(projected, profile.columns)
        if (profile.compactLayout) {
            fitted = compactTextLayout(fitted, allowDoubleHeight = profile.allowDoubleHeight)
        }
        if (isCompact58) fitted = collapseCompact58Separators(fitted)
        fitted = applyCharsetPolicy(fitted, profile.charsetPolicy)

        val normalized = fitted.replace(SIMULATED_CUT_MARKER, "")
        val charset = runCatching { Charset.forName(charsetName) }.getOrElse { Charsets.ISO_8859_1 }
        val body = normalized.toByteArray(charset)
        val clampedFeedLines = profile.feedLines.coerceIn(1, 6)
        val feedBytes = "\n".repeat(clampedFeedLines).toByteArray(Charsets.US_ASCII)
        val cutBytes = if (profile.supportsCut) PARTIAL_CUT else ByteArray(0)

        return INITIALIZE + PORTUGUESE_CODE_PAGE + body + feedBytes + cutBytes
    }

    fun buildKapbomSelfTestPayload(
        restaurantName: String = "JE LANCHES",
        printerName: String = "Kapbom KA-1445",
        printerAddress: String = "00:00:00:00:00:00",
    ): ByteArray {
        val sampleText = buildString {
            appendLine("================================")
            appendLine("          $restaurantName          ")
            appendLine("      TESTE REAL KOMA 58MM      ")
            appendLine("================================")
            appendLine("IMPRESSORA: $printerName")
            appendLine("BLUETOOTH: $printerAddress")
            appendLine("PAPEL: 58mm (32 colunas)")
            appendLine("--------------------------------")
            appendLine("1x X-Burguer              R$12,00")
            appendLine("  + Bacon                 R$ 2,00")
            appendLine("1x Suco de Acerola 300ml  R$ 5,00")
            appendLine("--------------------------------")
            appendLine("TOTAL DO PEDIDO           R$19,00")
            appendLine("MODALIDADE: RETIRADA NA LOJA")
            appendLine("PAGAMENTO: PIX / DINHEIRO")
            appendLine("================================")
            appendLine("       DOCUMENTO NAO FISCAL     ")
            append("[CUT]")
        }
        return buildEscPosPayload(
            payloadText = sampleText,
            profile = PrinterPaperProfile.KAPBOM_KA1445_58MM,
        )
    }
}
