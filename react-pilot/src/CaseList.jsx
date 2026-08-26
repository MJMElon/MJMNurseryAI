const SOURCE_LABEL = {
  operation: 'Seedling Stock System', nursery_ops: 'Nursery Operation',
  scan: 'FC Portal', mobile: 'Admin Portal', audit: 'Audit Portal',
  npayroll: 'Payroll', nelos: 'Nelos'
};

const due = d => {
  if (!d) return null;
  const label = new Date(d + 'T00:00:00').toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
  return d < new Date().toISOString().slice(0, 10)
    ? <span className="over">⏰ overdue {label}</span>
    : <span>due {label}</span>;
};

/* React escapes every interpolation by default. The equivalent innerHTML
   template in the static pages has to remember esc() on each field, and
   twice it did not — see operation_inventory_all.html in today's commit. */
function Row({ c }) {
  const subject = [c.batch_name && 'Batch ' + c.batch_name, c.plot_name, c.nursery_name]
    .filter(Boolean).join(' · ');
  return (
    <a className={'row' + (c.due_date && c.due_date < new Date().toISOString().slice(0, 10) ? ' row-over' : '')}
       href={`../../nelos/nelos_case.html?id=${encodeURIComponent(c.id)}`}>
      <span className={'dot p-' + (c.priority || 'normal')} title={c.priority} />
      <span className="main">
        <span className="title">{c.title}</span>
        <span className="meta">
          <span className="chip">{SOURCE_LABEL[c.source_module] || c.source_module}</span>
          {[c.case_no, subject, c.assignee_name ? '→ ' + c.assignee_name : 'unassigned']
            .filter(Boolean).join(' · ')} {due(c.due_date)}
        </span>
      </span>
    </a>
  );
}

export default function CaseList({ overdue, rest }) {
  if (!overdue.length && !rest.length) return <p className="muted">Nothing pending ✓</p>;
  return (
    <div className="list">
      {overdue.length > 0 && <div className="sec sec-over">⏰ Overdue · {overdue.length}</div>}
      {overdue.map(c => <Row key={c.id} c={c} />)}
      {overdue.length > 0 && rest.length > 0 && <div className="sec">Still on time · {rest.length}</div>}
      {rest.map(c => <Row key={c.id} c={c} />)}
    </div>
  );
}
