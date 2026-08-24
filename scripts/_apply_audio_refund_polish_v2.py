from pathlib import Path
import subprocess
import sys

patch_path = Path('scripts/_apply_audio_refund_polish.py')
source = patch_path.read_text()
audio_start = source.find('# 1) Audio: one trusted user-activation attempt, no repeated resume spam.')
audio_end = source.find('# 2) Refund service: list cache + explicit prefetch + invalidation after refund.')
if audio_start < 0 or audio_end < 0 or audio_end <= audio_start:
    raise SystemExit('audio patch section markers not found')

# The audio code lives in a very large component. Remove the generic first-match
# edits from the original helper and apply them only inside the explicit audio
# section below so no similarly-shaped callback elsewhere can be touched.
patch_path.write_text(
    source[:audio_start]
    + '# 1) Audio patch is applied by _apply_audio_refund_polish_v2.py.\n\n'
    + source[audio_end:]
)
subprocess.run([sys.executable, str(patch_path)], check=True)

# Keep focused source regressions behavior-oriented rather than tied to an exact
# declaration shape/formatting.
test_path = Path('tests/manual_operational_regressions.test.ts')
test_text = test_path.read_text()
replacements = {
    "  assert.match(caixa, /let attempted = false/);": "  assert.match(caixa, /audioUnlockAttemptedRef\\.current/);",
    "  assert.match(refund, /const \\[listLoading, setListLoading\\]/);": "  assert.match(refund, /setListLoading\\(true\\)/);",
}
for old_assertion, new_assertion in replacements.items():
    if old_assertion not in test_text:
        raise SystemExit(f'legacy focused assertion not found: {old_assertion}')
    test_text = test_text.replace(old_assertion, new_assertion, 1)
test_path.write_text(test_text)

caixa_path = Path('src/components/CaixaPanel.tsx')
text = caixa_path.read_text()
section_start_marker = '  // ── Gaveta de Aceite (Floating Drawer) & Sistema de Áudio Unificado do Caixa ────\n'
section_end_marker = '\n  // Monitor universal de pedidos e mesas (Garçom / Caixa / Salão)'
start = text.find(section_start_marker)
end = text.find(section_end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('cashier audio section markers not found')
block = text[start:end]


def block_replace(old: str, new: str) -> None:
    global block
    if old not in block:
        raise SystemExit(f'audio block pattern not found: {old[:100]!r}')
    block = block.replace(old, new, 1)


block_replace(
    "  const audioCtxRef = useRef<AudioContext | null>(null);\n  const audioUnlockedRef = useRef(false);\n\n  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {\n",
    "  const audioCtxRef = useRef<AudioContext | null>(null);\n  const audioUnlockedRef = useRef(false);\n  const audioUnlockAttemptedRef = useRef(false);\n\n  const primeAudioFromGesture = useCallback(async (): Promise<boolean> => {\n    if (audioUnlockedRef.current && audioCtxRef.current?.state === 'running') return true;\n    const activation = typeof navigator !== 'undefined' ? navigator.userActivation : undefined;\n    if (activation && !activation.isActive) return false;\n    try {\n      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;\n      if (!AudioContextCtor) return false;\n      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {\n        audioCtxRef.current = new AudioContextCtor();\n      }\n      const ctx = audioCtxRef.current;\n      if (ctx.state === 'suspended') await ctx.resume();\n      const ready = ctx.state === 'running';\n      audioUnlockedRef.current = ready;\n      return ready;\n    } catch {\n      audioUnlockedRef.current = false;\n      return false;\n    }\n  }, []);\n\n  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {\n",
)
block_replace(
    "    if (next) {\n      playOrderAlert('test');\n    }\n",
    "    if (next) {\n      audioUnlockAttemptedRef.current = true;\n      void primeAudioFromGesture().then(ready => {\n        if (ready) playOrderAlert('test');\n      });\n    }\n",
)
block_replace(
    "    try {\n      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {\n        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();\n      }\n      const ctx = audioCtxRef.current;\n      if (ctx.state === 'suspended') {\n        // Fora de uma interação do usuário o navegador bloqueia resume().\n        // O desbloqueio é feito pelo listener abaixo; não poluímos o console\n        // nem criamos alertas parciais enquanto o áudio ainda está suspenso.\n        if (type !== 'test') return;\n        void ctx.resume().then(() => { audioUnlockedRef.current = true; }).catch(() => undefined);\n      } else if (ctx.state === 'running') {\n        audioUnlockedRef.current = true;\n      }\n      const t = ctx.currentTime;\n",
    "    try {\n      const ctx = audioCtxRef.current;\n      if (!ctx || ctx.state !== 'running') return;\n      const t = ctx.currentTime;\n",
)
old_unlock_start = block.find('  // Desbloqueia o contexto de áudio somente dentro de uma interação real.\n  useEffect(() => {')
if old_unlock_start < 0:
    raise SystemExit('old audio unlock effect not found')
old_unlock_end = block.find('  }, []);', old_unlock_start)
if old_unlock_end < 0:
    raise SystemExit('old audio unlock effect end not found')
old_unlock_end += len('  }, []);')
new_unlock = """  // Chrome libera WebAudio a partir de uma ativação real do usuário.\n  // Uma montagem faz no máximo uma tentativa automática; alertas nunca tentam\n  // criar ou retomar contexto por conta própria, evitando warning em cascata.\n  useEffect(() => {\n    const unlock = (event: Event) => {\n      if (audioUnlockedRef.current || audioUnlockAttemptedRef.current || !event.isTrusted) return;\n      const activation = typeof navigator !== 'undefined' ? navigator.userActivation : undefined;\n      if (activation && !activation.isActive) return;\n      audioUnlockAttemptedRef.current = true;\n      window.removeEventListener('click', unlock, true);\n      window.removeEventListener('keydown', unlock, true);\n      void primeAudioFromGesture();\n    };\n    window.addEventListener('click', unlock, { capture: true });\n    window.addEventListener('keydown', unlock, { capture: true });\n    return () => {\n      window.removeEventListener('click', unlock, true);\n      window.removeEventListener('keydown', unlock, true);\n    };\n  }, [primeAudioFromGesture]);"""
block = block[:old_unlock_start] + new_unlock + block[old_unlock_end:]

caixa_path.write_text(text[:start] + block + text[end:])
print('scoped audio patch applied')
