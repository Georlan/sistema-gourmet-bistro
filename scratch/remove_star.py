from PIL import Image, ImageDraw

# Open the logo image
img_path = "/home/testuser/Downloads/sistema-gourmet-bistro/src/assets/logo.png"
img = Image.open(img_path)
img = img.convert("RGB")

width, height = img.size

# Background color of the logo image
bg_color = (0x2f, 0x3d, 0x4a)

# Draw a rectangle covering the bottom-right area containing the AI star logo
draw = ImageDraw.Draw(img)
# The star is in the bottom-right, let's cover from x=880 to width, and y=430 to height
draw.rectangle([880, 430, width, height], fill=bg_color)

# Save back to both locations
img.save(img_path)
img.save("/home/testuser/Downloads/sistema-gourmet-bistro/public/logo.png")

print("SUCCESSFULLY REMOVED STAR FROM LOGO")
