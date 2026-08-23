from pathlib import Path

path = Path('src/components/CaixaPanel.tsx')
text = path.read_text(encoding='utf-8')
old = """                onRefresh={async () => {
                  await Promise.all([
                    fetchTurnoResumo(),
                    onRefreshPagamentosPendentes?.(),
                  ]);
                }}
"""
if text.count(old) != 1:
    raise SystemExit(f'closing refresh callback: expected 1 match, found {text.count(old)}')
path.write_text(text.replace(old, '', 1), encoding='utf-8')

Path('scripts/chatgpt_finish_ux_extra.py').unlink(missing_ok=True)
