from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected 1 match, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

replace_once(
    'backend/app/routes/caixa.py',
    '''                Item.status.in_(("pronto", "entregue")),
                Item.pago == False
''',
    '''                Item.status != 'cancelado',
                Item.pago == False
''',
)
replace_once(
    'backend/app/routes/caixa.py',
    '''                    detail="Nenhum item pronto e pendente de pagamento foi selecionado."
''',
    '''                    detail="Nenhum item válido pendente de pagamento foi selecionado."
''',
)
replace_once(
    'src/components/CaixaPanel.tsx',
    '''                        {selectedItemIds.length > 0
                          ? 'Receber itens prontos'
                          : 'Registrar adiantamento'}
''',
    '''                        {selectedItemIds.length > 0
                          ? (isTableCheckoutOrder(selectedOrder) ? 'Receber itens prontos' : 'Receber itens selecionados')
                          : (isTableCheckoutOrder(selectedOrder) ? 'Registrar adiantamento' : 'Lançar pagamento / baixa')}
''',
)
print('final manual-test amendment applied')
