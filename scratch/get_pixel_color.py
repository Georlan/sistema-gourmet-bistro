from PIL import Image
try:
    img = Image.open("/home/testuser/Downloads/sistema-gourmet-bistro/src/assets/logo.png")
    img = img.convert("RGB")
    pixel = img.getpixel((10, 10))
    hex_color = '#{:02x}{:02x}{:02x}'.format(pixel[0], pixel[1], pixel[2])
    print(f"PIXEL_COLOR: {hex_color}")
except Exception as e:
    print(f"ERROR: {e}")
