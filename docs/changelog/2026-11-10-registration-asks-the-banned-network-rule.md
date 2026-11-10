# Registration asks the banned-network rule before it creates an account

Supabase Auth refuses signups from a banned network with its before-user-created hook. Every public signup path runs that hook. The admin `POST /admin/users` endpoint does not: GoTrue's `adminUserCreate` never calls it. Commander registration (`pages/api/create-subscription.js`, new-account path) creates its account through that admin endpoint, so a banned network could still create an account there with a new mailbox.

Before it calls `admin.createUser`, the new-account path now sends the address Vercel's edge sets (`x-real-ip`, else `x-vercel-forwarded-for`) to the same database rule, `fn_a_banned_network_cannot_create_an_account`. A refusal returns 403 and creates nothing. If the rule cannot be asked, the route returns 503 and creates nothing. A client-sent `x-forwarded-for` is never trusted for this check. The existing signed-in account path is unchanged. The email ban is a database trigger and already applied here.

Test: `tests/unit/signupNetwork.test.js`.
