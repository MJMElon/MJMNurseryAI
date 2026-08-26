import { useEffect, useState } from 'react';
import { supabase } from './supabase';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export default function RaiseCase({ onDone }) {
  const [cats, setCats] = useState([]);
  const [form, setForm] = useState({ title: '', category: '', priority: 'normal', due: '', desc: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [made, setMade] = useState(null);

  useEffect(() => {
    supabase.from('nelos_categories')
      .select('name,default_priority,default_days')
      .eq('active', true).order('sort_order')
      .then(({ data }) => setCats(data || []));
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function pickCategory(name) {
    const cat = cats.find(c => c.name === name);
    setForm(f => {
      const next = { ...f, category: name };
      if (cat?.default_priority) next.priority = cat.default_priority;
      if (cat?.default_days != null && !f.due) {
        const d = new Date();
        d.setDate(d.getDate() + Number(cat.default_days));
        next.due = d.toISOString().slice(0, 10);
      }
      return next;
    });
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.title.trim()) { setErr('A case needs a title.'); return; }
    setBusy(true); setErr('');

    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('nelos_cases').insert([{
      title: form.title.trim().slice(0, 300),
      description: form.desc.trim() || null,
      category: form.category || null,
      priority: form.priority,
      status: 'open',
      source_module: 'nelos',
      source_ref: '../react-pilot/app/index.html',
      due_date: form.due || null,
      raised_by: user?.user_metadata?.full_name || user?.email || null,
      raised_by_id: user?.id || null
    }]).select().single();

    setBusy(false);
    if (error) { setErr('Could not raise it — ' + error.message); return; }
    if (form.desc.trim()) {
      supabase.from('nelos_case_comments').insert([{
        case_id: data.id, body: form.desc.trim(), kind: 'comment',
        author_name: user?.user_metadata?.full_name || user?.email || null, author_id: user?.id || null
      }]).then(() => {}, () => {});
    }
    setMade(data);
  }

  if (made) return (
    <div className="done">
      <p className="done-t">✓ {made.case_no} raised</p>
      <p className="muted">{made.title}</p>
      <button className="primary" onClick={onDone}>Back to the list</button>
    </div>
  );

  return (
    <form className="form" onSubmit={submit}>
      {err && <p className="err">{err}</p>}
      <label>What needs doing?
        <input value={form.title} autoFocus maxLength={300}
               onChange={e => { set('title', e.target.value); if (e.target.value.trim()) setErr(''); }}
               placeholder="One line — what is wrong" />
      </label>
      <div className="two">
        <label>Category
          <select value={form.category} onChange={e => pickCategory(e.target.value)}>
            <option value="">— none —</option>
            {cats.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </label>
        <label>Due
          <input type="date" value={form.due} onChange={e => set('due', e.target.value)} />
        </label>
      </div>
      <span className="lbl">Priority</span>
      <div className="pri">
        {PRIORITIES.map(p => (
          <button key={p} type="button" className={form.priority === p ? 'on ' + p : ''}
                  onClick={() => set('priority', p)}>{p}</button>
        ))}
      </div>
      <label>Detail <span className="opt">(optional)</span>
        <textarea rows={3} value={form.desc} onChange={e => set('desc', e.target.value)}
                  placeholder="Anything the person picking this up will need" />
      </label>
      <div className="acts">
        <button type="button" className="ghost" onClick={onDone}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Raising…' : 'Raise case'}</button>
      </div>
    </form>
  );
}
