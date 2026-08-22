import sys
from rembg import remove
from PIL import Image

input_path = sys.argv[1]
output_path = sys.argv[2]

img = Image.open(input_path)
output = remove(img)
output.save(output_path)
print(f"Saved {output_path}")
