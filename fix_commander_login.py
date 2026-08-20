import re

with open('pages/commander/login.js', 'r') as f:
    text = f.read()

# 1. Add appearance
input_styles_regex = r"(style=\{\{[\s\S]*?)(fontSize:\s*'15px',\s*zIndex:\s*10,)"
replacement = r"\1\2\n              WebkitAppearance: 'none',\n              appearance: 'none',"
text = re.sub(input_styles_regex, replacement, text)

# 2. Fix Sign In button zIndex
# Find the specific block for the sign in button.
signin_block_match = re.search(r"(<button[^>]*?title=\"Sign In\"[^>]*?>)", text)
if signin_block_match:
    old_btn = signin_block_match.group(1)
    new_btn = old_btn.replace("zIndex: 10", "zIndex: 12")
    text = text.replace(old_btn, new_btn)

with open('pages/commander/login.js', 'w') as f:
    f.write(text)
