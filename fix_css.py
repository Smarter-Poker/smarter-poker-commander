import re

with open('pages/commander/dashboard.js', 'r') as f:
    text = f.read()

# Replace className="cmd-card" with "cmd-dashboard-card"
text = re.sub(r'className="cmd-card"', 'className="cmd-dashboard-card"', text)

# Replace the embedded CSS rules
text = re.sub(r'\.cmd-card \{', '.cmd-dashboard-card {', text)
text = re.sub(r'\.cmd-card:hover \{', '.cmd-dashboard-card:hover {', text)
text = re.sub(r'\.cmd-card img \{', '.cmd-dashboard-card img {', text)

with open('pages/commander/dashboard.js', 'w') as f:
    f.write(text)
