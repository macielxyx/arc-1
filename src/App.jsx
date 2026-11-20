import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchRecords, refreshSeconds, usingMock } from './api.js';
import { enrich, summarize } from './analyze.js';

const DAY = 86400000;
const shortDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { const s = localStorage.getItem('theme'); if (s) return s; } catch {}
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch {}
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

function useMailbox() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [nextIn, setNextIn] = useState(refreshSeconds);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchRecords());
      setError(null);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e.message || 'Could not load data');
    } finally {
      setLoading(false);
      setNextIn(refreshSeconds);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden) return; // pause while tab is hidden
      setNextIn((n) => { if (n <= 1) { load(); return refreshSeconds; } return n - 1; });
    }, 1000);
    return () => clearInterval(t);
  }, [load]);

  return { data, loading, error, updatedAt, nextIn, reload: load };
}

function Kpi({ label, value, note, tone }) {
  return (
    <div className={`kpi ${tone || ''}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      <span className="kpi-note">{note}</span>
    </div>
  );
}

function HBars({ rows, tone, empty }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="empty">{empty}</p>;
  return (
    <ul className="hbars">
      {rows.map((r) => (
        <li key={r.label}>
          <span className="hb-label" title={r.label}>{r.label}</span>
          <div className="hb-track"><div className={`hb-fill ${tone}`} style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <b>{r.value}</b>
        </li>
      ))}
    </ul>
  );
}

function Employees({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.assigned));
  return (
    <ul className="hbars emp">
      {rows.map((r) => (
        <li key={r.name}>
          <span className="hb-label" title={r.name}>{r.name}</span>
          <div className="hb-track" title={`${r.completed} completed of ${r.assigned} assigned`}>
            <div className="hb-assigned" style={{ width: `${(r.assigned / max) * 100}%` }}>
              <div className="hb-fill good" style={{ width: `${r.assigned ? (r.completed / r.assigned) * 100 : 0}%` }} />
            </div>
          </div>
          <b>{r.completed}<small>/{r.assigned}</small></b>
        </li>
      ))}
    </ul>
  );
}

function Weekly({ weeks }) {
  const w = 640, h = 200, pad = { l: 34, r: 6, t: 10, b: 26 };
  if (!weeks.length) return <p className="empty">No emails in this range.</p>;
  const max = Math.max(1, ...weeks.map((x) => x.pending + x.completed));
  const step = (w - pad.l - pad.r) / weeks.length;
  const bw = Math.max(4, Math.min(26, step * 0.65));
  const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - v / max);
  const every = Math.ceil(weeks.length / 8);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart" role="img" aria-label="Emails received per week">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={pad.l} x2={w - pad.r} y1={y(max * f)} y2={y(max * f)} className="grid" />
          <text x={pad.l - 6} y={y(max * f) + 4} textAnchor="end" className="axis">{Math.round(max * f)}</text>
        </g>
      ))}
      {weeks.map((k, i) => {
        const x = pad.l + step * i + (step - bw) / 2;
        return (
          <g key={k.start}>
            <rect x={x} y={y(k.completed)} width={bw} height={h - pad.b - y(k.completed)} className="bar-collected" />
            <rect x={x} y={y(k.completed + k.pending)} width={bw} height={y(k.completed) - y(k.completed + k.pending)} rx="2" className="bar-pending" />
            {i % every === 0 && (
              <text x={x + bw / 2} y={h - 8} textAnchor="middle" className="axis">{shortDate(new Date(k.start).toISOString())}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const { data, loading, error, updatedAt, nextIn, reload } = useMailbox();
  const [owner, setOwner] = useState('all');
  const [range, setRange] = useState('all');

  const all = useMemo(() => enrich(data), [data]);
  const owners = useMemo(() => [...new Set(all.flatMap((e) => e.owners))].sort(), [all]);
  const filtered = useMemo(() => {
    const cutoff = range === 'all' ? 0 : Date.now() - Number(range) * DAY;
    return all.filter(
      (e) => new Date(e.received).getTime() >= cutoff && (owner === 'all' || e.owners.includes(owner))
    );
  }, [all, owner, range]);
  const s = useMemo(() => summarize(filtered), [filtered]);

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Billing mailbox</h1>
          <p className="sub">Requests since Jul 30, 2026{usingMock && <span className="chip">Sample data</span>}</p>
        </div>
        <div className="actions">
          <span className="status" aria-live="polite">
            {error ? <span className="err">Couldn’t refresh: {error}</span>
              : loading ? 'Refreshing…'
              : updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · next in ${nextIn}s` : ''}
          </span>
          <select className="select" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Filter by owner">
            <option value="all">All owners</option>
            {owners.map((o) => <option key={o}>{o}</option>)}
          </select>
          <select className="select" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Date range">
            <option value="all">All time</option>
            <option value="30">Last 30 days</option>
            <option value="7">Last 7 days</option>
          </select>
          <button className="btn" onClick={reload} disabled={loading}>Refresh now</button>
          <button className="btn icon" onClick={toggleTheme} aria-label="Toggle light and dark mode">{theme === 'dark' ? '☀' : '☾'}</button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-main">
          <span className="kpi-label">Waiting in the Inbox</span>
          <span className="hero-value">{s.pendingCount}</span>
          <span className="kpi-note">{s.vipPending} VIP · {s.awaitingPending} awaiting reply</span>
        </div>
        <div className="hero-aging">
          <span className="kpi-label">Completion rate</span>
          <div className="rate"><span>{s.rate}%</span>
            <div className="age-track"><div className="age-fill" style={{ width: `${s.rate}%` }} /></div>
          </div>
          <span className="kpi-note">{s.completedCount} filed out of {s.pendingCount + s.completedCount} requests</span>
        </div>
      </section>

      <section className="kpis">
        <Kpi label="Total requests" value={s.total} note="Unique emails" />
        <Kpi label="Filed / completed" value={s.completedCount} note="Moved out of the Inbox" tone="good" />
        <Kpi label="Deleted" value={s.deletedCount} note="Tracked separately" tone="warn" />
      </section>

      <section className="grid2 even">
        <div className="card">
          <div className="card-head"><h2>Assigned in Inbox, by request type</h2></div>
          <HBars rows={s.pendingByType} tone="warn" empty="Nothing waiting. The Inbox is clear." />
        </div>
        <div className="card">
          <div className="card-head"><h2>Completed and filed, by request type</h2></div>
          <HBars rows={s.completedByType} tone="good" empty="No filed requests in this range." />
        </div>
      </section>

      <section className="grid2">
        <div className="card">
          <div className="card-head">
            <h2>Requests received per week</h2>
            <div className="key"><i className="dot bar-collected-bg" />Filed<i className="dot bar-pending-bg" />In Inbox</div>
          </div>
          <Weekly weeks={s.weekly} />
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Owner workload</h2>
            <span className="key">completed / assigned</span>
          </div>
          <Employees rows={s.employees} />
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Oldest requests still in the Inbox</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Subject</th><th>Request type</th><th>Owner</th><th>Received</th><th className="num">Age</th></tr></thead>
            <tbody>
              {s.queue.slice(0, 15).map((e) => (
                <tr key={e.messageId || e.id}>
                  <td>{e.subject}{e.flags.map((f) => <span key={f} className="tag">{f}</span>)}</td>
                  <td>{e.types.join(', ')}</td>
                  <td>{e.owners.join(', ')}</td>
                  <td>{shortDate(e.received)}</td>
                  <td className="num">{Math.floor((Date.now() - new Date(e.received)) / DAY)}d</td>
                </tr>
              ))}
              {!s.queue.length && <tr><td colSpan="5" className="empty">No requests waiting in the Inbox.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
