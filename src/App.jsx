import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchRecords, refreshSeconds, usingMock } from './api.js';
import { enrich, summarize } from './analyze.js';

const DAY = 86400000;
const fmtDate = (v) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const logoSrc = `${import.meta.env.BASE_URL}CCS-SQ.png`;

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
    try { setData(await fetchRecords()); setError(null); setUpdatedAt(new Date()); }
    catch (e) { setError(e.message || 'Could not load data'); }
    finally { setLoading(false); setNextIn(refreshSeconds); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden) return;
      setNextIn((n) => { if (n <= 1) { load(); return refreshSeconds; } return n - 1; });
    }, 1000);
    return () => clearInterval(t);
  }, [load]);
  return { data, loading, error, updatedAt, nextIn, reload: load };
}

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver((e) => setW(Math.floor(e[0].contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function Panel({ title, meta, className = '', children, bare }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head"><h2>{title}</h2>{meta && <div className="panel-meta">{meta}</div>}</div>
      <div className={bare ? '' : 'panel-body'}>{children}</div>
    </section>
  );
}

function Seg({ value, onChange, options }) {
  return (
    <div className="seg" role="group">
      {options.map(([v, l]) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

function Spark({ values }) {
  if (values.length < 2) return null;
  const w = 100, h = 28, max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - (v / max) * (h - 4)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="spark" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} />
    </svg>
  );
}

function Kpi({ label, value, note, tone, spark }) {
  return (
    <div className={`kpi ${tone || ''}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      <span className="kpi-note">{note}</span>
      {spark && <Spark values={spark} />}
    </div>
  );
}

function Trend({ points, avgWindow, avgLabel }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const h = 320, pad = { l: 40, r: 12, t: 12, b: 28 };
  const w = Math.max(280, width);
  const n = points.length;
  if (!n) return <p className="empty">No emails in this range.</p>;
  const raw = Math.max(1, ...points.map((p) => p.pending + p.completed));
  const max = Math.max(4, Math.ceil((raw * 1.1) / 4) * 4);
  const step = (w - pad.l - pad.r) / n;
  const bw = Math.max(1, step * 0.74);
  const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - v / max);
  const avg = points.map((_, i) => {
    const s = points.slice(Math.max(0, i - avgWindow + 1), i + 1);
    return s.reduce((a, p) => a + p.pending + p.completed, 0) / s.length;
  });
  const line = avg.map((v, i) => `${i ? 'L' : 'M'}${(pad.l + step * i + step / 2).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 90))));
  const hp = hover != null ? points[hover] : null;
  const hx = hover != null ? pad.l + step * hover + step / 2 : 0;
  return (
    <div className="trend-wrap" ref={ref}>
      <svg width={w} height={h} className="chart" role="img" aria-label="Requests received over time"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.floor((e.clientX - r.left - pad.l) / step);
          setHover(i >= 0 && i < n ? i : null);
        }}
        onMouseLeave={() => setHover(null)}>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y((max * i) / 4)} y2={y((max * i) / 4)} className="grid" />
            <text x={pad.l - 8} y={y((max * i) / 4) + 4} textAnchor="end" className="axis">{(max * i) / 4}</text>
          </g>
        ))}
        {hp && <rect x={pad.l + step * hover} y={pad.t} width={step} height={h - pad.t - pad.b} className="hover-band" />}
        {points.map((p, i) => {
          const x = pad.l + step * i + (step - bw) / 2;
          return (
            <g key={p.start}>
              <rect x={x} y={y(p.completed)} width={bw} height={Math.max(0, h - pad.b - y(p.completed))} className="b-done" />
              <rect x={x} y={y(p.completed + p.pending)} width={bw} height={Math.max(0, y(p.completed) - y(p.completed + p.pending))} className="b-pend" />
              {i % every === 0 && <text x={x + bw / 2} y={h - 9} textAnchor="middle" className="axis">{fmtDate(p.start)}</text>}
            </g>
          );
        })}
        <path d={line} className="avg-line" />
      </svg>
      {hp && (
        <div className="tip" style={{ left: hx > w / 2 ? undefined : hx + 12, right: hx > w / 2 ? w - hx + 12 : undefined }}>
          <b>{fmtDate(hp.start)}</b>
          <span><i className="sq done" />Filed <em>{hp.completed}</em></span>
          <span><i className="sq pend" />In Inbox <em>{hp.pending}</em></span>
          <span><i className="ln" />{avgLabel} <em>{avg[hover].toFixed(1)}</em></span>
        </div>
      )}
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
    <ul className="hbars">
      {rows.map((r) => (
        <li key={r.name}>
          <span className="hb-label" title={r.name}>{r.name}</span>
          <div className="hb-track" title={`${r.completed} filed of ${r.assigned} assigned`}>
            <div className="hb-assigned" style={{ width: `${(r.assigned / max) * 100}%` }}>
              <div className="hb-fill done" style={{ width: `${r.assigned ? (r.completed / r.assigned) * 100 : 0}%` }} />
            </div>
          </div>
          <b>{r.completed}<small> / {r.assigned}</small></b>
        </li>
      ))}
    </ul>
  );
}

function Donut({ parts }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const r = 50, c = 2 * Math.PI * r;
  let off = 0;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 140 140" className="donut" role="img" aria-label="Requests by status">
        <circle cx="70" cy="70" r={r} className="d-track" />
        {parts.map((p) => {
          const len = (p.value / total) * c;
          const el = <circle key={p.key} cx="70" cy="70" r={r} className={`d-seg ${p.key}`}
            strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`} strokeDashoffset={-off} transform="rotate(-90 70 70)" />;
          off += len;
          return el;
        })}
        <text x="70" y="69" textAnchor="middle" className="d-n">{total}</text>
        <text x="70" y="86" textAnchor="middle" className="axis">requests</text>
      </svg>
      <ul className="legend">
        {parts.map((p) => (
          <li key={p.key}><i className={`sq ${p.key}`} />{p.label}<b>{p.value}</b><small>{Math.round((p.value / total) * 100)}%</small></li>
        ))}
      </ul>
    </div>
  );
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const { data, loading, error, updatedAt, nextIn, reload } = useMailbox();
  const [owner, setOwner] = useState('all');
  const [range, setRange] = useState('all');
  const [grain, setGrain] = useState('daily');
  const [q, setQ] = useState('');
  const [logoOk, setLogoOk] = useState(true);

  const all = useMemo(() => enrich(data), [data]);
  const owners = useMemo(() => [...new Set(all.flatMap((e) => e.owners))].sort(), [all]);
  const filtered = useMemo(() => {
    const cutoff = range === 'all' ? 0 : Date.now() - Number(range) * DAY;
    return all.filter((e) => new Date(e.received).getTime() >= cutoff && (owner === 'all' || e.owners.includes(owner)));
  }, [all, owner, range]);
  const s = useMemo(() => summarize(filtered), [filtered]);

  const delta = s.prev7 ? Math.round(((s.last7 - s.prev7) / s.prev7) * 100) : null;
  const queue = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? s.queue.filter((e) => [e.subject, e.owners.join(' '), e.types.join(' ')].join(' ').toLowerCase().includes(t)) : s.queue;
  }, [s.queue, q]);

  const trendPoints = grain === 'daily' ? s.daily : s.weekly;

  return (
    <div className="shell">
      <header className="hdr">
        <div className="hdr-logo">
          {logoOk
            ? <img src={logoSrc} alt="CCS" onError={() => setLogoOk(false)} />
            : <span className="logo-fallback">CCS</span>}
        </div>
        <div className="hdr-main">
          <div className="hdr-title">
            <h1>CCS Billing Dashboard</h1>
            <span>Shared billing mailbox · requests since Jul 30, 2026{usingMock && <em className="chip">Sample data</em>}</span>
          </div>
          <div className="hdr-actions">
            <label className="field"><span>Owner</span>
              <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="all">All owners</option>
                {owners.map((o) => <option key={o}>{o}</option>)}
              </select>
            </label>
            <label className="field"><span>Period</span>
              <select value={range} onChange={(e) => setRange(e.target.value)}>
                <option value="all">All time</option>
                <option value="30">Last 30 days</option>
                <option value="7">Last 7 days</option>
              </select>
            </label>
            <span className="status" aria-live="polite">
              {error ? `Refresh failed: ${error}`
                : loading ? 'Refreshing…'
                : updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · next in ${nextIn}s` : ''}
            </span>
            <button className="hbtn" onClick={reload} disabled={loading}>Refresh</button>
            <button className="hbtn sq-btn" onClick={toggleTheme} aria-label="Switch light or dark theme" title="Switch theme">
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        <div className="kpis">
          <Kpi label="Total requests" value={s.total} spark={s.daily.slice(-30).map((d) => d.pending + d.completed)}
            note={delta == null ? `${s.last7} in last 7 days` : `${s.last7} in last 7 days (${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}%)`} />
          <Kpi label="In Inbox" value={s.pendingCount} tone="pend" note={`Avg wait ${s.avgAge.toFixed(1)} days`} />
          <Kpi label="Filed / completed" value={s.completedCount} tone="done" note="Moved out of the Inbox" />
          <Kpi label="Completion rate" value={`${s.rate}%`} tone="done" note="Filed ÷ (filed + in Inbox)" />
          <Kpi label="VIP in Inbox" value={s.vipPending} tone={s.vipPending ? 'bad' : ''} note="Needs priority" />
          <Kpi label="Awaiting reply" value={s.awaitingPending} note="Flagged, still in Inbox" />
          <Kpi label="Deleted" value={s.deletedCount} note="Tracked separately" />
        </div>

        <div className="grid">
          <Panel className="trend" title="Requests received"
            meta={<>
              <span className="key"><i className="sq done" />Filed<i className="sq pend" />In Inbox<i className="ln" />{grain === 'daily' ? '7-day avg' : '4-week avg'}</span>
              <Seg value={grain} onChange={setGrain} options={[['daily', 'Daily'], ['weekly', 'Weekly']]} />
            </>}>
            <Trend points={trendPoints} avgWindow={grain === 'daily' ? 7 : 4} avgLabel={grain === 'daily' ? '7-day avg' : '4-week avg'} />
          </Panel>

          <Panel className="side" title="Status mix">
            <Donut parts={[
              { key: 'done', label: 'Filed', value: s.completedCount },
              { key: 'pend', label: 'In Inbox', value: s.pendingCount },
              { key: 'del', label: 'Deleted', value: s.deletedCount },
            ]} />
          </Panel>

          <Panel className="side" title="Inbox backlog by age" meta="Requests still in Inbox">
            <HBars rows={s.ageBuckets} tone="pend" empty="Inbox is clear." />
          </Panel>

          <Panel className="third" title="In Inbox by request type" meta={`${s.pendingCount} requests`}>
            <HBars rows={s.pendingByType} tone="pend" empty="Nothing waiting. The Inbox is clear." />
          </Panel>
          <Panel className="third" title="Filed by request type" meta={`${s.completedCount} requests`}>
            <HBars rows={s.completedByType} tone="done" empty="No filed requests in this range." />
          </Panel>
          <Panel className="third last" title="Owner workload" meta="Filed / assigned">
            <Employees rows={s.employees} />
          </Panel>

          <Panel className="full" bare title="Oldest requests still in the Inbox"
            meta={<input className="search" placeholder="Search subject, owner, type" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search queue" />}>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Subject</th><th>Request type</th><th>Owner</th><th>Folder</th><th>Received</th><th className="num">Age</th></tr></thead>
                <tbody>
                  {queue.slice(0, 25).map((e) => {
                    const age = Math.floor((Date.now() - new Date(e.received)) / DAY);
                    return (
                      <tr key={e.messageId || e.id}>
                        <td>{e.subject}{e.flags.map((f) => <span key={f} className="tag">{f}</span>)}</td>
                        <td>{e.types.join(', ')}</td>
                        <td>{e.owners.join(', ')}</td>
                        <td>{e.folder}</td>
                        <td>{fmtDate(e.received)}</td>
                        <td className={`num ${age > 14 ? 'age-bad' : age > 7 ? 'age-warn' : ''}`}>{age}d</td>
                      </tr>
                    );
                  })}
                  {!queue.length && <tr><td colSpan="6" className="empty">No requests waiting in the Inbox.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="foot">Showing {Math.min(queue.length, 25)} of {queue.length}</p>
          </Panel>
        </div>
      </main>
    </div>
  );
}
