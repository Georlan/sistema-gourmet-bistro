import React, { useState, useEffect } from "react";
import { 
  Send, 
  Bot, 
  ShieldAlert, 
  RefreshCw,
  BellRing,
  Settings,
  History,
  Power,
  PowerOff,
  Save,
  Trash2,
  AlertTriangle,
  Smartphone,
  CheckCircle2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export interface TelegramAlert {
  id: string;
  sender: "bot" | "user";
  text: string;
  timestamp: string;
}

interface AlertRule {
  id: string;
  type: "webhook_failure" | "printer_offline" | "sentry_critical";
  name: string;
  enabled: boolean;
  thresholdCount: number;
  thresholdMinutes: number;
}

interface FiredAlert {
  id: string;
  timestamp: string;
  type: "webhook_failure" | "printer_offline" | "sentry_critical";
  message: string;
}

interface SuperAdminTelegramProps {
  telegramMessages: TelegramAlert[];
  onTriggerTelegramAlert: (text: string) => void;
  onClearMessages: () => void;
  alertRules: AlertRule[];
  firedAlertsHistory: FiredAlert[];
  onUpdateAlertRules: (newRules: AlertRule[]) => void;
  onClearFiredAlertsHistory: () => void;
}

export default function SuperAdminTelegram({
  telegramMessages,
  onTriggerTelegramAlert,
  onClearMessages,
  alertRules = [],
  firedAlertsHistory = [],
  onUpdateAlertRules,
  onClearFiredAlertsHistory
}: SuperAdminTelegramProps) {
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [customText, setCustomText] = useState("");
  const [isSending, setIsSending] = useState(false);
  
  // Local state for rules editing
  const [localRules, setLocalRules] = useState<AlertRule[]>([]);
  const [hasUnsavedRules, setHasUnsavedRules] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);

  // Sync props to local rules state
  useEffect(() => {
    if (alertRules && alertRules.length > 0) {
      setLocalRules(JSON.parse(JSON.stringify(alertRules)));
      setHasUnsavedRules(false);
    }
  }, [alertRules]);

  const handleRuleToggle = (ruleId: string) => {
    setLocalRules(prev => 
      prev.map(r => r.id === ruleId ? { ...r, enabled: !r.enabled } : r)
    );
    setHasUnsavedRules(true);
  };

  const handleRuleNumberChange = (ruleId: string, field: "thresholdCount" | "thresholdMinutes", val: number) => {
    setLocalRules(prev => 
      prev.map(r => r.id === ruleId ? { ...r, [field]: Math.max(0, val) } : r)
    );
    setHasUnsavedRules(true);
  };

  const handleSaveRules = () => {
    onUpdateAlertRules(localRules);
    setHasUnsavedRules(false);
    setShowSaveSuccess(true);
    setTimeout(() => setShowSaveSuccess(false), 3000);
  };

  const demoAlerts = [
    {
      label: "🎉 Novo Restaurante",
      text: "🎉 Novo cliente! Pizzaria Sol se cadastrou no plano Delivery"
    },
    {
      label: "🚨 Erro Crítico Sentry",
      text: "🚨 Alerta Sentry: Exceção no servidor da Pizzaria Sol! Exception: SupabasePoolExhausted - Connections reached 100 max."
    },
    {
      label: "⚠️ Impressora Offline",
      text: "⚠️ Alerta: Servidor de impressão da Hamburgueria Silva está offline há mais de 15 minutos! Gateway IP: 189.12.3.44"
    },
    {
      label: "❌ Falha Webhook Asaas",
      text: "❌ Webhook Asaas falhou para o Pedido PED-7969. Error: Timeout connecting to schema_pizzaria-sol."
    }
  ];

  const handleSendCustomAlert = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customText.trim()) return;

    setIsSending(true);
    setTimeout(() => {
      onTriggerTelegramAlert(customText);
      setCustomText("");
      setIsSending(false);
    }, 400);
  };

  return (
    <div className="space-y-6" id="superadmin-telegram-control">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Left Column: Settings and Rules */}
        <div className="space-y-6">
          
          {/* BOT Configuration */}
          <div className="bg-[#121420] border border-[#1e293b]/40 p-5 rounded" id="telegram-config-panel">
            <div className="border-b border-[#1e293b]/40 pb-3 flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-mono text-white font-bold flex items-center gap-2">
                  <Bot className="w-4 h-4 text-[#00b894]" />
                  [01] CREDENCIAIS DO BOT DO TELEGRAM
                </h3>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5">NOTIFICAÇÕES REAL-TIME NO CELULAR DO DEVELOPER</p>
              </div>
              <span className="text-[9px] text-[#00b894] bg-[#121420] border border-[#00b894]/20 px-2 py-0.5 rounded font-mono font-bold">
                TELEGRAM_BOT_API
              </span>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1">TELEGRAM_BOT_TOKEN</label>
                <div className="relative">
                  <input
                    type="password"
                    className="w-full bg-black border border-[#1e293b]/40 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#00b894]"
                    value={botToken}
                    onChange={e => setBotToken(e.target.value)}
                  />
                  <span className="absolute right-3 top-2 text-[10px] font-mono text-slate-600">SECURE</span>
                </div>
                <p className="text-[9px] text-slate-500 font-mono mt-1">Token secreto gerado através do @BotFather</p>
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1">TELEGRAM_CHAT_ID</label>
                <input
                  type="text"
                  className="w-full bg-black border border-[#1e293b]/40 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#00b894]"
                  value={chatId}
                  onChange={e => setChatId(e.target.value)}
                />
                <p className="text-[9px] text-slate-500 font-mono mt-1">ID numérico do chat privado ou grupo para entrega push</p>
              </div>
            </div>
          </div>

          {/* Active Rules Setup */}
          <div className="bg-[#121420] border border-[#1e293b]/40 p-5 rounded" id="telegram-rules-panel">
            <div className="border-b border-[#1e293b]/40 pb-3 flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-mono text-white font-bold flex items-center gap-2">
                  <Settings className="w-4 h-4 text-[#00b894]" />
                  [02] REGRAS DE ALERTA AUTOMÁTICO
                </h3>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5">THRESHOLDS DE DISPARO PROATIVO DO SERVIDOR (BACKGROUND)</p>
              </div>
              <span className="text-[9px] text-slate-400 bg-black/50 border border-[#1e293b]/40 px-2 py-0.5 rounded font-mono">
                MONITOR_DAEMON
              </span>
            </div>

            <div className="space-y-4">
              {localRules.map((rule) => {
                const isWebhook = rule.type === "webhook_failure";
                const isPrinter = rule.type === "printer_offline";
                const isSentry = rule.type === "sentry_critical";

                return (
                  <div 
                    key={rule.id} 
                    className={`p-3 rounded border transition-all ${
                      rule.enabled 
                        ? "bg-black/40 border-[#00b894]/20" 
                        : "bg-zinc-950/20 border-zinc-900/60 opacity-60"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {isWebhook && <AlertTriangle className="w-4 h-4 text-amber-500" />}
                        {isPrinter && <Smartphone className="w-4 h-4 text-[#00b894]" />}
                        {isSentry && <ShieldAlert className="w-4 h-4 text-red-500" />}
                        <span className="text-xs font-mono font-bold text-slate-200">{rule.name}</span>
                      </div>

                      <button
                        onClick={() => handleRuleToggle(rule.id)}
                        className={`px-2 py-1 rounded text-[10px] font-mono font-bold flex items-center gap-1 cursor-pointer transition-colors ${
                          rule.enabled 
                            ? "bg-[#00b894]/10 text-[#00b894] hover:bg-[#00b894]/20" 
                            : "bg-zinc-800 text-slate-500 hover:bg-zinc-700"
                        }`}
                      >
                        {rule.enabled ? (
                          <>
                            <Power className="w-3 h-3" /> ATIVA
                          </>
                        ) : (
                          <>
                            <PowerOff className="w-3 h-3" /> INATIVA
                          </>
                        )}
                      </button>
                    </div>

                    {/* Threshold customization */}
                    {rule.enabled && (
                      <div className="mt-3 pt-2 border-t border-[#1e293b]/20 flex flex-wrap gap-4 items-center text-xs font-mono">
                        {isWebhook && (
                          <>
                            <div className="flex items-center gap-1.5">
                              <span className="text-slate-500">Se</span>
                              <input
                                type="number"
                                className="w-12 bg-black border border-[#1e293b]/40 rounded text-center py-0.5 text-white focus:outline-none focus:border-[#00b894]"
                                value={rule.thresholdCount}
                                onChange={e => handleRuleNumberChange(rule.id, "thresholdCount", parseInt(e.target.value) || 1)}
                              />
                              <span className="text-slate-400">ou mais falharem</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-slate-500">em</span>
                              <input
                                type="number"
                                className="w-14 bg-black border border-[#1e293b]/40 rounded text-center py-0.5 text-white focus:outline-none focus:border-[#00b894]"
                                value={rule.thresholdMinutes}
                                onChange={e => handleRuleNumberChange(rule.id, "thresholdMinutes", parseInt(e.target.value) || 1)}
                              />
                              <span className="text-slate-400">minutos</span>
                            </div>
                          </>
                        )}

                        {isPrinter && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-500">Se desconectada por mais de</span>
                            <input
                              type="number"
                              className="w-14 bg-black border border-[#1e293b]/40 rounded text-center py-0.5 text-white focus:outline-none focus:border-[#00b894]"
                              value={rule.thresholdMinutes}
                              onChange={e => handleRuleNumberChange(rule.id, "thresholdMinutes", parseInt(e.target.value) || 1)}
                            />
                            <span className="text-slate-400">minutos</span>
                          </div>
                        )}

                        {isSentry && (
                          <span className="text-[10px] text-red-400/90 font-mono bg-red-950/20 px-2 py-0.5 rounded border border-red-900/30">
                            ⚡ Dispara alerta instantâneo em qualquer log CRITICAL
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Save Buttons */}
            <div className="mt-5 pt-3 border-t border-[#1e293b]/40 flex items-center justify-between">
              <div>
                {showSaveSuccess && (
                  <div className="text-[11px] font-mono text-[#00b894] flex items-center gap-1 animate-pulse">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Configurações salvas e aplicadas!
                  </div>
                )}
              </div>
              <button
                onClick={handleSaveRules}
                disabled={!hasUnsavedRules}
                className={`px-4 py-2 rounded text-xs font-mono font-bold flex items-center gap-1.5 transition-all ${
                  hasUnsavedRules 
                    ? "bg-[#00b894] text-black hover:bg-[#059669] cursor-pointer" 
                    : "bg-zinc-850 text-zinc-600 cursor-not-allowed"
                }`}
              >
                <Save className="w-3.5 h-3.5" />
                SALVAR CONFIGURAÇÕES
              </button>
            </div>
          </div>

        </div>

        {/* Right Column: Alert History and Manual Send */}
        <div className="space-y-6">
          
          {/* Fired Alerts History Log */}
          <div className="bg-[#121420] border border-[#1e293b]/40 p-5 rounded flex flex-col h-[325px] justify-between" id="telegram-history-panel">
            <div className="space-y-4 overflow-hidden flex flex-col flex-1">
              <div className="border-b border-[#1e293b]/40 pb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-mono text-white font-bold flex items-center gap-2">
                    <History className="w-4 h-4 text-[#00b894]" />
                    [03] HISTÓRICO DE DISPAROS REALIZADOS
                  </h3>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5 font-bold">ALERTA AUTOMÁTICO DO MONITOR DE INFRAESTRUTURA</p>
                </div>
                
                {firedAlertsHistory.length > 0 && (
                  <button
                    onClick={onClearFiredAlertsHistory}
                    className="text-[10px] font-mono text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors border border-red-500/10 hover:border-red-500/20 px-2 py-0.5 rounded cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" /> Limpar
                  </button>
                )}
              </div>

              {/* Scrollable list of alerts */}
              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 font-mono text-xs">
                {firedAlertsHistory.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center py-8">
                    <p className="text-slate-600 text-[11px] font-mono uppercase">Nenhum alerta disparado automaticamente ainda.</p>
                    <p className="text-[9px] text-slate-700 font-mono mt-1">O robô em background vigia seus microsserviços continuamente.</p>
                  </div>
                ) : (
                  firedAlertsHistory.map((alert) => (
                    <div 
                      key={alert.id} 
                      className="p-2.5 rounded bg-black/60 border border-[#1e293b]/30 flex flex-col gap-1 hover:border-slate-800 transition-colors"
                    >
                      <div className="flex items-center justify-between text-[10px]">
                        <span className={`px-1.5 py-0.5 rounded font-bold uppercase ${
                          alert.type === "webhook_failure" 
                            ? "bg-amber-950/40 text-amber-500 border border-amber-900/30"
                            : alert.type === "printer_offline"
                            ? "bg-emerald-950/40 text-emerald-400 border border-emerald-900/30"
                            : "bg-red-950/40 text-red-400 border border-red-900/30"
                        }`}>
                          {alert.type.replace("_", " ")}
                        </span>
                        <span className="text-slate-500">{alert.timestamp}</span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed font-mono whitespace-pre-wrap">{alert.message}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Test Manual triggers */}
          <div className="bg-[#121420] border border-[#1e293b]/40 p-5 rounded" id="telegram-test-triggers">
            <div className="border-b border-[#1e293b]/40 pb-3 flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-mono text-white font-bold flex items-center gap-2">
                  <BellRing className="w-4 h-4 text-[#00b894]" />
                  [04] DISPARO MANUAL & TESTES RÁPIDOS
                </h3>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5 font-bold">DISPARAR EVENTOS E TESTAR COMUNICADORES</p>
              </div>
            </div>

            {/* Quick Demo Alerts Buttons */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-4">
              {demoAlerts.map((demo, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    onTriggerTelegramAlert(demo.text);
                  }}
                  className="bg-black hover:bg-zinc-900/80 border border-[#1e293b]/40 hover:border-slate-700 text-left p-2.5 rounded text-[11px] font-mono text-slate-300 hover:text-white transition-all cursor-pointer flex flex-col justify-between"
                >
                  <span className="text-[#00b894] font-bold mb-1">{demo.label}</span>
                  <span className="text-[9px] text-slate-500 line-clamp-1">{demo.text}</span>
                </button>
              ))}
            </div>

            {/* Custom Send Form */}
            <form onSubmit={handleSendCustomAlert} className="pt-3 border-t border-[#1e293b]/30">
              <p className="text-[10px] font-mono text-[#00b894] mb-1.5 uppercase font-bold">ENVIAR TEXTO PERSONALIZADO AO CHAT</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Ex: Alerta de tráfego de API elevado..."
                  className="flex-1 bg-black border border-[#1e293b]/40 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#00b894]"
                  value={customText}
                  onChange={e => setCustomText(e.target.value)}
                  disabled={isSending}
                  required
                />
                <button
                  type="submit"
                  disabled={isSending || !customText.trim()}
                  className="bg-[#00b894] hover:bg-[#059669] disabled:bg-zinc-800 border-transparent text-black px-4 py-2 rounded text-xs font-mono font-bold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  {isSending ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      <Send className="w-3 h-3 fill-black text-black" />
                      ENVIAR
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

        </div>

      </div>
    </div>
  );
}
