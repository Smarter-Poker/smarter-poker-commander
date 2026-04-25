# smarter-poker-commander

Commander — poker venue/club operator dashboard.

## Status: Phase 3.2 SCAFFOLD (2026-04-25)

Extracted from `Smarter-Poker-World-Hub` per Phase 3 of the optimization plan.

- **Hosting:** Vercel (new project)
- **URL:** smarter.poker/commander/* via Vercel rewrites (URL preserved)
- **Internal URL:** commander.smarter.poker
- **Auth:** Shared `.smarter.poker` Supabase cookie domain
- **Sentry:** Separate project (cleaner error dashboards)

## Migration status

### Completed
- 3.1 Design doc (locked at 9ebab0c2c in World Hub)
- 3.2 Repo scaffold (this commit)

### In flight
- 3.3 Shared code package
- 3.4 API slice migrations (started — see `pages/api/commander/`)
- 3.5 Frontend page migrations
- 3.6 Server-side PIN gate fix
- 3.7 Removal from World Hub

## Local dev

```bash
npm install
cp .env.example .env.local
# Populate Supabase keys
npm run dev   # listens on :3001
```

## Files moved from World Hub

See `MIGRATION_LEDGER.md` for the file-by-file ledger.
