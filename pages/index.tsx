/**
 * Commander root page.
 *
 * In production, this is reached via the rewrite at smarter.poker/commander
 * (which proxies to commander.smarter.poker/). Direct hits land here.
 */
export default function CommanderRoot() {
  return (
    <main style={{padding: 24, fontFamily: 'system-ui, sans-serif'}}>
      <h1>Smarter.Poker Commander</h1>
      <p>Venue + club operator dashboard.</p>
      <p>Status: scaffolded, migration in progress.</p>
    </main>
  );
}
