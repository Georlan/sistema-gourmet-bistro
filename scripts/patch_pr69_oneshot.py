from pathlib import Path

path = Path(__file__).with_name("apply_pr69_smartpos_kanban.py")
text = path.read_text(encoding="utf-8")
start_marker = "payment_button_pattern = re.compile("
end_marker = "write(caixa_path, caixa)"
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("could not locate payment button rewrite section")
end += len(end_marker)

replacement = r'''old_payment_guard = """                                  e.stopPropagation();
                                  if (isLoading) return;
                                  
                                  const tableComandas = orders.filter("""
new_payment_guard = """                                  e.stopPropagation();
                                  if (smartPosState?.blocksPayment || isLoading) return;
                                  
                                  const tableComandas = orders.filter("""
if caixa.count(old_payment_guard) != 1:
    raise RuntimeError(f"CaixaPanel: payment guard marker count={caixa.count(old_payment_guard)}")
caixa = caixa.replace(old_payment_guard, new_payment_guard, 1)

old_payment_open = """                              <button
                                type=\"button\"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (smartPosState?.blocksPayment || isLoading) return;"""
new_payment_open = """                              <button
                                type=\"button\"
                                disabled={smartPosState?.blocksPayment === true}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (smartPosState?.blocksPayment || isLoading) return;"""
if caixa.count(old_payment_open) != 1:
    raise RuntimeError(f"CaixaPanel: payment button opening count={caixa.count(old_payment_open)}")
caixa = caixa.replace(old_payment_open, new_payment_open, 1)

old_payment_label = """                                <Check size={13} /><span>Abrir pagamento</span>"""
new_payment_label = """                                {smartPosState?.blocksPayment ? (
                                  <><Smartphone size={13} /><span>{smartPosState.ctaLabel}</span></>
                                ) : (
                                  <><Check size={13} /><span>Abrir pagamento</span></>
                                )}"""
if caixa.count(old_payment_label) != 1:
    raise RuntimeError(f"CaixaPanel: payment button label count={caixa.count(old_payment_label)}")
caixa = caixa.replace(old_payment_label, new_payment_label, 1)
write(caixa_path, caixa)'''

path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")
print("Patched one-shot payment button rewrite.")
