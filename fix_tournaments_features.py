import re

with open('pages/commander/dashboard.js', 'r') as f:
    text = f.read()

new_features = """    features: [
      { label: 'Tournament Manager', href: '/commander/tournaments', icon: '/images/commander/icons/tn-registration.png' },
      { label: 'Tournament Templates', href: '/commander/tournament-settings', icon: '/images/commander/icons/tn-settings.png?v=3' },
      { label: 'Tournament Clock', href: '/commander/tournament-clocks', icon: '/images/commander/icons/tn-clock.png' },
      { label: 'Leagues', href: '/commander/leagues', icon: '/images/commander/icons/tn-leagues-freerolls.png?v=2' },
      { label: 'Clock Setup', href: '/commander/clock-setup', icon: '/images/commander/icons/tn-clock-setup.png' },
      { label: 'Free Rolls', href: '/commander/leagues', icon: '/images/commander/icons/tn-freerolls.webp' },
      { label: 'Tournament Controls', href: '/commander/tournament-maintenance', icon: '/images/commander/icons/tn-controls-new.webp' },
      { label: 'Tournament Director', href: '/commander/tournament-controls', icon: '/images/commander/icons/tn-director.webp' },
    ] },"""

# Find the tournaments features array and replace it
text = re.sub(
    r"id: 'tournaments'.*?features: \[.*?\] \},",
    f"id: 'tournaments',\n    title: 'Tournaments & Events',\n    subtitle: 'Tournaments, Leagues & Free Rolls, Clock',\n    image: '/images/commander/card-tournaments.webp',\n    glow: '#F59E0B',\n{new_features}",
    text,
    flags=re.DOTALL
)

with open('pages/commander/dashboard.js', 'w') as f:
    f.write(text)
