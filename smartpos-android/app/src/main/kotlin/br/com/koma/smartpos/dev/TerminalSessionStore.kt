package br.com.koma.smartpos.dev

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal data class SavedOperatorSession(
    val operator: Operator,
    val role: String,
    val restaurant: Restaurant,
    val username: String,
    val token: String,
    val savedAtMs: Long,
    val expiresAtMs: Long,
) {
    fun hasActiveToken(nowMs: Long = System.currentTimeMillis()): Boolean =
        token.isNotBlank() && expiresAtMs > nowMs
}

internal data class TerminalState(
    val terminalId: String,
    val boundRestaurant: Restaurant?,
    val activeOperatorId: String?,
    val operators: List<SavedOperatorSession>,
) {
    val activeOperator: SavedOperatorSession?
        get() = operators.firstOrNull { it.operator.id == activeOperatorId }

}

internal interface TerminalKeyCipher {
    fun encrypt(aad: ByteArray, plain: ByteArray): ByteArray
    fun decrypt(aad: ByteArray, cipherText: ByteArray): ByteArray
}

internal class AndroidKeyStoreCipher(
    private val alias: String = "koma.smartpos.session.v1",
) : TerminalKeyCipher {
    override fun encrypt(aad: ByteArray, plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key(create = true))
        cipher.updateAAD(aad)
        check(cipher.iv.size == IV_SIZE)
        return cipher.iv + cipher.doFinal(plain)
    }

    override fun decrypt(aad: ByteArray, cipherText: ByteArray): ByteArray {
        require(cipherText.size > IV_SIZE)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        val iv = cipherText.copyOfRange(0, IV_SIZE)
        cipher.init(Cipher.DECRYPT_MODE, key(create = false), GCMParameterSpec(128, iv))
        cipher.updateAAD(aad)
        return cipher.doFinal(cipherText, IV_SIZE, cipherText.size - IV_SIZE)
    }

    private fun key(create: Boolean): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        check(create) { "Terminal session encryption key unavailable" }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(
                    alias,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
            generateKey()
        }
    }

    private companion object {
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_SIZE = 12
    }
}

internal class TerminalSessionStore(
    private val directory: File,
    private val cipher: TerminalKeyCipher = AndroidKeyStoreCipher(),
    private val nowProvider: () -> Long = System::currentTimeMillis,
) {
    fun load(scope: String): TerminalState {
        val target = file(scope)
        val payload = try {
            readFile(target)
        } catch (_: FileNotFoundException) {
            return initial(scope)
        } catch (_: Exception) {
            return initial(scope)
        }
        if (payload == null) return initial(scope)
        return runCatching {
            val plain = cipher.decrypt(scope.toByteArray(Charsets.UTF_8), payload)
                .toString(Charsets.UTF_8)
            decodeState(plain)
        }.getOrElse {
            initial(scope)
        }
    }

    fun ensureTerminalId(scope: String): String = load(scope).terminalId

    fun saveLogin(
        scope: String,
        session: Session,
        username: String,
        token: String,
        ttlMs: Long = DEFAULT_TOKEN_TTL_MS,
    ): TerminalState {
        val now = nowProvider()
        val current = load(scope)
        val restaurant = session.restaurant
        val sameRestaurant = current.boundRestaurant == null || current.boundRestaurant.id == restaurant.id
        require(sameRestaurant) { "O terminal pertence a outro restaurante. Novo vínculo autorizado necessário." }
        require(ttlMs > 0) { "Prazo de sessão inválido." }
        val normalizedToken = token.trim()
        val jwtExpiry = jwtExpiryMillis(normalizedToken)
        require(jwtExpiry > now) { "Sessão expirada. Entre novamente." }
        val previous = current.operators.firstOrNull {
            it.operator.id == session.operator.id && it.token == normalizedToken
        }
        val deadline = minOf(jwtExpiry, Math.addExact(now, ttlMs), previous?.expiresAtMs ?: Long.MAX_VALUE)
        require(deadline > now) { "Sessão expirada. Entre novamente." }
        val baseOperators = current.operators
        val entry = SavedOperatorSession(
            operator = session.operator,
            role = session.role,
            restaurant = restaurant,
            username = username.trim(),
            token = normalizedToken,
            savedAtMs = previous?.savedAtMs ?: now,
            expiresAtMs = deadline,
        )
        val updated = baseOperators.filterNot { it.operator.id == entry.operator.id } + entry
        val next = TerminalState(
            terminalId = current.terminalId,
            boundRestaurant = restaurant,
            activeOperatorId = entry.operator.id,
            operators = updated.sortedBy { it.operator.name.lowercase() },
        )
        persist(scope, next)
        return next
    }

    fun switchOperator(scope: String, operatorId: String): TerminalState {
        val current = load(scope)
        require(current.operators.any { it.operator.id == operatorId && it.hasActiveToken(nowProvider()) }) {
            "Operador sem sessão válida. Entre novamente."
        }
        val next = current.copy(activeOperatorId = operatorId)
        persist(scope, next)
        return next
    }

    fun invalidateOperatorToken(scope: String, operatorId: String): TerminalState {
        val current = load(scope)
        val nextOperators = current.operators.map { entry ->
            if (entry.operator.id == operatorId) entry.copy(token = "", expiresAtMs = 0L)
            else entry
        }
        val next = current.copy(
            activeOperatorId = if (current.activeOperatorId == operatorId) null else current.activeOperatorId,
            operators = nextOperators,
        )
        persist(scope, next)
        return next
    }

    fun removeOperator(scope: String, operatorId: String): TerminalState {
        val current = load(scope)
        val nextOperators = current.operators.filterNot { it.operator.id == operatorId }
        val nextActive = if (current.activeOperatorId == operatorId) {
            null
        } else {
            current.activeOperatorId
        }
        val next = current.copy(
            activeOperatorId = nextActive,
            operators = nextOperators,
        )
        persist(scope, next)
        return next
    }

    fun unbindTerminal(scope: String): TerminalState {
        val current = load(scope)
        val next = TerminalState(
            terminalId = current.terminalId,
            boundRestaurant = null,
            activeOperatorId = null,
            operators = emptyList(),
        )
        persist(scope, next)
        return next
    }

    private fun initial(scope: String): TerminalState {
        val state = TerminalState(
            terminalId = "POS-${UUID.randomUUID().toString().replace("-", "").take(12).uppercase()}",
            boundRestaurant = null,
            activeOperatorId = null,
            operators = emptyList(),
        )
        runCatching { persist(scope, state) }
        return state
    }

    private fun persist(scope: String, state: TerminalState) {
        directory.mkdirs()
        val target = file(scope)
        val plain = encodeState(state).toByteArray(Charsets.UTF_8)
        val encrypted = cipher.encrypt(scope.toByteArray(Charsets.UTF_8), plain)
        writeFile(target, encrypted)
    }

    private fun encodeState(state: TerminalState): String {
        val obj = JSONObject()
            .put("terminalId", state.terminalId)
            .put("activeOperatorId", state.activeOperatorId ?: JSONObject.NULL)
        state.boundRestaurant?.let { rest ->
            obj.put(
                "boundRestaurant",
                JSONObject().put("id", rest.id).put("name", rest.name),
            )
        }
        val arr = JSONArray()
        state.operators.forEach { op ->
            arr.put(
                JSONObject()
                    .put("operatorId", op.operator.id)
                    .put("operatorName", op.operator.name)
                    .put("role", op.role)
                    .put("restaurantId", op.restaurant.id)
                    .put("restaurantName", op.restaurant.name)
                    .put("username", op.username)
                    .put("token", op.token)
                    .put("savedAtMs", op.savedAtMs)
                    .put("expiresAtMs", op.expiresAtMs),
            )
        }
        obj.put("operators", arr)
        return obj.toString()
    }

    private fun decodeState(raw: String): TerminalState {
        val obj = JSONObject(raw)
        val terminalId = obj.optString("terminalId").ifBlank {
            "POS-${UUID.randomUUID().toString().replace("-", "").take(12).uppercase()}"
        }
        val restObj = obj.optJSONObject("boundRestaurant")
        val boundRestaurant = if (restObj != null && restObj.optInt("id") > 0) {
            Restaurant(restObj.getInt("id"), restObj.optString("name"))
        } else {
            null
        }
        val activeOperatorId = if (obj.isNull("activeOperatorId")) null
        else obj.optString("activeOperatorId").ifBlank { null }
        val arr = obj.optJSONArray("operators") ?: JSONArray()
        val operators = List(arr.length()) { index ->
            val item = arr.getJSONObject(index)
            SavedOperatorSession(
                operator = Operator(item.getString("operatorId"), item.getString("operatorName")),
                role = item.optString("role").ifBlank { "garcom" },
                restaurant = Restaurant(item.getInt("restaurantId"), item.optString("restaurantName")),
                username = item.optString("username"),
                token = item.optString("token"),
                savedAtMs = item.optLong("savedAtMs"),
                expiresAtMs = item.optLong("expiresAtMs"),
            )
        }
        val validated = operators.filter { it.restaurant.id == boundRestaurant?.id }.map { op ->
            val expiry = runCatching { jwtExpiryMillis(op.token) }.getOrDefault(0L)
            op.copy(expiresAtMs = minOf(op.expiresAtMs, expiry))
        }
        return TerminalState(terminalId, boundRestaurant, activeOperatorId, validated)
    }

    private fun jwtExpiryMillis(token: String): Long = try {
        val parts = token.split('.')
        require(parts.size == 3 && parts.all { it.isNotBlank() })
        val encoded = parts[1]
        val padded = encoded + "=".repeat((4 - encoded.length % 4) % 4)
        val payload = kotlin.io.encoding.Base64.UrlSafe.decode(padded).toString(Charsets.UTF_8)
        val expiry = JSONObject(payload).get("exp")
        require(expiry is Number && expiry !is Double && expiry !is Float)
        Math.multiplyExact(expiry.toLong(), 1000L)
    } catch (exc: Exception) {
        throw IllegalArgumentException("Token sem expiração válida. Entre novamente.", exc)
    }

    private fun file(scope: String): File {
        val hash = MessageDigest.getInstance("SHA-256").digest(scope.toByteArray(Charsets.UTF_8))
        val identifier = hash.joinToString("") { "%02x".format(it) }
        return File(directory, "terminal-session-v1-$identifier")
    }

    private fun readFile(target: File): ByteArray? {
        if (!target.exists()) return null
        return runCatching {
            AtomicFile(target).readFully()
        }.getOrElse {
            target.readBytes()
        }
    }

    private fun writeFile(target: File, payload: ByteArray) {
        val atomicSuccess = runCatching {
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
        if (!atomicSuccess) {
            val tmp = File(target.parentFile, "${target.name}.tmp")
            tmp.writeBytes(payload)
            if (!tmp.renameTo(target)) {
                target.writeBytes(payload)
                tmp.delete()
            }
        }
    }

    companion object {
        const val DEFAULT_TOKEN_TTL_MS = 30L * 24L * 60L * 60L * 1000L
    }
}
