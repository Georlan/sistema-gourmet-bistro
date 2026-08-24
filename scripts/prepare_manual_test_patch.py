from pathlib import Path

path = Path('scripts/apply_manual_test_fixes.py')
text = path.read_text(encoding='utf-8')
text = text.replace(
    '"""                        onClick={() => setPdvSelectedCategory(\'todos\')}\\n"""',
    '"""onClick={() => setPdvSelectedCategory(\'todos\')}"""',
)
text = text.replace(
    '"""                        onClick={() => { setPdvSelectedCategory(\'todos\'); setPdvProductDetailId(null); }}\\n"""',
    '"""onClick={() => { setPdvSelectedCategory(\'todos\'); setPdvProductDetailId(null); }}"""',
)
text = text.replace(
    '"""                        onClick={() => setPdvSelectedCategory(catObj.nome)}\\n"""',
    '"""onClick={() => setPdvSelectedCategory(catObj.nome)}"""',
)
text = text.replace(
    '"""                        onClick={() => { setPdvSelectedCategory(catObj.nome); setPdvProductDetailId(null); }}\\n"""',
    '"""onClick={() => { setPdvSelectedCategory(catObj.nome); setPdvProductDetailId(null); }}"""',
)
path.write_text(text, encoding='utf-8')
print('category patch normalized')
