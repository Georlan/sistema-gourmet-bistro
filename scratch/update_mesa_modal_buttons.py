import re

file_path = "/home/testuser/Downloads/sistema-gourmet-bistro/src/components/MesaDetailsModal.tsx"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Update the "Lançar Pedidos" empty state button
old_lancar = 'className="mt-2 px-5 py-2.5 bg-rose-900/40 border border-rose-800/50 hover:bg-[#601823] text-white rounded-xl text-xs font-bold tracking-wider uppercase transition-colors cursor-pointer border border-rose-900/50/20"'
new_lancar = 'className="mt-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold tracking-wider uppercase transition-colors cursor-pointer border border-emerald-500/20 shadow-md shadow-emerald-500/5"'
content = content.replace(old_lancar, new_lancar)

# 2. Update print button style in modals (Imprimir Extrato, Imprimir Via Cozinha)
old_print = 'className="w-full py-3 bg-rose-900/40 border border-rose-800/50 hover:bg-[#601823] text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider border border-rose-900/50/20 transition-all shadow-lg shadow-[#f43f5e]/15"'
new_print = 'className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider border border-emerald-500/20 transition-all shadow-lg shadow-emerald-500/10"'
content = content.replace(old_print, new_print)

# 3. Double check other red colors left in MesaDetailsModal.tsx
content = content.replace("bg-rose-900/40 border border-rose-800/50 hover:bg-[#601823]", "bg-rose-950/40 border border-rose-900/50 text-rose-400 hover:bg-rose-900/20")

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("SUCCESSFULLY UPDATED MESA DETAILS MODAL BUTTON COLORS")
