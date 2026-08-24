from __future__ import annotations

import re
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 exact match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, repl: str, label: str) -> str:
    updated, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 regex match, found {count}")
    return updated


caixa_path = Path("src/components/CaixaPanel.tsx")
caixa = caixa_path.read_text(encoding="utf-8")

caixa = replace_once(
    caixa,
    "  const audioCtxRef = useRef<AudioContext | null>(null);\n",
    "  const audioCtxRef = useRef<AudioContext | null>(null);\n  const audioUnlockedRef = useRef(false);\n",
    "audio unlock ref",
)

caixa = replace_once(
    caixa,
    "    if (type !== 'test' && !soundEnabled) return;\n",
    "    if (type !== 'test' && (!soundEnabled || !audioUnlockedRef.current)) return;\n",
    "audio guard",
)

caixa = replace_once(
    caixa,
    "      if (ctx.state === 'suspended') {\n        ctx.resume();\n      }\n",
    "      if (ctx.state === 'suspended') {\n        // Fora de uma interação do usuário o navegador bloqueia resume().\n        // O desbloqueio é feito pelo listener abaixo; não poluímos o console\n        // nem criamos alertas parciais enquanto o áudio ainda está suspenso.\n        if (type !== 'test') return;\n        void ctx.resume().then(() => { audioUnlockedRef.current = true; }).catch(() => undefined);\n      } else if (ctx.state === 'running') {\n        audioUnlockedRef.current = true;\n      }\n",
    "suspended audio behavior",
)

caixa = regex_once(
    caixa,
    r"      if \(type === 'new_order'\) \{\n        // Bipe duplo suave e moderno de novo pedido \(Garçom / Caixa / Balcão\): D5 \(587Hz\) -> A5 \(880Hz\)\n        const notes = \[\n          \{ freq: 587\.33, start: 0, dur: 0\.12, vol: 0\.28 \},\n          \{ freq: 880\.00, start: 0\.10, dur: 0\.22, vol: 0\.35 \},\n        \];",
    "      if (type === 'new_order') {\n        // Um único bipe curto confirma um novo pedido. Outros eventos mantêm\n        // assinaturas sonoras próprias, evitando a sensação de evento duplicado.\n        const notes = [\n          { freq: 783.99, start: 0, dur: 0.18, vol: 0.34 },\n        ];",
    "single new-order beep",
)

caixa = regex_once(
    caixa,
    r"  // Desbloqueia o contexto de áudio na primeira interação do usuário na tela\n  useEffect\(\(\) => \{\n    const unlock = \(\) => \{\n      if \(!audioCtxRef\.current\) \{\n        audioCtxRef\.current = new \(window\.AudioContext \|\| \(window as any\)\.webkitAudioContext\)\(\);\n      \}\n      if \(audioCtxRef\.current\.state === 'suspended'\) \{\n        audioCtxRef\.current\.resume\(\);\n      \}\n    \};\n    window\.addEventListener\('click', unlock, \{ passive: true \}\);\n    window\.addEventListener\('keydown', unlock, \{ passive: true \}\);\n    return \(\) => \{\n      window\.removeEventListener\('click', unlock\);\n      window\.removeEventListener\('keydown', unlock\);\n    \};\n  \}, \[\]\);",
    "  // Desbloqueia o contexto de áudio somente dentro de uma interação real.\n  useEffect(() => {\n    const unlock = () => {\n      try {\n        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {\n          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();\n        }\n        const ctx = audioCtxRef.current;\n        if (ctx.state === 'running') {\n          audioUnlockedRef.current = true;\n          return;\n        }\n        void ctx.resume()\n          .then(() => { audioUnlockedRef.current = ctx.state === 'running'; })\n          .catch(() => { audioUnlockedRef.current = false; });\n      } catch {\n        audioUnlockedRef.current = false;\n      }\n    };\n    window.addEventListener('pointerdown', unlock, { passive: true });\n    window.addEventListener('keydown', unlock, { passive: true });\n    return () => {\n      window.removeEventListener('pointerdown', unlock);\n      window.removeEventListener('keydown', unlock);\n    };\n  }, []);",
    "audio unlock effect",
)

caixa = regex_once(
    caixa,
    r"    const attentionKeys = new Set<string>\(\);\n    activeTableList\.forEach\(order => \{\n      if \(getOrderSlaData\(order, nowTimestamp\)\.minutes >= 15\) \{\n        attentionKeys\.add\(`mesa:\$\{order\.id\}`\);\n      \}\n    \}\);\n    activeDigitalOrders\.forEach\(order => \{\n      if \(\n        \['pendente', 'analise'\]\.includes\(order\.status\)\n        \|\| getOrderSlaData\(order, nowTimestamp\)\.minutes >= 15\n      \) \{\n        attentionKeys\.add\(`digital:\$\{order\.id\}`\);\n      \}\n    \}\);\n    pagamentosPendentes\.forEach\(\(payment, index\) => \{\n      attentionKeys\.add\(`pagamento:\$\{payment\?\.id \|\| index\}`\);\n    \}\);\n\n    return \{\n      oldestOrder: formatOldestAge\(timestamps\),\n      openValue: tableValue \+ digitalValue,\n      attentionCount: attentionKeys\.size,\n    \};",
    "    const pendingPaymentCount = pagamentosPendentes.length;\n    const pendingAcceptanceCount = activeDigitalOrders.filter(order =>\n      ['pendente', 'analise'].includes(order.status)\n    ).length;\n    const readyToFinishCount = tableOrdersReady.length;\n    const overdueCount = [\n      ...activeTableList,\n      ...activeDigitalOrders,\n    ].filter(order => getOrderSlaData(order, nowTimestamp).minutes >= 15).length;\n\n    const actionMetric = pendingPaymentCount > 0\n      ? { label: 'pagamentos para confirmar', value: pendingPaymentCount, needsAttention: true }\n      : pendingAcceptanceCount > 0\n        ? { label: 'pedidos para aceitar', value: pendingAcceptanceCount, needsAttention: true }\n        : readyToFinishCount > 0\n          ? { label: 'prontos para concluir', value: readyToFinishCount, needsAttention: true }\n          : overdueCount > 0\n            ? { label: 'pedidos há +15 min', value: overdueCount, needsAttention: true }\n            : { label: 'sem pendências', value: 0, needsAttention: false };\n\n    return {\n      oldestOrder: formatOldestAge(timestamps),\n      openValue: tableValue + digitalValue,\n      actionMetric,\n    };",
    "actionable order metric",
)

caixa = replace_once(
    caixa,
    "                  {\n                    label: 'exigem atenção',\n                    value: operationalOrderInsights.attentionCount,\n                    valueClassName: operationalOrderInsights.attentionCount > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-300',\n                  },\n",
    "                  {\n                    label: operationalOrderInsights.actionMetric.label,\n                    value: operationalOrderInsights.actionMetric.value,\n                    valueClassName: operationalOrderInsights.actionMetric.needsAttention ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-300',\n                  },\n",
    "operational banner metric",
)

caixa_path.write_text(caixa, encoding="utf-8")


refund_path = Path("src/components/caixa/EstornoModal.tsx")
refund = refund_path.read_text(encoding="utf-8")

selector = """  const selectPayment = (payment: RefundablePayment | null) => {\n    if (!payment) {\n      setSelectedId('');\n      setValue('');\n      setReason('');\n      setPayoutMethod('');\n      setOriginValues({});\n      setError(null);\n      return;\n    }\n\n    // Todos os campos ligados ao pagamento mudam no mesmo evento. Isso evita\n    // um frame intermediário com os dados da mesa anterior (o \"piscar\").\n    setSelectedId(payment.id);\n    setValue(payment.saldo_estornavel);\n    setPayoutMethod(payment.metodo_original);\n    setReason('');\n    setOriginValues({});\n    setError(null);\n  };\n\n"""
refund = replace_once(
    refund,
    "  const selected = payments.find(payment => payment.id === selectedId) || null;\n\n",
    "  const selected = payments.find(payment => payment.id === selectedId) || null;\n\n" + selector,
    "refund synchronous selector",
)

refund = replace_once(
    refund,
    "      if (!initialPaymentId && selectedId && !data.some(payment => payment.id === selectedId)) {\n        setSelectedId('');\n      }\n",
    "      if (!initialPaymentId && selectedId && !data.some(payment => payment.id === selectedId)) {\n        selectPayment(null);\n      }\n",
    "refund invalid selection reset",
)

refund = replace_once(
    refund,
    "        setPayments([payment]);\n        setSelectedId(payment.id);\n        setLoading(false);\n",
    "        setPayments([payment]);\n        selectPayment(payment);\n        setLoading(false);\n",
    "refund bootstrap selection",
)

refund = regex_once(
    refund,
    r"\n  useEffect\(\(\) => \{\n    if \(!selected\) \{\n      setValue\(''\);\n      setReason\(''\);\n      setPayoutMethod\(''\);\n      setOriginValues\(\{\}\);\n      return;\n    \}\n    setValue\(selected\.saldo_estornavel\);\n    setPayoutMethod\(selected\.metodo_original\);\n    setReason\(''\);\n    setOriginValues\(\{\}\);\n    setError\(null\);\n  \}, \[selectedId\]\);\n",
    "\n",
    "remove delayed refund selection effect",
)

refund = replace_once(
    refund,
    "                    onClick={() => setSelectedId(payment.id)}\n",
    "                    onClick={() => selectPayment(payment)}\n",
    "refund list click",
)

refund = replace_once(
    refund,
    "                      {selected.origens_financeiras.filter(origin => origin.saldo_estornavel > 0).map(origin => (\n",
    "                      {selected.origens_financeiras.filter(origin => origin.saldo_estornavel > 0).map((origin, index, origins) => (\n",
    "refund origins map index",
)

refund = replace_once(
    refund,
    "                            <strong className=\"block truncate text-[10px] text-koma-foreground\">{origin.label}</strong>\n",
    "                            <strong className=\"block truncate text-[10px] text-koma-foreground\">\n                              {origin.label}{origins.filter(candidate => candidate.label === origin.label).length > 1 ? ` · Parte ${index + 1}` : ''}\n                            </strong>\n",
    "refund duplicate origin labels",
)

refund_path.write_text(refund, encoding="utf-8")


test_path = Path("tests/manual_operational_regressions.test.ts")
test_path.write_text(
    '''import assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\nimport test from "node:test";\n\nconst caixa = readFileSync(new URL("../src/components/CaixaPanel.tsx", import.meta.url), "utf8");\nconst refund = readFileSync(new URL("../src/components/caixa/EstornoModal.tsx", import.meta.url), "utf8");\n\ntest("novo pedido emite uma única nota e não tenta tocar antes do desbloqueio do navegador", () => {\n  const block = caixa.match(/if \\(type === 'new_order'\\) \\{[\\s\\S]*?\\} else if \\(type === 'bill_requested'\\)/)?.[0] || "";\n  assert.match(block, /Um único bipe curto confirma um novo pedido/);\n  assert.equal((block.match(/\\{ freq:/g) || []).length, 1);\n  assert.match(caixa, /audioUnlockedRef\\.current/);\n  assert.doesNotMatch(caixa, /Bipe duplo suave e moderno de novo pedido/);\n});\n\ntest("banner de pedidos explica a próxima ação em vez de usar atenção genérica", () => {\n  assert.match(caixa, /label: 'pagamentos para confirmar'/);\n  assert.match(caixa, /label: 'pedidos para aceitar'/);\n  assert.match(caixa, /label: 'prontos para concluir'/);\n  assert.match(caixa, /label: 'pedidos há \\+15 min'/);\n  assert.doesNotMatch(caixa, /label: 'exigem atenção'/);\n});\n\ntest("troca de pagamento na devolução atualiza formulário de forma atômica", () => {\n  assert.match(refund, /const selectPayment = \\(payment: RefundablePayment \\| null\\) =>/);\n  assert.match(refund, /onClick=\\{\\(\\) => selectPayment\\(payment\\)\\}/);\n  assert.doesNotMatch(refund, /\\}, \\[selectedId\\]\\);/);\n  assert.match(refund, /Parte \\${index \\+ 1}/);\n});\n''',
    encoding="utf-8",
)

print("manual regression patch applied")
