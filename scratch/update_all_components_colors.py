import os

files_to_update = [
    "/home/testuser/Downloads/sistema-gourmet-bistro/src/App.tsx",
    "/home/testuser/Downloads/sistema-gourmet-bistro/src/components/MesaDetailsModal.tsx",
    "/home/testuser/Downloads/sistema-gourmet-bistro/src/components/MenuPanel.tsx",
    "/home/testuser/Downloads/sistema-gourmet-bistro/src/components/KitchenPanel.tsx"
]

for file_path in files_to_update:
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        continue
        
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Apply gold replacements
    content = content.replace("#C5A880", "#10b981")
    content = content.replace("C5A880", "10b981")
    content = content.replace("#b0936b", "#059669")
    content = content.replace("#B3966E", "#059669")
    content = content.replace("#A88D65", "#059669")
    content = content.replace("#B3966E", "#059669")

    # Apply red replacements
    content = content.replace("bg-[#7A1F2D]", "bg-rose-900/40 border border-rose-800/50")
    content = content.replace("text-[#7A1F2D]", "text-rose-400")
    content = content.replace("border-[#7A1F2D]", "border-rose-900/50")
    content = content.replace("bg-[#7A1F2D]/10", "bg-rose-950/20")
    content = content.replace("bg-[#7A1F2D]/20", "bg-rose-950/30")
    content = content.replace("bg-[#7A1F2D]/5", "bg-rose-950/10")
    content = content.replace("border-[#7A1F2D]/20", "border-rose-900/30")
    content = content.replace("text-[#C46A74]", "text-rose-300")
    content = content.replace("#7A1F2D", "#f43f5e") # rose-500

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)
        
    print(f"Updated colors in: {os.path.basename(file_path)}")
