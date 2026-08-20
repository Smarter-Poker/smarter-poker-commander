import sys
from PIL import Image

for path in sys.argv[1:]:
    img = Image.open(path)
    print(f"{path}: {img.size}")
