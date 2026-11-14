package br.com.koma.print.app

import android.content.Context
import java.util.UUID

data class AgentLocalConfig(
    val backendUrl: String,
    val agentId: String,
    val agentToken: String,
    val restauranteId: Int,
    val restaurantName: String,
    val preferredPrinterAddress: String,
    val preferredPrinterName: String,
    val autoStartEnabled: Boolean,
    val lastStatusSummary: String,
    val lastBackendContactEpochMs: Long,
) {
    val isConfigured: Boolean
        get() = backendUrl.isNotBlank() && agentId.isNotBlank() && agentToken.isNotBlank() &&
            restauranteId > 0
}

class AgentPreferencesStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun load(): AgentLocalConfig = AgentLocalConfig(
        backendUrl = prefs.getString(KEY_BACKEND_URL, DEFAULT_BACKEND_URL).orEmpty().ifBlank { DEFAULT_BACKEND_URL },
        agentId = prefs.getString(KEY_AGENT_ID, "").orEmpty(),
        agentToken = prefs.getString(KEY_AGENT_TOKEN, "").orEmpty(),
        restauranteId = prefs.getInt(KEY_RESTAURANTE_ID, 0),
        restaurantName = prefs.getString(KEY_RESTAURANT_NAME, "Restaurante KÔMA").orEmpty(),
        preferredPrinterAddress = prefs.getString(KEY_PRINTER_ADDRESS, "").orEmpty(),
        preferredPrinterName = prefs.getString(KEY_PRINTER_NAME, "").orEmpty(),
        autoStartEnabled = prefs.getBoolean(KEY_AUTO_START, false),
        lastStatusSummary = prefs.getString(KEY_LAST_STATUS, "Aguardando vinculação com o KÔMA.").orEmpty(),
        lastBackendContactEpochMs = prefs.getLong(KEY_LAST_CONTACT, 0L),
    )

    fun saveCredentials(
        backendUrl: String,
        agentId: String,
        agentToken: String,
        restauranteId: Int,
        restaurantName: String,
    ) {
        prefs.edit()
            .putString(KEY_BACKEND_URL, backendUrl.trim().trimEnd('/'))
            .putString(KEY_AGENT_ID, agentId.trim())
            .putString(KEY_AGENT_TOKEN, agentToken.trim())
            .putInt(KEY_RESTAURANTE_ID, restauranteId)
            .putString(KEY_RESTAURANT_NAME, restaurantName.trim().ifBlank { "Restaurante KÔMA" })
            .putBoolean(KEY_AUTO_START, false)
            .putLong(KEY_LAST_CONTACT, 0L)
            .apply()
    }

    fun clearCredentials() {
        prefs.edit()
            .remove(KEY_AGENT_TOKEN)
            .putString(KEY_LAST_STATUS, "Desconectado pelo operador.")
            .apply()
    }

    fun savePreferredPrinter(name: String, address: String) {
        prefs.edit()
            .putString(KEY_PRINTER_NAME, name.trim())
            .putString(KEY_PRINTER_ADDRESS, address.trim())
            .apply()
    }

    fun setAutoStartEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_AUTO_START, enabled).apply()
    }

    fun updateLastStatus(summary: String) {
        prefs.edit().putString(KEY_LAST_STATUS, summary.take(300)).apply()
    }

    fun recordBackendContact() {
        prefs.edit().putLong(KEY_LAST_CONTACT, System.currentTimeMillis()).apply()
    }

    fun stableDeviceId(): String {
        val cached = prefs.getString(KEY_DEVICE_ID, null)
        if (!cached.isNullOrBlank()) return cached
        val created = "android-" + UUID.randomUUID().toString().take(8)
        prefs.edit().putString(KEY_DEVICE_ID, created).commit()
        return created
    }

    companion object {
        private const val PREFS_NAME = "koma_print_android_prefs"
        private const val DEFAULT_BACKEND_URL = "https://sistema-gourmet-bistro-production.up.railway.app"
        private const val KEY_BACKEND_URL = "backend_url"
        private const val KEY_AGENT_ID = "agent_id"
        private const val KEY_AGENT_TOKEN = "agent_token"
        private const val KEY_RESTAURANTE_ID = "restaurante_id"
        private const val KEY_RESTAURANT_NAME = "restaurant_name"
        private const val KEY_PRINTER_ADDRESS = "printer_address"
        private const val KEY_PRINTER_NAME = "printer_name"
        private const val KEY_AUTO_START = "auto_start_enabled"
        private const val KEY_LAST_STATUS = "last_status_summary"
        private const val KEY_LAST_CONTACT = "last_backend_contact_epoch_ms"
        private const val KEY_DEVICE_ID = "device_stable_id"
    }
}
