package br.com.koma.print.app

import android.content.Context

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
) {
    val isConfigured: Boolean
        get() = backendUrl.isNotBlank() && agentId.isNotBlank() && agentToken.isNotBlank()
}

class AgentPreferencesStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun load(): AgentLocalConfig = AgentLocalConfig(
        backendUrl = prefs.getString(KEY_BACKEND_URL, DEFAULT_BACKEND_URL).orEmpty().ifBlank { DEFAULT_BACKEND_URL },
        agentId = prefs.getString(KEY_AGENT_ID, "android-je-lanches-01").orEmpty(),
        agentToken = prefs.getString(KEY_AGENT_TOKEN, "").orEmpty(),
        restauranteId = prefs.getInt(KEY_RESTAURANTE_ID, 1),
        restaurantName = prefs.getString(KEY_RESTAURANT_NAME, "JE LANCHES").orEmpty(),
        preferredPrinterAddress = prefs.getString(KEY_PRINTER_ADDRESS, "").orEmpty(),
        preferredPrinterName = prefs.getString(KEY_PRINTER_NAME, "Kapbom KA-1445").orEmpty(),
        autoStartEnabled = prefs.getBoolean(KEY_AUTO_START, true),
        lastStatusSummary = prefs.getString(KEY_LAST_STATUS, "Aguardando vinculação com o KÔMA.").orEmpty(),
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
            .putString(KEY_RESTAURANT_NAME, restaurantName.trim().ifBlank { "JE LANCHES" })
            .putBoolean(KEY_AUTO_START, true)
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

    companion object {
        private const val PREFS_NAME = "koma_print_android_prefs"
        private const val DEFAULT_BACKEND_URL = "https://api.komagourmet.com.br"
        private const val KEY_BACKEND_URL = "backend_url"
        private const val KEY_AGENT_ID = "agent_id"
        private const val KEY_AGENT_TOKEN = "agent_token"
        private const val KEY_RESTAURANTE_ID = "restaurante_id"
        private const val KEY_RESTAURANT_NAME = "restaurant_name"
        private const val KEY_PRINTER_ADDRESS = "printer_address"
        private const val KEY_PRINTER_NAME = "printer_name"
        private const val KEY_AUTO_START = "auto_start_enabled"
        private const val KEY_LAST_STATUS = "last_status_summary"
    }
}
