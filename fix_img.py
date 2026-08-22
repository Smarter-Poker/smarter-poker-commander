import re

with open('pages/commander/dashboard.js', 'r') as f:
    text = f.read()

# Replace img CSS
text = re.sub(
    r'\.cmd-card img \{.*?\}',
    '.cmd-card img {\n          width: 100%;\n          height: auto;\n          display: block;\n        }',
    text,
    flags=re.DOTALL
)

# Replace .cmd-card-overlay (since we removed the div, we don't need the CSS)
text = re.sub(
    r'\.cmd-card-overlay \{.*?\}',
    '',
    text,
    flags=re.DOTALL
)

# Give .cmd-card:hover a slight brightness filter instead of a box-shadow or border
text = re.sub(
    r'\.cmd-card:hover \{.*?\}',
    '.cmd-card:hover {\n          transform: scale(1.02);\n          filter: brightness(1.15);\n        }',
    text,
    flags=re.DOTALL
)

with open('pages/commander/dashboard.js', 'w') as f:
    f.write(text)
