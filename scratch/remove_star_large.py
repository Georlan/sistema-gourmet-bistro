from PIL import Image, ImageDraw

# Open the logo image
img_path = "/home/testuser/Downloads/sistema-gourmet-bistro/src/assets/logo.png"
img = Image.open(img_path)
img = img.convert("RGB")

width, height = img.size

# Background color of the logo image
bg_color = (0x2f, 0x3d, 0x4a)

# Draw a larger rectangle covering the bottom-right area containing the AI star logo
draw = ImageDraw.Draw(img)
# Cover from x=820 to width, and y=380 to height to be absolutely sure the star is completely covered
draw.rectangle([820, 380, width, height], fill=bg_color)

# Save back to both locations
img.save(img_path)
img.save("/home/testuser/Downloads/sistema-gourmet-bistro/public/logo.png")

print("SUCCESSFULLY REMOVED STAR WITH LARGER BOX")
