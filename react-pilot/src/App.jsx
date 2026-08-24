import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { usePendingCases, isOverdue } from './useCases';
import CaseList from './CaseList.jsx';
import RaiseCase from './RaiseCase.jsx';

/* A pilot, not a port. One screen of the portal — the Nelos to-do — built
   the way the whole thing would be if it moved to React, so the cost and
   the benefit can be looked at rather than argued about. */
export default function App() {
  const [session, setSession] = useState(undefined);   // undefined = still asking
  const [tab, setTab] = useState('list');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div className="wrap"><p className="muted">Checking your session…</p></div>;
  if (session === null) return <SignedOut />;

  return (
    <div className="wrap">
      <header className="head">
        <div className="mark">NL</div>
        <div>
          <h1>Nelos To-Do</h1>
          <p className="muted">React pilot · signed in as {session.user.email}</p>
        </div>
        <button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>

      <nav className="tabs">
        <button className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>Pending</button>
        <button className={tab === 'new' ? 'on' : ''} onClick={() => setTab('new')}>Raise a case</button>
      </nav>

      {tab === 'list' ? <Pending /> : <RaiseCase onDone={() => setTab('list')} />}
    </div>
  );
}

function Pending() {
  const { rows, state, error } = usePendingCases();
  if (state === 'loading') return <p className="muted">Loading cases…</p>;
  if (state === 'error') return <p className="err">Could not read the case log — {error}</p>;

  const over = rows.filter(isOverdue);
  const rest = rows.filter(c => !isOverdue(c));
  return (
    <>
      <p className="muted count">{rows.length} pending · {over.length} overdue · updates live</p>
      <CaseList overdue={over} rest={rest} />
    </>
  );
}

function SignedOut() {
  return (
    <div className="wrap">
      <header className="head"><div className="mark">NL</div><div><h1>Nelos To-Do</h1>
        <p className="muted">React pilot</p></div></header>
      <p className="muted">
        Sign in on the portal first — this pilot shares the same Supabase session
        as the rest of the system, so signing in at <code>index.html</code> signs
        you in here too.
      </p>
    </div>
  );
}
