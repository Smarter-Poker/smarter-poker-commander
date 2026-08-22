from PIL import Image
import os

paths = [
    'public/images/commander/icons/tn-director.webp',
    'public/images/commander/icons/tn-controls-new.webp',
    'public/images/commander/icons/tn-freerolls.webp'
]

for path in paths:
    img = Image.open(path)
    # Get the bounding box of the non-zero alpha pixels
    bbox = img.getbbox()
    if bbox:
        cropped_img = img.crop(bbox)
        print(f"Cropping {path} from {img.size} to {cropped_img.size}")
        cropped_img.save(path, format='WEBP', quality=95)
    else:
        print(f"Failed to find bbox for {path}")
