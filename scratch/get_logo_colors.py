from PIL import Image
import collections

# Load the image
img = Image.open("/home/testuser/Downloads/sistema-gourmet-bistro/src/assets/logo.png")
img = img.convert("RGB")
img = img.resize((100, 100)) # resize to get dominant colors easily

colors = img.getdata()
counter = collections.Counter(colors)

# Get the most common colors
most_common = counter.most_common(10)
for rgb, count in most_common:
    hex_color = '#{:02x}{:02x}{:02x}'.format(rgb[0], rgb[1], rgb[2])
    print(f"Color: {hex_color}, Count: {count}")
