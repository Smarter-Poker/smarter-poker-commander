import sys
import os
from rembg import remove
from PIL import Image

mapping = {
    'media_1787238524719.jpg': 'card-waitlist.webp',
    'media_1787238527919.jpg': 'card-tournaments.webp',
    'media_1787238532435.jpg': 'card-floor.webp',
    'media_1787238574628.jpg': 'card-staff.webp',
    'media_1787238582905.jpg': 'card-displays.webp',
    'media_1787238594711.jpg': 'card-reports.webp'
}

base_dir = '/Users/smarter.poker/.gemini/antigravity/brain/210511b4-ea67-411b-9196-55a45d8deb30/.user_uploaded/'
out_dir = 'public/images/commander/'

for in_file, out_file in mapping.items():
    in_path = os.path.join(base_dir, in_file)
    out_path = os.path.join(out_dir, out_file)
    print(f"Processing {in_file} -> {out_file}")
    img = Image.open(in_path)
    # rembg to remove black corners
    output = remove(img)
    
    # Save as webp for good compression
    output.save(out_path, format='WEBP', quality=85)
    print(f"Saved {out_path}")
