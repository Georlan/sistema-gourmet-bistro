package br.com.koma.print.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import br.com.koma.print.core.AgentRevokedException
import br.com.koma.print.core.AndroidPrintWorker
import br.com.koma.print.core.FilePrintJournal
import br.com.koma.print.core.JdkPrintAgentHttpTransport
import br.com.koma.print.core.KomaPrintAgentClient
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.min

/**
 * Serviço em primeiro plano (`ForegroundService`) para manter a impressão Bluetooth SPP
 * ativa com a tela bloqueada em Android 8.0+ (API 26+).
 *
 * - Usa `PARTIAL_WAKE_LOCK` com timeout estrito durante o ciclo de polling/envio RFCOMM
 *   para evitar suspensão da CPU no meio de um cupom 58 mm.
 * - Respeita a regra de frugalidade do KÔMA: heartbeat espaçado a cada 30s e backoff
 *   econômico quando não há pedidos na fila.
 */
class KomaPrintForegroundService : Service() {
    private val running = AtomicBoolean(false)
    @Volatile
    private var workerThread: Thread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action.orEmpty()
        val store = AgentPreferencesStore(this)
        if (action == ACTION_STOP) {
            store.setAutoStartEnabled(false)
            store.updateLastStatus("Serviço de impressão automática pausado pelo operador.")
            stopForegroundLoop()
            stopSelf()
            return START_NOT_STICKY
        }

        store.setAutoStartEnabled(true)
        promoteToForeground("KÔMA Print 58mm ativo (tela bloqueada liberada)")
        startForegroundLoopIfNeeded()
        return START_STICKY
    }

    override fun onDestroy() {
        stopForegroundLoop()
        super.onDestroy()
    }

    private fun startForegroundLoopIfNeeded() {
        if (!running.compareAndSet(false, true)) return

        val thread = Thread(
            {
                runAgentLoop()
            },
            "koma-print-android-worker",
        )
        thread.isDaemon = true
        workerThread = thread
        thread.start()
    }

    private fun stopForegroundLoop() {
        running.set(false)
        workerThread?.interrupt()
        workerThread = null
    }

    private fun runAgentLoop() {
        val store = AgentPreferencesStore(this)
        val journalPath = filesDir.toPath().resolve("koma_print_journal.properties")
        val journal = FilePrintJournal(storageFile = journalPath)
        val btAdapter = AndroidBluetoothSppAdapter(this)

        var lastHeartbeatEpochMs = 0L
        var consecutiveErrors = 0

        while (running.get() && !Thread.currentThread().isInterrupted) {
            val cfg = store.load()
            if (!cfg.isConfigured) {
                updateStatusAndNotification(
                    store,
                    "Aguardando login/vinculação do agente KÔMA no aplicativo.",
                )
                sleepQuietly(5_000L)
                continue
            }

            val now = System.currentTimeMillis()
            val shouldSendHeartbeat = (now - lastHeartbeatEpochMs) >= HEARTBEAT_INTERVAL_MS

            var sleepNextMs = IDLE_POLL_INTERVAL_MS
            withCycleWakeLock {
                try {
                    val transport = JdkPrintAgentHttpTransport(baseUrl = cfg.backendUrl)
                    val apiClient = KomaPrintAgentClient(
                        transport = transport,
                        agentTokenProvider = { cfg.agentToken },
                    )
                    val worker = AndroidPrintWorker(
                        apiClient = apiClient,
                        bluetoothTransport = btAdapter,
                        journal = journal,
                        restaurantDisplayName = cfg.restaurantName,
                    )

                    val outcome = worker.runCycle(
                        preferredPrinterAddress = cfg.preferredPrinterAddress,
                        batchLimit = 5,
                        includeHeartbeat = shouldSendHeartbeat,
                    )
                    if (shouldSendHeartbeat) {
                        lastHeartbeatEpochMs = System.currentTimeMillis()
                    }
                    consecutiveErrors = 0

                    val statusText = when {
                        !outcome.printerDispatchable ->
                            "Aguardando impressora Bluetooth 58mm (${cfg.preferredPrinterName.ifBlank { "Kapbom KA-1445" }})"
                        outcome.failedJobId != null ->
                            "Reconectando Bluetooth: ${outcome.failureReason ?: "falha temporária"}"
                        outcome.printedAndSentCount > 0 ->
                            "Impresso(s) ${outcome.printedAndSentCount} pedido(s) na ${cfg.preferredPrinterName}"
                        else ->
                            "Pronto (${cfg.preferredPrinterName}) • monitorando fila KÔMA"
                    }
                    updateStatusAndNotification(store, statusText)

                    sleepNextMs = when {
                        outcome.failedJobId != null -> ERROR_BASE_BACKOFF_MS
                        outcome.claimedCount >= 5 -> FAST_BATCH_FOLLOWUP_MS
                        else -> IDLE_POLL_INTERVAL_MS
                    }
                } catch (revoked: AgentRevokedException) {
                    updateStatusAndNotification(
                        store,
                        "Token do agente revogado ou inválido. Refaça a vinculação no app.",
                    )
                    sleepNextMs = 15_000L
                } catch (err: Throwable) {
                    consecutiveErrors = (consecutiveErrors + 1).coerceAtMost(5)
                    val backoff = min(ERROR_BASE_BACKOFF_MS * (1L shl (consecutiveErrors - 1)), MAX_BACKOFF_MS)
                    updateStatusAndNotification(
                        store,
                        "Sem conexão com servidor KÔMA (tentando novamente em ${backoff / 1000}s).",
                    )
                    sleepNextMs = backoff
                }
            }

            sleepQuietly(sleepNextMs)
        }
    }

    private inline fun withCycleWakeLock(block: () -> Unit) {
        val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
        val wakeLock = pm?.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "koma:print_dispatch_wakelock",
        )?.apply {
            setReferenceCounted(false)
            runCatching { acquire(45_000L) }
        }
        try {
            block()
        } finally {
            runCatching {
                if (wakeLock?.isHeld == true) {
                    wakeLock.release()
                }
            }
        }
    }

    private fun sleepQuietly(ms: Long) {
        try {
            Thread.sleep(ms.coerceAtLeast(250L))
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
    }

    private fun updateStatusAndNotification(store: AgentPreferencesStore, status: String) {
        store.updateLastStatus(status)
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        runCatching {
            nm.notify(NOTIFICATION_ID, buildForegroundNotification(status))
        }
    }

    private fun promoteToForeground(statusText: String) {
        val notification = buildForegroundNotification(statusText)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE or
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildForegroundNotification(contentText: String): Notification {
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val pendingIntent = PendingIntent.getActivity(this, 0, openIntent, pendingFlags)

        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("KÔMA Print 58mm • Automático")
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    private fun ensureNotificationChannel() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "KÔMA Print Automático (Bluetooth 58mm)",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Mantém a impressora térmica Bluetooth 58mm conectada com o celular bloqueado."
            setShowBadge(false)
        }
        nm.createNotificationChannel(channel)
    }

    companion object {
        const val ACTION_START = "br.com.koma.print.app.action.START"
        const val ACTION_STOP = "br.com.koma.print.app.action.STOP"
        private const val CHANNEL_ID = "koma_print_foreground_channel"
        private const val NOTIFICATION_ID = 5801

        private const val HEARTBEAT_INTERVAL_MS = 30_000L
        private const val IDLE_POLL_INTERVAL_MS = 4_000L
        private const val FAST_BATCH_FOLLOWUP_MS = 800L
        private const val ERROR_BASE_BACKOFF_MS = 4_000L
        private const val MAX_BACKOFF_MS = 20_000L

        fun startService(context: Context) {
            val intent = Intent(context, KomaPrintForegroundService::class.java).apply {
                action = ACTION_START
            }
            context.startForegroundService(intent)
        }

        fun stopService(context: Context) {
            val intent = Intent(context, KomaPrintForegroundService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }
}
