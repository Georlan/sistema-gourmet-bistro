import re

file_path = "/home/testuser/Downloads/sistema-gourmet-bistro/src/components/CaixaPanel.tsx"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Replace gold (#C5A880) and its variants with emerald-500 (#10b981)
content = content.replace("#C5A880", "#10b981")
content = content.replace("C5A880", "10b981")
content = content.replace("#b0936b", "#059669")
content = content.replace("#B3966E", "#059669")
content = content.replace("#b0936b", "#059669")

# 2. Replace red (#7A1F2D) with emerald/cyan/slate based on context
# Active selections like payment modes (Dinheiro, Pix, Cartão) or active order types should use emerald
content = content.replace("bg-[#7A1F2D] text-white shadow-sm", "bg-emerald-600 text-white shadow-sm")
content = content.replace("bg-[#7A1F2D] text-white border-transparent", "bg-emerald-600 text-white border-transparent")
content = content.replace("bg-[#7A1F2D] text-white shadow", "bg-emerald-600 text-white shadow")

# Close/Cancel/Sangria/Recusar/Fechar should use a modern slate or dark rose
content = content.replace("bg-[#7A1F2D] hover:bg-[#601823]", "bg-rose-950/40 border border-rose-900/50 text-rose-400 hover:bg-rose-900/20")
content = content.replace("bg-[#7A1F2D] hover:bg-[#8d2a3a]", "bg-rose-950/40 border border-rose-900/50 text-rose-400 hover:bg-rose-900/20")
content = content.replace("bg-[#7A1F2D] hover:bg-[#9d2b3c]", "bg-rose-950/40 border border-rose-900/50 text-rose-400 hover:bg-rose-900/20")
content = content.replace("bg-[#7A1F2D] hover:bg-[#601823] text-white", "bg-rose-950/40 border border-rose-900/50 text-rose-300 hover:bg-rose-900/20")
content = content.replace("bg-[#7A1F2D]/20 hover:bg-[#7A1F2D] text-[#C46A74]", "bg-rose-950/30 border border-rose-900/35 text-rose-400 hover:bg-rose-900/20")
content = content.replace("bg-[#7A1F2D]/20 hover:bg-[#7A1F2D]", "bg-rose-950/30 border border-rose-900/35 text-rose-400 hover:bg-rose-900/20")
content = content.replace("text-[#7A1F2D]", "text-emerald-500")
content = content.replace("focus:ring-[#7A1F2D]", "focus:ring-emerald-500")
content = content.replace("bg-[#7A1F2D]", "bg-emerald-600") # fallback default red to emerald
content = content.replace("#7A1F2D", "#10b981")

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("CAIXA PANEL COLORS UPDATED successfully")
