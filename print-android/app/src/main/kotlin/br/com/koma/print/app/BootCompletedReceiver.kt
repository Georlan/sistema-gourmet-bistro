package br.com.koma.print.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Reinicia automaticamente o `KomaPrintForegroundService` quando o celular Android
 * é reiniciado ou quando o APK é atualizado, desde que o agente esteja configurado.
 */
class BootCompletedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action.orEmpty()
        if (
            action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            return
        }
        val config = AgentPreferencesStore(context).load()
        if (config.isConfigured && config.autoStartEnabled) {
            runCatching {
                KomaPrintForegroundService.startService(context)
            }
        }
    }
}
