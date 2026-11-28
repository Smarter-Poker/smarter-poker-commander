// Fixture for tests/unit/titleCase.law.test.js: each string sits in a
// position the scanner must classify. Not imported by the app.
import Head from 'next/head';

export default function Sample({ games, setError, toast, supabase }) {
  const pick = games.filter((g) => g.type === 'Cash game');
  console.log('Loaded the tables', pick.length);
  supabase.from('comp_transactions').insert({ reason: 'Manual adjustment' });
  const status = { key: 'Seat available' };
  const save = () => { setError('Failed to save'); toast.error('Player name required'); };
  if (!window.confirm('Delete this table?')) return null;
  switch (status.key) { case 'Tournament day': break; default: break; }
  return (
    <div>
      <Head><meta name="description" content="Staff page for venues" /></Head>
      <input placeholder="Search players by name" />
      <button aria-label="Close menu" onClick={save}>Seat player</button>
      <p>No tables yet</p>
      <span>{`Total buy-ins`}</span>
    </div>
  );
}
