with open('pages/commander/login.js', 'r') as f:
    text = f.read()

text = text.replace(
    'href="#"',
    'href="#"\n            onClick={(e) => { e.preventDefault(); setError("Password recovery coming soon."); }}'
)

with open('pages/commander/login.js', 'w') as f:
    f.write(text)
