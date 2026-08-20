import re

with open('pages/commander/dashboard.js', 'r') as f:
    text = f.read()

# Replace .jpg or .jpg?v=... with .webp for these specific cards
text = re.sub(r'/images/commander/card-waitlist\.jpg(\?v=\d+)?', '/images/commander/card-waitlist.webp', text)
text = re.sub(r'/images/commander/card-tournaments\.jpg(\?v=\d+)?', '/images/commander/card-tournaments.webp', text)
text = re.sub(r'/images/commander/card-floor\.jpg(\?v=\d+)?', '/images/commander/card-floor.webp', text)
text = re.sub(r'/images/commander/card-staff\.jpg(\?v=\d+)?', '/images/commander/card-staff.webp', text)
text = re.sub(r'/images/commander/card-displays\.jpg(\?v=\d+)?', '/images/commander/card-displays.webp', text)
text = re.sub(r'/images/commander/card-reports\.jpg(\?v=\d+)?', '/images/commander/card-reports.webp', text)

with open('pages/commander/dashboard.js', 'w') as f:
    f.write(text)
