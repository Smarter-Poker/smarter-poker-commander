import sys
import os
from PIL import Image
from collections import deque

mapping = {
    'media_1787243493448.jpg': 'tn-director.webp',
    'media_1787243496531.jpg': 'tn-controls-new.webp',
    'media_1787243498477.jpg': 'tn-freerolls.webp'
}

base_dir = '/Users/smarter.poker/.gemini/antigravity/brain/210511b4-ea67-411b-9196-55a45d8deb30/.user_uploaded/'
out_dir = 'public/images/commander/icons/'

def remove_black_corners(img):
    img = img.convert("RGBA")
    width, height = img.size
    
    visited = set()
    queue = deque([(0,0), (width-1,0), (0,height-1), (width-1,height-1)])
    
    pixels = img.load()
    threshold = 20
    
    while queue:
        x, y = queue.popleft()
        if (x, y) in visited:
            continue
        if x < 0 or x >= width or y < 0 or y >= height:
            continue
            
        r, g, b, a = pixels[x, y]
        if r < threshold and g < threshold and b < threshold:
            pixels[x, y] = (0, 0, 0, 0)
            visited.add((x, y))
            queue.append((x+1, y))
            queue.append((x-1, y))
            queue.append((x, y+1))
            queue.append((x, y-1))
            
    return img

for in_file, out_file in mapping.items():
    in_path = os.path.join(base_dir, in_file)
    out_path = os.path.join(out_dir, out_file)
    print(f"Processing {in_file} -> {out_file}")
    
    img = Image.open(in_path)
    img = remove_black_corners(img)
    img.save(out_path, format='WEBP', quality=95)
    print(f"Saved {out_path}")
