import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from './theme.js';
import { Clock, FolderCheck, Inbox, Lock, Mails, Percent, Star, Trash2 } from 'lucide-react';
import { enrich, summarize } from './analyze.js';
import { AVAILABLE_YEARS, FLAGS, MAILBOXES, REQUEST_TYPES } from './config.js';
import release from './version.json';

const DAY = 86400000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PALETTE = ['#4c8dff', '#2fbf9f', '#f0b429', '#f07178', '#a78bfa', '#5ecf7a', '#38bdf8', '#f472b6', '#fb923c', '#818cf8'];
const VIEWS = [
  { id: 'filed', label: 'Filed', hint: 'How many requests each owner filed' },
  { id: 'performance', label: 'Performance', hint: 'Completion and how fast open work is moving', locked: true },
  { id: 'backlog', label: 'Backlog', hint: 'Requests still sitting in the Inbox', locked: true },
];
const VIEW_GATE = '06361705019eaaa56a37cc02658ec43bd1c2662c6a876774b3510440779c3a73';

async function hashText(value) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const fmtDate = (v) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const logoSrc = `${import.meta.env.BASE_URL}CCS-SQ.png`;

function initialMonth() {
  const now = new Date();
  return now.getFullYear() === AVAILABLE_YEARS[0] ? now.getMonth() : 11;
}

function sameMonth(iso, year, month) {
  const d = new Date(iso);
  return d.getFullYear() === year && d.getMonth() === month;
}

function niceMax(v) {
  const value = Math.max(1, v);
  const mag = 10 ** Math.floor(Math.log10(value));
  const stops = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 9, 10];
  return stops.map((s) => s * mag).find((n) => n >= value - 1e-9) ?? value;
}

function axisTicks(max) {
  const mag = 10 ** Math.floor(Math.log10(Math.max(max, 1)));
  const steps = [1, 2, 2.5, 5].flatMap((b) => [b * mag, b * mag / 10, b * mag / 100]).filter((s) => s > 0);
  const fits = steps.filter((s) => {
    const n = max / s;
    return n >= 1 && n <= 8 && Math.abs(n - Math.round(n)) < 1e-6;
  });
  fits.sort((a, b) => {
    const score = (s) => Math.abs(max / s - 4) + (Number.isInteger(s) ? 0 : 2);
    return score(a) - score(b);
  });
  const step = fits[0];
  if (!step) return [0, 1, 2, 3, 4].map((i) => (max * i) / 4);
  const n = Math.round(max / step);
  return Array.from({ length: n + 1 }, (_, i) => step * i);
}

function useMailbox(records, boxId) {
  return { data: records?.[boxId] ?? [], loading: !records };
}

function useWidth() {
  const [node, setNode] = useState(null);
  const [w, setW] = useState(720);
  const ref = useCallback((el) => setNode((prev) => (prev === el ? prev : el)), []);
  useEffect(() => {
    if (!node) return undefined;
    const measure = () => {
      const next = Math.floor(node.getBoundingClientRect().width);
      if (next > 0) setW(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);
  return [ref, w];
}

function scoreOf(filed, pending, ageSum, ageN) {
  const active = filed + pending;
  if (!active) return 0;
  const completion = filed / active;
  const avgAge = ageN ? ageSum / ageN : 0;
  const speed = pending === 0 ? 1 : Math.max(0, 1 - Math.min(avgAge, 21) / 21);
  return Math.round(completion * 70 + speed * 30);
}

function keptIndexes(scope, hiddenMonths, len) {
  if (scope !== 'year' || !hiddenMonths.length) return null;
  const hidden = new Set(hiddenMonths);
  return Array.from({ length: len }, (_, i) => i).filter((i) => !hidden.has(i));
}

function compactSeries(labels, series, keep) {
  if (!keep) return { labels, series };
  return {
    labels: keep.map((i) => labels[i]),
    series: series.map((s) => ({ ...s, values: keep.map((i) => s.values[i]) })),
  };
}

function trendSeries(emails, colorOf, scope, year, month, view, selectedOwners = [], hiddenOwners = [], hiddenMonths = []) {
  const labels = scope === 'year'
    ? MONTHS.map((name) => ({ label: name.slice(0, 3), full: name }))
    : Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, i) => ({
      label: String(i + 1),
      full: `${MONTHS[month].slice(0, 3)} ${i + 1}`,
    }));
  const len = labels.length;
  const keep = keptIndexes(scope, hiddenMonths, len);
  const bucketOf = (iso) => {
    const d = new Date(iso);
    return scope === 'year' ? d.getMonth() : d.getDate() - 1;
  };
  const allowed = new Set(selectedOwners);
  const hidden = new Set(hiddenOwners);
  const names = [...new Set(emails.flatMap((e) => (e.status === 'deleted' ? [] : e.owners)))]
    .filter((name) => !hidden.has(name) && (!allowed.size || allowed.has(name)))
    .sort();
  if (!names.length) return compactSeries(labels, [], keep);

  if (view === 'performance') {
    const acc = new Map(names.map((n) => [n, { filed: 0, pending: 0, ageSum: 0, ageN: 0 }]));
    const byBucket = Array.from({ length: len }, () => []);
    emails.forEach((e) => {
      if (e.status === 'deleted') return;
      const b = bucketOf(e.received);
      if (b >= 0 && b < len) byBucket[b].push(e);
    });
    const values = new Map(names.map((n) => [n, []]));
    for (let i = 0; i < len; i += 1) {
      byBucket[i].forEach((e) => {
        e.owners.forEach((name) => {
          const a = acc.get(name);
          if (!a) return;
          if (e.status === 'completed') a.filed += 1;
          if (e.status === 'pending') {
            a.pending += 1;
            a.ageSum += Math.max(0, (Date.now() - new Date(e.received).getTime()) / DAY);
            a.ageN += 1;
          }
        });
      });
      names.forEach((name) => {
        const a = acc.get(name);
        values.get(name).push(scoreOf(a.filed, a.pending, a.ageSum, a.ageN));
      });
    }
    return compactSeries(labels, names
      .filter((name) => acc.get(name).filed + acc.get(name).pending > 0)
      .map((name) => ({ name, color: colorOf.get(name) || PALETTE[0], values: values.get(name) })), keep);
  }

  const inc = new Map(names.map((n) => [n, Array(len).fill(0)]));
  emails.forEach((e) => {
    if (view === 'filed' && e.status !== 'completed') return;
    if (view === 'backlog' && e.status !== 'pending') return;
    const b = bucketOf(e.received);
    if (b < 0 || b >= len) return;
    e.owners.forEach((name) => { if (inc.has(name)) inc.get(name)[b] += 1; });
  });
  return compactSeries(labels, names.map((name) => {
    let run = 0;
    const values = inc.get(name).map((v) => { run += v; return run; });
    return { name, color: colorOf.get(name) || PALETTE[0], values, total: run };
  }).filter((s) => s.total > 0), keep);
}

function ownerStats(emails, colorOf, selectedOwners = [], hiddenOwners = []) {
  const allowed = new Set(selectedOwners);
  const hidden = new Set(hiddenOwners);
  const map = new Map();
  emails.forEach((e) => {
    if (e.status === 'deleted') return;
    e.owners.forEach((name) => {
      if (hidden.has(name) || (allowed.size && !allowed.has(name))) return;
      const row = map.get(name) || { name, filed: 0, pending: 0, ageSum: 0, ageN: 0, color: colorOf.get(name) || PALETTE[0] };
      if (e.status === 'completed') row.filed += 1;
      if (e.status === 'pending') {
        row.pending += 1;
        row.ageSum += Math.max(0, (Date.now() - new Date(e.received).getTime()) / DAY);
        row.ageN += 1;
      }
      map.set(name, row);
    });
  });
  return [...map.values()].map((r) => {
    const active = r.filed + r.pending;
    const completion = active ? r.filed / active : 0;
    const avgAge = r.ageN ? r.ageSum / r.ageN : 0;
    const speed = r.pending === 0 ? (r.filed ? 1 : 0) : Math.max(0, 1 - Math.min(avgAge, 21) / 21);
    const score = active ? Math.round(completion * 70 + speed * 30) : 0;
    return { ...r, completion, avgAge, score };
  });
}

function IconSun() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v1.5M12 19.5V21M4.9 4.9l1.1 1.1M18 18l1.1 1.1M3 12h1.5M19.5 12H21M4.9 19.1 6 18M18 6l1.1-1.1" />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z" />
    </svg>
  );
}

function ThemeSwitch({ theme, onToggle }) {
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={dark}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={onToggle}
    >
      <span className="switch-side sun"><IconSun /></span>
      <span className="switch-side moon"><IconMoon /></span>
      <span className="switch-thumb">{dark ? <IconMoon /> : <IconSun />}</span>
    </button>
  );
}

function formatStamp(iso) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function History({ release: current }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const entries = [...(current.history || [])].reverse();

  return (
    <div className="history" ref={ref}>
      <button type="button" className={`history-btn ${open ? 'on' : ''}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4.2l2.6 1.6" />
        </svg>
        {current.version}
      </button>
      {open && (
        <div className="history-pop" role="dialog" aria-label="Version history">
          <div className="history-head">
            <b>Version history</b>
            <span>Last updated {formatStamp(current.updated)}</span>
          </div>
          <ul>
            {entries.map((entry) => (
              <li key={entry.version} className={entry.version === current.version ? 'on' : ''}>
                <span>
                  <strong>{entry.version}</strong>
                  {entry.version === current.version && <em>Current</em>}
                </span>
                <small>{formatStamp(entry.updated)}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Panel({ title, meta, extra, className = '', children, bare }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {meta && <div className="panel-meta">{meta}</div>}
        </div>
        {extra}
      </div>
      <div className={bare ? '' : 'panel-body'}>{children}</div>
    </section>
  );
}

const REDUCE_MOTION = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function useCountUp(value, live) {
  const text = String(value ?? '');
  const match = text.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
  const target = match ? Number(match[1]) : null;
  const suffix = match ? match[2] : '';
  const [n, setN] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (!live || target == null) return undefined;
    if (REDUCE_MOTION || started.current) {
      started.current = true;
      setN(target);
      return undefined;
    }
    started.current = true;
    let raf;
    const t0 = performance.now();
    const frame = (now) => {
      const p = Math.min(1, (now - t0) / 680);
      setN(Math.round(target * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [live, target]);
  if (target == null || !live || REDUCE_MOTION) return text;
  return `${n}${suffix}`;
}

function Spark({ values }) {
  if (values.length < 2) return null;
  const w = 100, h = 28, max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 3 - (v / max) * (h - 6)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="spark" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} pathLength="1" />
    </svg>
  );
}

function Kpi({ label, value, note, tone, spark, icon: Icon, live }) {
  const shown = useCountUp(value, live);
  return (
    <div className={`kpi ${tone || ''}`}>
      <div className="kpi-top">
        {Icon && <Icon className="kpi-icon" size={14} strokeWidth={1.75} aria-hidden="true" />}
        <span className="kpi-label">{label}</span>
        {spark && <Spark values={spark} />}
      </div>
      <span className="kpi-value">{shown}</span>
      <span className="kpi-note">{note}</span>
    </div>
  );
}

function barPath(x, y, w, h, r) {
  if (h <= 0.5) return '';
  const radius = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + w - radius} Q${x + w},${y} ${x + w},${y + radius} V${y + h} Z`;
}

function Plot({ rows, ceiling, mode, avg }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  useEffect(() => setHover(null), [mode]);

  const height = 400;
  const pad = { l: 48, r: 16, t: 28, b: 62 };
  const n = rows.length;
  const max = ceiling || niceMax(Math.max(1, ...rows.map((r) => r.value)));
  const innerH = height - pad.t - pad.b;
  const baseline = pad.t + innerH;
  const y = (v) => pad.t + innerH * (1 - v / max);
  const step = n ? (width - pad.l - pad.r) / n : 0;
  const ticks = ceiling === 100 ? [0, 25, 50, 75, 100] : axisTicks(max);
  const hp = hover != null ? rows[hover] : null;
  const hx = hp ? pad.l + step * hover + step / 2 : 0;

  const move = (e) => {
    if (!n) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.floor((x - pad.l) / step);
    setHover(i >= 0 && i < n ? i : null);
  };

  return (
    <div className="plot" ref={ref}>
      {!n ? <p className="empty">Nothing to plot for this view.</p> : (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} className="plot-svg" role="img" aria-label="Owner bar chart" onMouseMove={move} onMouseLeave={() => setHover(null)}>
            <defs>
              {rows.map((r, i) => (
                <linearGradient key={r.name} id={`bar-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={r.color} stopOpacity="1" />
                  <stop offset="100%" stopColor={r.color} stopOpacity="0.35" />
                </linearGradient>
              ))}
            </defs>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'axis-line' : 'grid'} />
                <text x={pad.l - 10} y={y(v) + 4} textAnchor="end" className="axis">{Number.isInteger(v) ? v : v.toFixed(0)}</text>
              </g>
            ))}
            {avg != null && (
              <g>
                <line x1={pad.l} x2={width - pad.r} y1={y(avg)} y2={y(avg)} className="avg" />
                <text x={width - pad.r} y={y(avg) - 6} textAnchor="end" className="avg-label">Avg {Math.round(avg)}</text>
              </g>
            )}
            {rows.map((r, i) => {
              const cx = pad.l + step * i + step / 2;
              const py = y(r.value);
              const bw = Math.min(36, Math.max(10, step * 0.46));
              const dim = hover != null && hover !== i;
              const hot = hover === i;
              const [first, ...rest] = r.name.split(' ');
              return (
                <g key={r.name} className={dim ? 'dim' : ''}>
                  <path d={barPath(cx - bw / 2, py, bw, baseline - py, 7)} fill={`url(#bar-${i})`} className={hot ? 'bar hot' : 'bar'} style={{ animationDelay: `${i * 0.035}s` }} />
                  <text x={cx} y={Math.max(14, py - 10)} textAnchor="middle" className="plot-val">{r.value}</text>
                  <text x={cx} y={baseline + 18} textAnchor="middle" className="plot-name">
                    <tspan x={cx}>{first}</tspan>
                    {rest.length > 0 && <tspan x={cx} dy="14">{rest.join(' ')}</tspan>}
                  </text>
                </g>
              );
            })}
          </svg>
          {hp && (
            <div className="tip" style={{ left: `${(Math.min(Math.max(hx, 88), width - 88) / width) * 100}%` }}>
              <b><i style={{ background: hp.color }} />{hp.name}</b>
              {hp.lines.map(([k, v]) => <span key={k}>{k}<em>{v}</em></span>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Smooth curve that never passes the values on either side of a point, so a
// line cannot dip below zero or rise above the real count.
function curve(points) {
  if (!points.length) return '';
  if (points.length === 1) return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  const n = points.length;
  const slope = [];
  const tangent = new Array(n);
  for (let i = 0; i < n - 1; i += 1) {
    const dx = points[i + 1].x - points[i].x || 1;
    slope[i] = (points[i + 1].y - points[i].y) / dx;
  }
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i += 1) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      tangent[i] = t * a * slope[i];
      tangent[i + 1] = t * b * slope[i];
    }
  }
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const dx = points[i + 1].x - points[i].x;
    const c1x = points[i].x + dx / 3;
    const c1y = points[i].y + tangent[i] * dx / 3;
    const c2x = points[i + 1].x - dx / 3;
    const c2y = points[i + 1].y - tangent[i + 1] * dx / 3;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${points[i + 1].x.toFixed(1)},${points[i + 1].y.toFixed(1)}`;
  }
  return d;
}

function LinePlot({ labels, series, ceiling, scope, unit, fill }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const signature = `${scope}:${unit}:${labels.length}:${series.map((s) => s.name).join('|')}`;
  useEffect(() => setHover(null), [signature]);

  const height = 400;
  const pad = { l: 48, r: 18, t: 24, b: 36 };
  const n = labels.length;
  const maxVal = Math.max(1, ...series.flatMap((s) => s.values));
  const max = ceiling || niceMax(maxVal);
  const innerH = height - pad.t - pad.b;
  const baseline = pad.t + innerH;
  const y = (v) => pad.t + innerH * (1 - v / max);
  const step = n > 1 ? (width - pad.l - pad.r) / (n - 1) : 0;
  const x = (i) => pad.l + step * i;
  const ticks = ceiling === 100 ? [0, 25, 50, 75, 100] : axisTicks(max);
  const active = hover ? series.find((s) => s.name === hover.name) : null;

  const move = (e) => {
    if (!n || !series.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const py = ((e.clientY - rect.top) / rect.height) * height;
    const i = Math.max(0, Math.min(n - 1, Math.round((px - pad.l) / (step || 1))));
    let name = series[0].name;
    let best = Infinity;
    series.forEach((s) => {
      const dist = Math.abs(y(s.values[i]) - py);
      if (dist < best) { best = dist; name = s.name; }
    });
    setHover({ i, name });
  };

  const labelOn = (i) => (scope === 'year' ? (width < 720 ? i % 2 === 0 : true) : (i === 0 || (i + 1) % 5 === 0 || i === n - 1));

  return (
    <div className="plot" ref={ref}>
      {!series.length ? <p className="empty">Nothing to plot for this view.</p> : (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} className="plot-svg" role="img" aria-label="Owner trend" onMouseMove={move} onMouseLeave={() => setHover(null)}>
            {fill && (
              <defs>
                {series.map((s, i) => (
                  <linearGradient key={s.name} id={`area-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity="0.38" />
                    <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                  </linearGradient>
                ))}
              </defs>
            )}
            {ticks.map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'axis-line' : 'grid'} />
                <text x={pad.l - 10} y={y(v) + 4} textAnchor="end" className="axis">{Number.isInteger(v) ? v : Math.round(v)}</text>
              </g>
            ))}
            {fill && series.map((s, i) => {
              const pts = s.values.map((v, idx) => ({ x: x(idx), y: y(v) }));
              const line = curve(pts);
              const last = pts[pts.length - 1];
              const area = `${line} L${last.x.toFixed(1)},${baseline} L${pts[0].x.toFixed(1)},${baseline} Z`;
              return <path key={`${s.name}-fill`} d={area} className="series-fill" fill={`url(#area-${i})`} style={{ animationDelay: `${0.28 + i * 0.03}s` }} />;
            })}
            {hover && <line x1={x(hover.i)} x2={x(hover.i)} y1={pad.t} y2={baseline} className="guide" />}
            {series.map((s, i) => {
              const dim = hover && hover.name !== s.name;
              const hot = hover?.name === s.name;
              const d = curve(s.values.map((v, idx) => ({ x: x(idx), y: y(v) })));
              return (
                <g key={s.name} className={dim ? 'dim' : ''}>
                  <path d={d} pathLength="1" className="series" stroke={s.color} strokeWidth={hot ? 2.75 : 2} style={{ animationDelay: `${i * 0.03}s` }} />
                  {hot && <circle cx={x(hover.i)} cy={y(s.values[hover.i])} r="5" fill={s.color} className="dot" />}
                </g>
              );
            })}
            {labels.map((label, i) => labelOn(i) && (
              <text key={label.full} x={x(i)} y={height - 12} textAnchor="middle" className="axis">{label.label}</text>
            ))}
          </svg>
          {active && (
            <div className="tip" style={{ left: `${(Math.min(Math.max(x(hover.i), 96), width - 96) / width) * 100}%` }}>
              <b><i style={{ background: active.color }} />{active.name}</b>
              <span>{labels[hover.i].full}<em>{active.values[hover.i]} {unit}</em></span>
            </div>
          )}
          <ul className="line-legend">
            {series.map((s) => (
              <li key={s.name} className={hover && hover.name !== s.name ? 'dim' : ''}
                onMouseEnter={() => setHover({ i: n - 1, name: s.name })}
                onMouseLeave={() => setHover(null)}>
                <i style={{ background: s.color }} />{s.name}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function HBars({ rows, tone, empty }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="empty">{empty}</p>;
  return (
    <ul className="hbars">
      {rows.map((r, i) => (
        <li key={r.label}>
          <span className={`hb-label ${r.tone || ''}`} title={r.label}>{r.label}</span>
          <div className="hb-track"><div className={`hb-fill ${r.tone || tone}`} style={{ width: `${(r.value / max) * 100}%`, animationDelay: `${i * 0.025}s` }} /></div>
          <b>{r.value}</b>
        </li>
      ))}
    </ul>
  );
}

function Employees({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.assigned));
  if (!rows.length) return <p className="empty">No assigned requests in this period.</p>;
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

function ringArc(cx, cy, r, start, sweep) {
  if (sweep <= 0) return '';
  if (sweep >= Math.PI * 2 - 0.0001) {
    return `M${cx} ${cy - r} A${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r}`;
  }
  const a0 = start - Math.PI / 2;
  const a1 = start + sweep - Math.PI / 2;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = sweep > Math.PI ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function Donut({ parts, live }) {
  const sum = parts.reduce((s, p) => s + p.value, 0);
  const total = sum || 1;
  const cx = 80;
  const cy = 80;
  const r = 54;
  const stroke = 38;
  let angle = 0;
  const paint = { done: 'url(#filed-grad)', pend: 'url(#inbox-grad)' };
  const shown = useCountUp(sum, live);
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 160 160" className="donut" role="img" aria-label="Requests by status">
        <defs>
          <linearGradient id="filed-grad" gradientUnits="userSpaceOnUse" x1="12" y1="80" x2="148" y2="80">
            <stop offset="0%" stopColor="var(--blue)" />
            <stop offset="100%" stopColor="#8b6cff" />
          </linearGradient>
          <linearGradient id="inbox-grad" gradientUnits="userSpaceOnUse" x1="20" y1="130" x2="140" y2="30">
            <stop offset="0%" stopColor="#ffe7a8" />
            <stop offset="100%" stopColor="var(--pend)" />
          </linearGradient>
        </defs>
        <circle cx={cx} cy={cy} r={r} className="d-track" strokeWidth={stroke} />
        {parts.map((p) => {
          const sweep = (p.value / total) * Math.PI * 2;
          const d = ringArc(cx, cy, r, angle, sweep);
          angle += sweep;
          if (!d) return null;
          return (
            <path key={p.key} d={d} pathLength="100" className={`d-seg ${p.key}`} fill="none" strokeWidth={stroke} strokeLinecap="butt"
              stroke={paint[p.key]} style={{ animationDelay: `${parts.indexOf(p) * 0.08}s` }} />
          );
        })}
      </svg>
      <div className="donut-side">
        <div className="donut-total"><strong>{shown}</strong><span>requests</span></div>
      <ul className="legend">
        {parts.map((p) => (
          <li key={p.key}><i className={`sq ${p.key}`} />{p.label}<b>{p.value}</b><small>{sum ? Math.round((p.value / sum) * 100) : 0}%</small></li>
        ))}
      </ul>
      </div>
    </div>
  );
}

const STATUSES = [
  { id: 'completed', label: 'Filed' },
  { id: 'pending', label: 'In Inbox' },
  { id: 'deleted', label: 'Deleted' },
];

function matches(selected, values) {
  return !selected.length || selected.some((item) => values.includes(item));
}

function visibleOwners(owners, hiddenOwners) {
  return hiddenOwners.length ? owners.filter((name) => !hiddenOwners.includes(name)) : owners;
}

// A request with two owners was being added to every owner line, so the graph
// summed higher than the Filed card. Count it once, for the first owner still in view.
function forOwnerCount(emails, hiddenOwners, ownersSel) {
  return emails.map((e) => {
    const left = visibleOwners(e.owners, hiddenOwners).filter((name) => !ownersSel.length || ownersSel.includes(name));
    const owner = left[0];
    if (!owner || (e.owners.length === 1 && e.owners[0] === owner)) return e;
    return { ...e, owners: [owner] };
  });
}

function yearSpan(year, hiddenMonths) {
  const visible = MONTHS.map((name, i) => ({ name, i })).filter((m) => !hiddenMonths.includes(m.i));
  if (!visible.length) return `${year} · no months`;
  if (visible.length === 12) return String(year);
  const indexes = visible.map((m) => m.i);
  const contiguous = indexes.every((n, i) => i === 0 || n === indexes[i - 1] + 1);
  const short = visible.map((m) => m.name.slice(0, 3));
  if (contiguous) return short[0] === short.at(-1) ? `${short[0]} ${year}` : `${short[0]}–${short.at(-1)} ${year}`;
  return `${year} · ${short.join(', ')}`;
}

function TagSelect({ label, allLabel, moreLabel = 'Add another', options, selected, onChange, swatch, tone }) {
  const add = (value) => {
    if (value === '__all') onChange([]);
    else if (value && !selected.includes(value)) onChange([...selected, value]);
  };
  const items = options
    .map((option) => ({ id: option.id ?? option, label: option.label ?? option }))
    .filter((option) => !selected.includes(option.id));
  return (
    <div className="tag-field">
      <Field label={label}>
        <select value="" onChange={(e) => add(e.target.value)} aria-label={label}>
          <option value="">{selected.length ? moreLabel : allLabel}</option>
          {selected.length > 0 && <option value="__all">{allLabel}</option>}
          {items.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </Field>
      {selected.length > 0 && (
        <div className="pills">
          {selected.map((id) => {
            const match = options.find((option) => (option.id ?? option) === id);
            const text = match?.label ?? match ?? id;
            const color = swatch?.(id);
            return (
              <button key={id} type="button" className={tone === 'hide' ? 'pill hide' : 'pill'} onClick={() => onChange(selected.filter((item) => item !== id))}>
                {color && <i style={{ background: color }} />}
                {text}
                <span className="x">×</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ViewGate({ label, onClose, onUnlock }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const hash = await hashText(value);
      if (hash === VIEW_GATE) onUnlock();
      else setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate" onMouseDown={onClose}>
      <form className="gate-card" role="dialog" aria-modal="true" aria-labelledby="gate-title" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 id="gate-title">{label} is locked</h2>
        <p>This view is not ready yet. Enter the password to open it.</p>
        <input
          ref={inputRef}
          type="password"
          value={value}
          autoComplete="current-password"
          aria-label="Password"
          aria-invalid={error}
          onChange={(e) => { setValue(e.target.value); setError(false); }}
        />
        {error && <p className="gate-error">Wrong password.</p>}
        <div className="gate-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy || !value}>Unlock</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="select">{children}</span>
    </label>
  );
}

export default function App({ records }) {
  const [theme, toggleTheme] = useTheme();
  const [boxId, setBoxId] = useState(MAILBOXES[0].id);
  const box = MAILBOXES.find((item) => item.id === boxId) ?? MAILBOXES[0];
  const { data, loading } = useMailbox(records, box.id);
  const [phase, setPhase] = useState('wait');
  if (phase === 'wait' && !loading && data.length) setPhase(REDUCE_MOTION ? 'done' : 'play');
  useEffect(() => {
    if (phase !== 'play') return undefined;
    const t = setTimeout(() => setPhase('done'), 1100);
    return () => clearTimeout(t);
  }, [phase]);
  const live = phase !== 'wait';
  const [year, setYear] = useState(AVAILABLE_YEARS[0]);
  const [month, setMonth] = useState(initialMonth);
  const [scope, setScope] = useState('year');
  const [chartView, setChartView] = useState(false);
  const [ownersSel, setOwnersSel] = useState([]);
  const [hiddenOwners, setHiddenOwners] = useState([]);
  const [hiddenMonths, setHiddenMonths] = useState([]);
  const [typesSel, setTypesSel] = useState([]);
  const [statusSel, setStatusSel] = useState([]);
  const [flagsSel, setFlagsSel] = useState([]);
  const [view, setView] = useState('filed');
  const [viewsOpen, setViewsOpen] = useState(false);
  const [gateFor, setGateFor] = useState(null);
  const [q, setQ] = useState('');
  const [logoOk, setLogoOk] = useState(true);

  const all = useMemo(() => enrich(data), [data]);
  const colorOf = useMemo(() => {
    const names = [...new Set(all.flatMap((e) => e.owners))].sort();
    return new Map(names.map((name, i) => [name, PALETTE[i % PALETTE.length]]));
  }, [all]);
  const inPeriod = useMemo(
    () => all.filter((e) => {
      const d = new Date(e.received);
      return d.getFullYear() === year && (scope === 'year' || d.getMonth() === month);
    }),
    [all, year, month, scope],
  );
  const owners = useMemo(() => [...new Set(inPeriod.flatMap((e) => e.owners))].sort(), [inPeriod]);
  const types = useMemo(() => {
    const present = new Set(inPeriod.flatMap((e) => e.types));
    return [...REQUEST_TYPES.filter((t) => present.has(t)), ...[...present].filter((t) => !REQUEST_TYPES.includes(t)).sort()];
  }, [inPeriod]);
  useEffect(() => {
    setOwnersSel((prev) => {
      const next = prev.filter((name) => owners.includes(name));
      return next.length === prev.length ? prev : next;
    });
    setHiddenOwners((prev) => {
      const next = prev.filter((name) => owners.includes(name));
      return next.length === prev.length ? prev : next;
    });
  }, [owners]);
  useEffect(() => {
    setTypesSel((prev) => {
      const next = prev.filter((name) => types.includes(name));
      return next.length === prev.length ? prev : next;
    });
  }, [types]);

  const filtered = useMemo(() => inPeriod.filter((e) => {
    if (scope === 'year' && hiddenMonths.includes(new Date(e.received).getMonth())) return false;
    const left = visibleOwners(e.owners, hiddenOwners);
    if (!left.length) return false;
    return matches(ownersSel, left)
      && matches(typesSel, e.types)
      && matches(flagsSel, e.flags)
      && matches(statusSel, [e.status]);
  }), [inPeriod, scope, hiddenMonths, hiddenOwners, ownersSel, typesSel, flagsSel, statusSel]);
  const s = useMemo(() => summarize(filtered), [filtered]);
  const counted = useMemo(
    () => forOwnerCount(filtered, hiddenOwners, ownersSel),
    [filtered, hiddenOwners, ownersSel],
  );
  const ownerRollup = useMemo(() => summarize(counted), [counted]);
  const stats = useMemo(
    () => ownerStats(counted, colorOf, ownersSel, hiddenOwners),
    [counted, colorOf, ownersSel, hiddenOwners],
  );

  const trend = useMemo(
    () => trendSeries(counted, colorOf, scope, year, month, view, ownersSel, hiddenOwners, hiddenMonths),
    [counted, colorOf, scope, year, month, view, ownersSel, hiddenOwners, hiddenMonths],
  );
  const plot = useMemo(() => {
    const rows = stats.map((r) => {
      if (view === 'performance') {
        return {
          ...r,
          value: r.score,
          lines: [['Score', r.score], ['Filed', `${Math.round(r.completion * 100)}%`], ['Open', r.pending], ['Avg wait', r.ageN ? `${r.avgAge.toFixed(1)}d` : '—']],
        };
      }
      if (view === 'backlog') {
        return { ...r, value: r.pending, lines: [['Open', r.pending], ['Filed', r.filed]] };
      }
      return { ...r, value: r.filed, lines: [['Filed', r.filed], ['Still open', r.pending]] };
    }).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    const avg = view === 'performance' && rows.length ? rows.reduce((sum, r) => sum + r.value, 0) / rows.length : null;
    return { rows, avg };
  }, [stats, view]);

  const prevTotal = useMemo(() => {
    const d = new Date(year, month - 1, 1);
    if (!AVAILABLE_YEARS.includes(d.getFullYear())) return null;
    return all.filter((e) => {
      if (!sameMonth(e.received, d.getFullYear(), d.getMonth())) return false;
      const left = visibleOwners(e.owners, hiddenOwners);
      return left.length
        && matches(ownersSel, left)
        && matches(typesSel, e.types)
        && matches(flagsSel, e.flags)
        && matches(statusSel, [e.status]);
    }).length;
  }, [all, year, month, ownersSel, hiddenOwners, typesSel, flagsSel, statusSel]);
  const delta = scope === 'month' && prevTotal ? Math.round(((filtered.length - prevTotal) / prevTotal) * 100) : null;
  const periodLabel = scope === 'year' ? yearSpan(year, hiddenMonths) : `${MONTHS[month]} ${year}`;
  const filtersOn = ownersSel.length || hiddenOwners.length || hiddenMonths.length || typesSel.length || statusSel.length || flagsSel.length;

  const sharedOwners = useMemo(() => inPeriod.filter((e) => {
    if (scope === 'year' && hiddenMonths.includes(new Date(e.received).getMonth())) return false;
    return e.owners.length > 1;
  }).sort((a, b) => new Date(b.received) - new Date(a.received)), [inPeriod, scope, hiddenMonths]);

  const queue = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? s.queue.filter((e) => [e.subject, e.owners.join(' '), e.types.join(' ')].join(' ').toLowerCase().includes(t)) : s.queue;
  }, [s.queue, q]);

  const viewMeta = {
    filed: `${s.completedCount} filed in ${periodLabel}`,
    performance: plot.avg == null ? 'No owners in this view' : `Team average ${Math.round(plot.avg)} · 70% filed, 30% speed`,
    backlog: `${s.pendingCount} still in the Inbox`,
  };
  const chartTitle = { filed: 'Requests filed by owner', performance: 'Owner performance', backlog: 'Inbox backlog by owner' };
  const trendTitle = scope === 'year'
    ? { filed: `Filed across ${periodLabel}`, performance: `Performance across ${periodLabel}`, backlog: `Backlog across ${periodLabel}` }
    : { filed: `Filed in ${MONTHS[month]}`, performance: `Performance in ${MONTHS[month]}`, backlog: `Backlog in ${MONTHS[month]}` };
  const heroTitle = chartView ? chartTitle[view] : trendTitle[view];
  const heroMeta = chartView ? viewMeta[view] : 'One line per owner. Hover a line to view that owner\'s total.';
  const unit = view === 'performance' ? 'score' : view === 'backlog' ? 'open' : 'filed';

  return (
    <div className={`shell${phase === 'play' ? ' intro' : ''}`}>
      <header className="hdr">
        <div className="hdr-side">
        <div className="brand">
          <div className="brand-mark">
            {logoOk
              ? <img src={logoSrc} alt="CCS" onError={() => setLogoOk(false)} />
              : <span className="logo-fallback">CCS</span>}
          </div>
          <div className="brand-copy">
            <h1>CCS Billing</h1>
            <p>
              Shared mailbox
              <span className="dot-sep" aria-hidden="true" />
              <select
                className="mailbox-pick"
                value={box.id}
                aria-label="Mailbox"
                onChange={(e) => {
                  setBoxId(e.target.value);
                  setOwnersSel([]);
                  setHiddenOwners([]);
                  setHiddenMonths([]);
                  setTypesSel([]);
                  setStatusSel([]);
                  setFlagsSel([]);
                  setQ('');
                }}
              >
                {MAILBOXES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </p>
          </div>
        </div>
        </div>
        <div className="hdr-main">
        <div className="hdr-actions">
          <History release={release} />
          <ThemeSwitch theme={theme} onToggle={toggleTheme} />
        </div>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <p className="side-label">View</p>
          <div className="views" role="group" aria-label="Chart view">
            {VIEWS.map((v) => {
              const locked = v.locked && !viewsOpen;
              return (
                <button key={v.id} type="button" className={view === v.id ? 'on' : ''} aria-pressed={view === v.id} onClick={() => (locked ? setGateFor(v.id) : setView(v.id))}>
                  <b>{v.label}{locked && <Lock size={12} strokeWidth={2.2} aria-label="Locked" />}</b>
                  <small>{v.hint}</small>
                </button>
              );
            })}
          </div>

          <p className="side-label">Filters</p>
          <div className="seg" role="group" aria-label="Year or month">
            <button type="button" className={scope === 'year' ? 'on' : ''} aria-pressed={scope === 'year'} onClick={() => setScope('year')}>Year</button>
            <button type="button" className={scope === 'month' ? 'on' : ''} aria-pressed={scope === 'month'} onClick={() => setScope('month')}>Month</button>
          </div>
          {scope === 'month' && (
            <Field label="Month">
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month">
                {MONTHS.map((name, i) => <option key={name} value={i}>{name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Year">
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
              {AVAILABLE_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
          <p className="field-note">Only 2026 is available.</p>
          {scope === 'year' && (
            <div className="month-field">
              <span>Months</span>
              <div className="month-picks" role="group" aria-label="Months included in this year">
                {MONTHS.map((name, i) => {
                  const off = hiddenMonths.includes(i);
                  return (
                    <button key={name} type="button" className={off ? 'off' : ''} aria-pressed={!off} onClick={() => setHiddenMonths((prev) => (off ? prev.filter((item) => item !== i) : [...prev, i]))}>
                      {name.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
              <p className="field-note">Click a month to leave it out. Click it again to put it back.</p>
            </div>
          )}
          <TagSelect label="Owner" allLabel="All owners" options={owners.filter((name) => !hiddenOwners.includes(name))} selected={ownersSel} onChange={(next) => { setOwnersSel(next); setHiddenOwners((prev) => prev.filter((name) => !next.includes(name))); }} swatch={(name) => colorOf.get(name)} />
          <TagSelect label="Hide owner" allLabel="None hidden" moreLabel="Hide another" tone="hide" options={owners.filter((name) => !ownersSel.includes(name))} selected={hiddenOwners} onChange={(next) => { setHiddenOwners(next); setOwnersSel((prev) => prev.filter((name) => !next.includes(name))); }} swatch={(name) => colorOf.get(name)} />
          <TagSelect label="Request type" allLabel="All types" options={types} selected={typesSel} onChange={setTypesSel} />
          <TagSelect label="Status" allLabel="All statuses" options={STATUSES} selected={statusSel} onChange={setStatusSel} />
          <TagSelect label="Flag" allLabel="All flags" options={FLAGS} selected={flagsSel} onChange={setFlagsSel} />
          {filtersOn ? <button type="button" className="clear" onClick={() => { setOwnersSel([]); setHiddenOwners([]); setHiddenMonths([]); setTypesSel([]); setStatusSel([]); setFlagsSel([]); }}>Clear filters</button> : null}

          <p className="side-label">Saved mail</p>
          <p className="field-note">{data.length ? `${data.length} emails in ${box.folder}.` : `No mail in ${box.folder} yet.`}</p>

          <div className="side-card">
            <span>{scope === 'year' ? (hiddenMonths.length ? periodLabel : 'This year') : 'This month'}</span>
            <strong>{s.total}</strong>
            <small>{s.rate}% filed · {s.pendingCount} still open</small>
          </div>
        </aside>

        <main className="main">
          <div className="kpis">
            <Kpi live={live} icon={Mails} label="Requests" value={s.total} spark={s.daily.map((d) => d.pending + d.completed)}
              note={delta == null ? periodLabel : `${delta >= 0 ? '+' : ''}${delta}% vs prior month`} />
            <Kpi live={live} icon={Inbox} label="In Inbox" value={s.pendingCount} note={`Avg wait ${s.avgAge.toFixed(1)} days`} />
            <Kpi live={live} icon={FolderCheck} label="Filed" value={s.completedCount} note="Moved out of the Inbox" />
            <Kpi live={live} icon={Percent} label="Completion" value={`${s.rate}%`} note="Filed ÷ filed + inbox" />
            <Kpi live={live} icon={Star} label="VIP in Inbox" value={s.vipPending} tone={s.vipPending ? 'bad' : ''} note="Needs priority" />
            <Kpi live={live} icon={Clock} label="Awaiting reply" value={s.awaitingPending} note="Flagged, still in Inbox" />
            <Kpi live={live} icon={Trash2} label="Deleted" value={s.deletedCount} note="Tracked separately" />
          </div>

          <div className="grid">
            <Panel className="hero" title={heroTitle} meta={heroMeta} extra={(
              <div className="mode-toggle" role="group" aria-label="Graph style">
                <button type="button" className={chartView ? '' : 'on'} aria-pressed={!chartView} onClick={() => setChartView(false)}>Trend</button>
                <button type="button" className={chartView ? 'on' : ''} aria-pressed={chartView} onClick={() => setChartView(true)}>Chart</button>
              </div>
            )}>
              {chartView
                ? <Plot rows={plot.rows} ceiling={view === 'performance' ? 100 : null} mode={view} avg={plot.avg} />
                : <LinePlot labels={trend.labels} series={trend.series} ceiling={view === 'performance' ? 100 : null} scope={scope} unit={unit} fill={ownersSel.length === 1} />}
            </Panel>

            <Panel className="half" title="Status">
              <Donut live={live} parts={[
                { key: 'done', label: 'Filed', value: s.completedCount },
                { key: 'pend', label: 'In Inbox', value: s.pendingCount },
                { key: 'del', label: 'Deleted', value: s.deletedCount },
              ]} />
            </Panel>

            <Panel className="half" title="Inbox Aging" meta="Still in Inbox">
              <HBars rows={s.ageBuckets.map((row) => ({ ...row, tone: { Today: 'good', '1–2 days': 'fresh', '3–7 days': 'warn', '8–14 days': 'late', '15+ days': 'bad' }[row.label] }))} empty="Inbox is clear." />
            </Panel>

            <Panel className="third" title="Inbox by type" meta={`${s.pendingCount} open`}>
              <HBars rows={s.pendingByType} tone="pend" empty="Nothing waiting in the Inbox." />
            </Panel>
            <Panel className="third" title="Filed by type" meta={`${s.completedCount} filed`}>
              <HBars rows={s.completedByType} tone="done" empty="No filed requests in this view." />
            </Panel>
            <Panel className="third last" title="Filed vs assigned" meta="Completed / assigned">
              <Employees rows={ownerRollup.employees} />
            </Panel>

            <Panel className="full" bare title="Oldest in the Inbox"
              meta={<input className="search" placeholder="Search subject, owner, type" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search queue" />}>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Subject</th><th>Type</th><th>Owner</th><th>Folder</th><th>Received</th><th className="num">Age</th></tr></thead>
                  <tbody>
                    {queue.slice(0, 25).map((e) => {
                      const age = Math.floor((Date.now() - new Date(e.received)) / DAY);
                      const ageTone = age > 14 ? 'bad' : age > 7 ? 'warn' : '';
                      return (
                        <tr key={e.messageId || e.id}>
                          <td className="subject">{e.subject}{e.flags.map((f) => <span key={f} className="tag">{f}</span>)}</td>
                          <td>{e.types.join(', ')}</td>
                          <td>{e.owners.join(', ')}</td>
                          <td className="muted">{e.folder}</td>
                          <td className="muted">{fmtDate(e.received)}</td>
                          <td className="num"><span className={`age ${ageTone}`}>{age}d</span></td>
                        </tr>
                      );
                    })}
                    {!queue.length && <tr><td colSpan="6" className="empty">No requests waiting in the Inbox.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="foot">{queue.length ? `Showing ${Math.min(queue.length, 25)} of ${queue.length}` : 'Inbox is clear for this view.'}</p>
            </Panel>

            <Panel className="full" title="More than one owner" meta={sharedOwners.length ? `${sharedOwners.length} to reconcile` : 'Clear'}>
              {sharedOwners.length ? (
                <>
                  <div className="table-wrap reconcile">
                    <table>
                      <thead><tr><th>Subject</th><th>Owners</th><th>Folder</th><th>Received</th></tr></thead>
                      <tbody>
                        {sharedOwners.map((e) => (
                          <tr key={e.messageId || e.id}>
                            <td className="subject">{e.subject || '(No subject)'}</td>
                            <td>{e.owners.join(', ')}</td>
                            <td className="muted">{e.folder}</td>
                            <td className="muted">{fmtDate(e.received)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="foot">Each request stays here until it has one owner tag.</p>
                </>
              ) : (
                <p className="reconcile-clear">All multi-owner tags have been corrected.</p>
              )}
            </Panel>
          </div>
        </main>
      </div>
      {gateFor && (
        <ViewGate
          label={VIEWS.find((v) => v.id === gateFor)?.label}
          onClose={() => setGateFor(null)}
          onUnlock={() => { setViewsOpen(true); setView(gateFor); setGateFor(null); }}
        />
      )}
    </div>
  );
}
