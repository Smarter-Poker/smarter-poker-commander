import sys
import io
from PIL import Image

try:
    from rembg import remove
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "rembg", "Pillow"])
    from rembg import remove

input_path = '/Users/smarter.poker/.gemini/antigravity/brain/d91b8ea2-567b-4029-afb9-0acac78ea587/.user_uploaded/media_1787234488457.jpg'
output_path = '/Users/smarter.poker/.gemini/antigravity/brain/d91b8ea2-567b-4029-afb9-0acac78ea587/upgrade_modal_bg.png'

print("Removing background...")
with open(input_path, 'rb') as i:
    input_data = i.read()

output_data = remove(input_data)

with open(output_path, 'wb') as o:
    o.write(output_data)

print("Saved to", output_path)
