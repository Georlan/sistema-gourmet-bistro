import re

file_path = "/home/testuser/Downloads/sistema-gourmet-bistro/src/components/MenuPanel.tsx"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Update the "Adicionar Itens" button style
old_btn = 'className="px-3 py-1.5 bg-rose-900/40 border border-rose-800/50 hover:bg-[#601823] text-white text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1 border border-rose-900/50/20"'
new_btn = 'className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1 border border-slate-700/50 shadow-sm"'
content = content.replace(old_btn, new_btn)

# 2. Update the "1 Item" badge
old_badge = 'className="px-2.5 py-0.5 text-xs font-bold font-mono bg-rose-900/40 border border-rose-800/50/20 text-rose-300 rounded-full border border-rose-900/50/10"'
new_badge = 'className="px-2.5 py-0.5 text-xs font-bold font-mono bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full"'
content = content.replace(old_badge, new_badge)

# 3. Update focus rings in inputs
content = content.replace("focus:ring-[#f43f5e] focus:border-rose-900/50", "focus:ring-emerald-500 focus:border-emerald-500/50")

# 4. Update the active order type tab toggle selectors
old_tab_active = "bg-rose-900/40 border border-rose-800/50 text-white shadow-sm font-bold"
new_tab_active = "bg-emerald-600/25 border border-emerald-500/30 text-emerald-400 shadow-sm font-bold"
content = content.replace(old_tab_active, new_tab_active)

# 5. Update the "Lançar Pedido" submit button
old_submit = 'className="w-full py-3 bg-rose-900/40 border border-rose-800/50 hover:bg-[#601823] text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-[#f43f5e]/10 transition-all hover:translate-y-[-1px] cursor-pointer uppercase tracking-wider font-sans border border-rose-900/50/20 disabled:opacity-50 disabled:cursor-not-allowed"'
new_submit = 'className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/10 transition-all hover:translate-y-[-1px] cursor-pointer uppercase tracking-wider font-sans border border-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"'
content = content.replace(old_submit, new_submit)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("SUCCESSFULLY UPDATED MENU PANEL BUTTON COLORS")
