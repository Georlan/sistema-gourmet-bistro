from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'pattern not found in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))


# 1) Audio: one trusted user-activation attempt, no repeated resume spam.
path = 'src/components/CaixaPanel.tsx'
replace_once(
    path,
    "  const audioCtxRef = useRef<AudioContext | null>(null);\n  const audioUnlockedRef = useRef(false);\n\n  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {\n",
    "  const audioCtxRef = useRef<AudioContext | null>(null);\n  const audioUnlockedRef = useRef(false);\n\n  const primeAudioFromGesture = useCallback(async (): Promise<boolean> => {\n    try {\n      const activation = typeof navigator !== 'undefined' ? navigator.userActivation : undefined;\n      if (activation && !activation.isActive) return false;\n\n      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;\n      if (!AudioContextCtor) return false;\n      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {\n        audioCtxRef.current = new AudioContextCtor();\n      }\n      const ctx = audioCtxRef.current;\n      if (ctx.state === 'suspended') {\n        await ctx.resume();\n      }\n      const ready = ctx.state === 'running';\n      audioUnlockedRef.current = ready;\n      return ready;\n    } catch {\n      audioUnlockedRef.current = false;\n      return false;\n    }\n  }, []);\n\n  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {\n",
)
replace_once(
    path,
    "    if (next) {\n      playOrderAlert('test');\n    }\n",
    "    if (next) {\n      void primeAudioFromGesture().then(ready => {\n        if (ready) playOrderAlert('test');\n      });\n    }\n",
)
replace_once(
    path,
    "    try {\n      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {\n        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();\n      }\n      const ctx = audioCtxRef.current;\n      if (ctx.state === 'suspended') {\n        // Fora de uma interação do usuário o navegador bloqueia resume().\n        // O desbloqueio é feito pelo listener abaixo; não poluímos o console\n        // nem criamos alertas parciais enquanto o áudio ainda está suspenso.\n        if (type !== 'test') return;\n        void ctx.resume().then(() => { audioUnlockedRef.current = true; }).catch(() => undefined);\n      } else if (ctx.state === 'running') {\n        audioUnlockedRef.current = true;\n      }\n      const t = ctx.currentTime;\n",
    "    try {\n      const ctx = audioCtxRef.current;\n      if (!ctx || ctx.state !== 'running') return;\n      const t = ctx.currentTime;\n",
)
old_unlock = """  // Desbloqueia o contexto de áudio somente dentro de uma interação real.\n  useEffect(() => {\n    const unlock = () => {\n      try {\n        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {\n          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();\n        }\n        const ctx = audioCtxRef.current;\n        if (ctx.state === 'running') {\n          audioUnlockedRef.current = true;\n          return;\n        }\n        void ctx.resume()\n          .then(() => { audioUnlockedRef.current = ctx.state === 'running'; })\n          .catch(() => { audioUnlockedRef.current = false; });\n      } catch {\n        audioUnlockedRef.current = false;\n      }\n    };\n    window.addEventListener('pointerdown', unlock, { passive: true });\n    window.addEventListener('keydown', unlock, { passive: true });\n    return () => {\n      window.removeEventListener('pointerdown', unlock);\n      window.removeEventListener('keydown', unlock);\n    };\n  }, []);\n"""
new_unlock = """  // Chrome só libera WebAudio a partir de uma ativação real do usuário.\n  // Tentamos uma única vez por montagem para não gerar uma cascata de warnings\n  // quando o navegador decide manter o contexto suspenso. O toggle de som\n  // continua oferecendo uma nova tentativa explícita.\n  useEffect(() => {\n    let attempted = false;\n    const unlock = (event: Event) => {\n      if (attempted || !event.isTrusted) return;\n      const activation = typeof navigator !== 'undefined' ? navigator.userActivation : undefined;\n      if (activation && !activation.isActive) return;\n      attempted = true;\n      window.removeEventListener('click', unlock, true);\n      window.removeEventListener('keydown', unlock, true);\n      void primeAudioFromGesture();\n    };\n    window.addEventListener('click', unlock, { capture: true });\n    window.addEventListener('keydown', unlock, { capture: true });\n    return () => {\n      window.removeEventListener('click', unlock, true);\n      window.removeEventListener('keydown', unlock, true);\n    };\n  }, [primeAudioFromGesture]);\n"""
replace_once(path, old_unlock, new_unlock)

# 2) Refund service: list cache + explicit prefetch + invalidation after refund.
path = 'src/config/caixaService.ts'
replace_once(
    path,
    "const refundablePaymentCache = new Map<string, { expiresAt: number; payment: RefundablePayment }>();\n",
    "const refundablePaymentCache = new Map<string, { expiresAt: number; payment: RefundablePayment }>();\nlet refundablePaymentListCache: { expiresAt: number; limit: number; payments: RefundablePayment[] } | null = null;\n",
)
replace_once(
    path,
    "export const listarPagamentosEstornaveis = async (limite = 25): Promise<RefundablePayment[]> => {\n  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limite) || 25));\n  const res = await fetch(`${API_BASE_URL}/caixa/pagamentos/estornaveis?limite=${safeLimit}`, {\n",
    "export const listarPagamentosEstornaveis = async (limite = 25, force = false): Promise<RefundablePayment[]> => {\n  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limite) || 25));\n  const cachedList = refundablePaymentListCache;\n  if (!force && cachedList && cachedList.expiresAt > Date.now() && cachedList.limit >= safeLimit) {\n    return cachedList.payments.slice(0, safeLimit);\n  }\n  const res = await fetch(`${API_BASE_URL}/caixa/pagamentos/estornaveis?limite=${safeLimit}`, {\n",
)
replace_once(
    path,
    "  const expiresAt = Date.now() + 15_000;\n  payments.forEach(payment => refundablePaymentCache.set(payment.id, { expiresAt, payment }));\n  return payments;\n};\n\nexport const estornarPagamento = async (\n",
    "  const expiresAt = Date.now() + 15_000;\n  payments.forEach(payment => refundablePaymentCache.set(payment.id, { expiresAt, payment }));\n  refundablePaymentListCache = { expiresAt, limit: safeLimit, payments };\n  return payments;\n};\n\nexport const prefetchPagamentosEstornaveis = async (limite = 25): Promise<void> => {\n  try {\n    await listarPagamentosEstornaveis(limite);\n  } catch {\n    // Prefetch é oportunista: o modal continua com seu fallback normal.\n  }\n};\n\nexport const estornarPagamento = async (\n",
)
replace_once(
    path,
    "  refundablePaymentCache.delete(String(pagamentoId));\n  return res.json();\n};\n",
    "  refundablePaymentCache.delete(String(pagamentoId));\n  refundablePaymentListCache = null;\n  return res.json();\n};\n",
)
replace_once(
    path,
    "  listarPagamentosEstornaveis,\n  estornarPagamento,\n",
    "  listarPagamentosEstornaveis,\n  prefetchPagamentosEstornaveis,\n  estornarPagamento,\n",
)

# 3) Prefetch refund list as soon as current cash-turn screen has refundable payments.
path = 'src/components/caixa/CaixaTurnoAtualTab.tsx'
replace_once(path, "import React, { useState } from 'react';\n", "import React, { useEffect, useState } from 'react';\n")
replace_once(
    path,
    "import { EstornoModal } from './EstornoModal';\n",
    "import { EstornoModal } from './EstornoModal';\nimport { prefetchPagamentosEstornaveis } from '../../config/caixaService';\n",
)
replace_once(
    path,
    "  const [refundPaymentId, setRefundPaymentId] = useState<string | null>(null);\n\n  if (!turnoResumo) return <CaixaSummarySkeleton />;\n",
    "  const [refundPaymentId, setRefundPaymentId] = useState<string | null>(null);\n\n  useEffect(() => {\n    const hasRefundablePayment = (turnoResumo?.atividades_recentes || []).some(activity => (\n      activity.tipo === 'recebimento' && activity.id.startsWith('pagamento:')\n    ));\n    if (turnoResumo?.status !== 'aberto' || !hasRefundablePayment) return;\n    void prefetchPagamentosEstornaveis(25);\n  }, [turnoResumo?.status, turnoResumo?.atividades_recentes]);\n\n  if (!turnoResumo) return <CaixaSummarySkeleton />;\n",
)

# 4) Refund modal: overlap requests and reserve list space with skeleton cards.
path = 'src/components/caixa/EstornoModal.tsx'
replace_once(
    path,
    "  const [loading, setLoading] = useState(true);\n  const [submitting, setSubmitting] = useState(false);\n",
    "  const [loading, setLoading] = useState(true);\n  const [listLoading, setListLoading] = useState(Boolean(initialPaymentId));\n  const [submitting, setSubmitting] = useState(false);\n",
)
replace_once(
    path,
    "  const load = async (background = false) => {\n    if (!background) setLoading(true);\n    if (!background) setError(null);\n",
    "  const load = async (background = false) => {\n    if (background) setListLoading(true);\n    else setLoading(true);\n    if (!background) setError(null);\n",
)
replace_once(
    path,
    "    } finally {\n      if (!background) setLoading(false);\n    }\n  };\n",
    "    } finally {\n      if (background) setListLoading(false);\n      else setLoading(false);\n    }\n  };\n",
)
old_bootstrap = """      setLoading(true);\n      setError(null);\n      try {\n        const payment = await obterPagamentoEstornavel(initialPaymentId);\n        if (cancelled) return;\n        setPayments([payment]);\n        selectPayment(payment);\n        setLoading(false);\n        void load(true);\n      } catch (err) {\n        if (cancelled) return;\n        await load();\n      }\n"""
new_bootstrap = """      setLoading(true);\n      setListLoading(true);\n      setError(null);\n      const listPromise = listarPagamentosEstornaveis(25);\n      try {\n        const payment = await obterPagamentoEstornavel(initialPaymentId);\n        if (cancelled) return;\n        setPayments([payment]);\n        selectPayment(payment);\n        setLoading(false);\n        void listPromise\n          .then(data => {\n            if (cancelled) return;\n            mergePayments(data);\n          })\n          .catch(() => undefined)\n          .finally(() => {\n            if (!cancelled) setListLoading(false);\n          });\n      } catch (err) {\n        if (cancelled) return;\n        setListLoading(false);\n        await load();\n      }\n"""
replace_once(path, old_bootstrap, new_bootstrap)
old_list = """            <div className=\"mt-3 max-h-[58vh] space-y-2 overflow-y-auto pr-1\">\n              {loading ? (\n                <div className=\"flex items-center justify-center gap-2 py-10 text-xs text-koma-muted\"><Loader2 size={16} className=\"animate-spin\" /> Carregando recebimentos…</div>\n              ) : filtered.length === 0 ? (\n                <div className=\"rounded-2xl border border-dashed border-koma-border px-4 py-8 text-center text-xs text-koma-muted\">Nenhum pagamento disponível para devolução.</div>\n              ) : filtered.map(payment => {\n                const active = payment.id === selectedId;\n                return (\n                  <button\n                    key={payment.id}\n                    type=\"button\"\n                    onClick={() => selectPayment(payment)}\n                    className={`w-full rounded-2xl border p-3 text-left transition-colors ${active ? 'border-rose-500/50 bg-rose-500/10' : 'border-koma-border bg-koma-card hover:bg-koma-raised'}`}\n                  >\n                    <div className=\"flex items-start justify-between gap-3\">\n                      <div className=\"min-w-0\">\n                        <strong className=\"block truncate text-xs text-koma-foreground\">{payment.origem}</strong>\n                        <span className=\"mt-1 block text-[9px] text-koma-muted\">{formatBackendDateTime(payment.criado_em)} · {methodLabel[payment.metodo_original] || payment.metodo_original}</span>\n                      </div>\n                      <strong className=\"shrink-0 text-xs tabular-nums text-rose-800 dark:text-rose-300\">{currency.format(payment.saldo_estornavel)}</strong>\n                    </div>\n                    <span className=\"mt-2 block text-[9px] text-koma-muted\">Original {currency.format(payment.valor_original)} · disponível para devolução</span>\n                  </button>\n                );\n              })}\n            </div>\n"""
new_list = """            <div className=\"mt-3 max-h-[58vh] space-y-2 overflow-y-auto pr-1\">\n              {loading && payments.length === 0 ? (\n                <div className=\"flex items-center justify-center gap-2 py-10 text-xs text-koma-muted\"><Loader2 size={16} className=\"animate-spin\" /> Carregando recebimentos…</div>\n              ) : (\n                <>\n                  {filtered.map(payment => {\n                    const active = payment.id === selectedId;\n                    return (\n                      <button\n                        key={payment.id}\n                        type=\"button\"\n                        onClick={() => selectPayment(payment)}\n                        className={`w-full rounded-2xl border p-3 text-left transition-colors ${active ? 'border-rose-500/50 bg-rose-500/10' : 'border-koma-border bg-koma-card hover:bg-koma-raised'}`}\n                      >\n                        <div className=\"flex items-start justify-between gap-3\">\n                          <div className=\"min-w-0\">\n                            <strong className=\"block truncate text-xs text-koma-foreground\">{payment.origem}</strong>\n                            <span className=\"mt-1 block text-[9px] text-koma-muted\">{formatBackendDateTime(payment.criado_em)} · {methodLabel[payment.metodo_original] || payment.metodo_original}</span>\n                          </div>\n                          <strong className=\"shrink-0 text-xs tabular-nums text-rose-800 dark:text-rose-300\">{currency.format(payment.saldo_estornavel)}</strong>\n                        </div>\n                        <span className=\"mt-2 block text-[9px] text-koma-muted\">Original {currency.format(payment.valor_original)} · disponível para devolução</span>\n                      </button>\n                    );\n                  })}\n                  {listLoading && search.trim().length === 0 && Array.from({ length: 5 }).map((_, index) => (\n                    <div key={`refund-skeleton-${index}`} className=\"h-[76px] animate-pulse rounded-2xl border border-koma-border bg-koma-card\" aria-hidden=\"true\" />\n                  ))}\n                  {!listLoading && filtered.length === 0 && (\n                    <div className=\"rounded-2xl border border-dashed border-koma-border px-4 py-8 text-center text-xs text-koma-muted\">Nenhum pagamento disponível para devolução.</div>\n                  )}\n                </>\n              )}\n            </div>\n"""
replace_once(path, old_list, new_list)

# 5) Strengthen focused regression tests.
path = 'tests/manual_operational_regressions.test.ts'
p = Path(path)
text = p.read_text()
if 'caixaService' not in text:
    text = text.replace(
        'const refund = readFileSync(new URL("../src/components/caixa/EstornoModal.tsx", import.meta.url), "utf8");\n',
        'const refund = readFileSync(new URL("../src/components/caixa/EstornoModal.tsx", import.meta.url), "utf8");\nconst turno = readFileSync(new URL("../src/components/caixa/CaixaTurnoAtualTab.tsx", import.meta.url), "utf8");\nconst caixaService = readFileSync(new URL("../src/config/caixaService.ts", import.meta.url), "utf8");\n',
    )
text += '''\n\ntest("audio tenta desbloquear uma vez por ativação real e não faz resume durante alerta", () => {\n  assert.match(caixa, /navigator\.userActivation/);\n  assert.match(caixa, /let attempted = false/);\n  assert.match(caixa, /window\.addEventListener\('click', unlock, \{ capture: true \}\)/);\n  const alertBlock = caixa.match(/const playOrderAlert = useCallback\([\\s\\S]*?\}, \[soundEnabled\]\);/)?.[0] || "";\n  assert.doesNotMatch(alertBlock, /ctx\.resume\(/);\n});\n\ntest("devolução faz prefetch e reserva a lista enquanto o contexto abre imediatamente", () => {\n  assert.match(caixaService, /refundablePaymentListCache/);\n  assert.match(caixaService, /prefetchPagamentosEstornaveis/);\n  assert.match(turno, /void prefetchPagamentosEstornaveis\(25\)/);\n  assert.match(refund, /const \[listLoading, setListLoading\]/);\n  assert.match(refund, /const listPromise = listarPagamentosEstornaveis\(25\)/);\n  assert.match(refund, /refund-skeleton-/);\n});\n'''
p.write_text(text)

print('audio/refund polish patch applied')
