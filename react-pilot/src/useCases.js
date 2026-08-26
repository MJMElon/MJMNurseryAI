import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };
const PENDING = ['open', 'in_progress'];

const BASE_COLS = 'id,case_no,title,category,priority,status,source_module,' +
                  'nursery_name,plot_name,batch_name,assignee_id,assignee_name,due_date,created_at';

/* One hook, and every screen that wants pending cases uses it. The point of
   the pilot: in the static pages this same logic is copied into four
   dashboards and the dock, and they have already drifted apart twice. */
export function usePendingCases() {
  const [rows, setRows] = useState([]);
  const [state, setState] = useState('loading');   // loading | ready | error
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('nelos_cases')
      .select(BASE_COLS)
      .in('status', PENDING)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(60);

    if (error) { setError(error.message); setState('error'); return; }
    setRows([...(data || [])].sort(
      (a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)));
    setState('ready');
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Live: Postgres pushes the change down the socket, and every open screen
     re-renders. The static pages poll on a 90-second timer instead, which is
     the one thing this stack does that the current one genuinely cannot. */
  useEffect(() => {
    const ch = supabase
      .channel('nelos-pending')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'nelos_cases' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  return { rows, state, error, reload: load };
}

export const isOverdue = c => !!c.due_date && c.due_date < new Date().toISOString().slice(0, 10);
