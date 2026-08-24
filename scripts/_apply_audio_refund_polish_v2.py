from pathlib import Path
import subprocess
import sys

patch_path = Path('scripts/_apply_audio_refund_polish.py')
source = patch_path.read_text()
needle = 'replace_once(path, old_unlock, new_unlock)'
replacement = '''source_path = Path(path)
source_text = source_path.read_text()
start_marker = "  // Desbloqueia o contexto de áudio somente dentro de uma interação real.\\n  useEffect(() => {"
end_marker = "\\n  // Monitor universal de pedidos e mesas (Garçom / Caixa / Salão)"
start_index = source_text.find(start_marker)
if start_index < 0:
    raise SystemExit(f'audio unlock start marker not found in {path}')
end_index = source_text.find(end_marker, start_index)
if end_index < 0:
    raise SystemExit(f'audio unlock end marker not found in {path}')
source_path.write_text(source_text[:start_index] + new_unlock + source_text[end_index:])'''
if needle not in source:
    raise SystemExit('unlock replacement call not found in patch runner')
patch_path.write_text(source.replace(needle, replacement, 1))
subprocess.run([sys.executable, str(patch_path)], check=True)
