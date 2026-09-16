# smarter-poker-commander

Commander — poker venue/club operator dashboard.

## Status: LIVE. Agent instructions: `CLAUDE.md` (read `AGENT-PLAYBOOK.md` first)

Extracted from `Smarter-Poker-World-Hub` per Phase 3 of the optimization plan.

- **Hosting:** Vercel (new project)
- **URL:** smarter.poker/commander/* via Vercel rewrites (URL preserved)
- **Internal URL:** commander.smarter.poker
- **Auth:** Supabase session in localStorage (`smarter-poker-auth`) on each origin, bridged hub -> commander by a one-time SSO token; derived HMAC-signed staff session for Commander APIs. See `CLAUDE.md` section 3 and `docs/runbooks/login-bridge.md`. (A shared cookie session is designed, not built: `docs/runbooks/cross-subdomain-session.md`.)
- **Error diagnostics:** local browser/server logs and existing venue health metrics.

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
