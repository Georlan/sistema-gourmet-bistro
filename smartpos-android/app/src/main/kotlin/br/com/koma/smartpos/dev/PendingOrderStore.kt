package br.com.koma.smartpos.dev

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.io.FileNotFoundException
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class PendingOrderStore(private val directory: File) {
    fun read(scope: String): PendingOrder? {
        val target = file(scope)
        val payload = try {
            target.readFully()
        } catch (failure: FileNotFoundException) {
            if (target.baseFile.exists()) throw failure
            return null
        }
        require(payload.size > IV_SIZE)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        val iv = payload.copyOfRange(0, IV_SIZE)
        cipher.init(Cipher.DECRYPT_MODE, key(create = false), GCMParameterSpec(128, iv))
        cipher.updateAAD(scope.toByteArray())
        return PendingOrder.decode(cipher.doFinal(payload, IV_SIZE, payload.size - IV_SIZE).toString(Charsets.UTF_8))
    }

    fun write(scope: String, order: PendingOrder?) {
        val target = file(scope)
        if (order == null) {
            target.delete()
            check(!target.baseFile.exists())
            return
        }

        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key(create = true))
        cipher.updateAAD(scope.toByteArray())
        check(cipher.iv.size == IV_SIZE)
        val payload = cipher.iv + cipher.doFinal(order.encode().toByteArray())
        val stream = target.startWrite()
        try {
            stream.write(payload)
            target.finishWrite(stream)
        } catch (failure: Exception) {
            target.failWrite(stream)
            throw failure
        }
        check(target.readFully().contentEquals(payload))
    }

    private fun file(scope: String): AtomicFile {
        val hash = MessageDigest.getInstance("SHA-256").digest(scope.toByteArray())
        val identifier = hash.joinToString("") { "%02x".format(it) }
        return AtomicFile(File(directory, "waiter-v1-$identifier"))
    }

    private fun key(create: Boolean): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        check(create) { "Pending order encryption key unavailable" }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build())
            generateKey()
        }
    }

    private companion object {
        const val ALIAS = "koma.waiter.pending.v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_SIZE = 12
    }
}
