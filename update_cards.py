import re

with open('pages/commander/dashboard.js', 'r') as f:
    text = f.read()

# Remove the text overlay HTML completely
text = re.sub(
    r'<div className="cmd-card-overlay" />\s*<div style={{.*?}}>.*?</div>\s*</div>',
    '',
    text,
    flags=re.DOTALL
)

# Replace .cmd-card CSS to just be a container for the image
# old:
# .cmd-card {
#   position: relative;
#   border-radius: 16px;
#   overflow: hidden;
#   cursor: pointer;
#   transition: transform 0.2s, box-shadow 0.3s;
#   border: 3px solid #3A3B3C;
#   background: #0a0a0a;
#   padding: 6px;
# }
text = re.sub(
    r'\.cmd-card \{.*?padding: 6px;\s*\}',
    '.cmd-card {\n  position: relative;\n  cursor: pointer;\n  transition: transform 0.2s, filter 0.3s;\n}',
    text,
    flags=re.DOTALL
)

# old hover:
# .cmd-card:hover {
#   transform: translateY(-2px);
#   border-color: #E4E6EB;
# }
text = re.sub(
    r'\.cmd-card:hover \{.*?border-color: #E4E6EB;\s*\}',
    '.cmd-card:hover {\n  transform: translateY(-2px);\n  filter: brightness(1.1);\n}',
    text,
    flags=re.DOTALL
)

# old img:
# .cmd-card img {
#   width: 100%;
#   height: 100%;
#   object-fit: fill;
#   display: block;
#   border-radius: 10px;
# }
text = re.sub(
    r'\.cmd-card img \{.*?border-radius: 10px;\s*\}',
    '.cmd-card img {\n  width: 100%;\n  height: auto;\n  display: block;\n}',
    text,
    flags=re.DOTALL
)

# Remove the inline style in <div className="cmd-card">
text = re.sub(
    r'className="cmd-card"\s*style={{.*?}}\s*onClick',
    'className="cmd-card"\n                  onClick',
    text,
    flags=re.DOTALL
)

with open('pages/commander/dashboard.js', 'w') as f:
    f.write(text)
