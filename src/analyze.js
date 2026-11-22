import {
  START_DATE, PENDING_FOLDERS, DELETED_FOLDERS, EXCLUDED_FOLDERS,
  REQUEST_TYPES, FLAGS, OWNER_PREFIX,
} from './config.js';

const typeMap = new Map(REQUEST_TYPES.map((t) => [t.toLowerCase(), t]));
const flagMap = new Map(FLAGS.map((t) => [t.toLowerCase(), t]));
const clean = (f) => f.toLowerCase().trim().replace(/^\/+|\/+$/g, '').replace(/\\/g, '/');
const titleCase = (s) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

export function statusOf(folder) {
  const f = clean(folder);
  if (EXCLUDED_FOLDERS.includes(f)) return 'excluded';
  if (DELETED_FOLDERS.includes(f)) return 'deleted';
  if (PENDING_FOLDERS.includes(f)) return 'pending';
  return 'completed';
}

// One record per unique email, with request types / owner / flags split out
export function enrich(records) {
  const seen = new Map();
  records.forEach((r) => {
    const key = r.messageId || r.id;
    if (!seen.has(key)) seen.set(key, r);
  });
  const start = new Date(START_DATE).getTime();
  const emails = [...seen.values()]
    .filter((r) => r.received && new Date(r.received).getTime() >= start)
    .map((r) => {
      const types = [], flags = [], owners = [];
      r.categories.forEach((c) => {
        const name = String(c).trim();
        const k = name.toLowerCase();
        if (!k) return;
        if (k.startsWith(OWNER_PREFIX)) owners.push(titleCase(name.slice(OWNER_PREFIX.length).trim()));
        else if (flagMap.has(k)) flags.push(flagMap.get(k));
        else types.push(typeMap.get(k) || name);
      });
      const unique = (list) => [...new Map(list.map((item) => [item.toLowerCase(), item])).values()];
      const typeList = unique(types);
      const ownerList = unique(owners);
      return {
        ...r,
        types: typeList.length ? typeList : ['Uncategorized'],
        owners: ownerList.length ? ownerList : ['Unassigned'],
        flags: unique(flags),
        status: statusOf(r.folder),
      };
    })
    .filter((e) => e.status !== 'excluded');
  return collapseInboxThreads(emails);
}

function threadKey(subject) {
  return String(subject || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/g, '')
    .trim();
}

// Replies sitting in the Inbox are separate messages. One subject is one open request.
function collapseInboxThreads(emails) {
  const rest = [];
  const groups = new Map();
  emails.forEach((email) => {
    const key = email.status === 'pending' ? threadKey(email.subject) : '';
    if (!key) { rest.push(email); return; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(email);
  });
  const unique = (list) => [...new Map(list.map((item) => [item.toLowerCase(), item])).values()];
  const merged = [...groups.values()].map((list) => {
    const ordered = [...list].sort((a, b) => new Date(a.received) - new Date(b.received));
    const types = unique(ordered.flatMap((e) => e.types).filter((t) => t !== 'Uncategorized'));
    const owners = unique(ordered.flatMap((e) => e.owners).filter((t) => t !== 'Unassigned'));
    return {
      ...ordered[0],
      folder: 'Inbox',
      status: 'pending',
      types: types.length ? types : ['Uncategorized'],
      owners: owners.length ? owners : ['Unassigned'],
      flags: unique(ordered.flatMap((e) => e.flags)),
    };
  });
  return [...rest, ...merged];
}

function tally(emails, keyFn) {
  const m = new Map();
  emails.forEach((e) => keyFn(e).forEach((k) => m.set(k, (m.get(k) || 0) + 1)));
  return m;
}

export function summarize(emails) {
  const pending = emails.filter((e) => e.status === 'pending');
  const completed = emails.filter((e) => e.status === 'completed');
  const deleted = emails.filter((e) => e.status === 'deleted');

  const toRows = (m) => [...m].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const pendingByType = toRows(tally(pending, (e) => e.types));
  const completedByType = toRows(tally(completed, (e) => e.types));

  const ownerAssigned = tally(emails.filter((e) => e.status !== 'deleted'), (e) => e.owners);
  const ownerDone = tally(completed, (e) => e.owners);
  const ownerPending = tally(pending, (e) => e.owners);
  const employees = [...ownerAssigned.keys()]
    .map((name) => ({
      name,
      assigned: ownerAssigned.get(name) || 0,
      completed: ownerDone.get(name) || 0,
      pending: ownerPending.get(name) || 0,
    }))
    .sort((a, b) => b.completed - a.completed);

  // weekly volume (weeks start Monday)
  const weekStart = (d) => {
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x.getTime();
  };
  const weeks = new Map();
  emails.forEach((e) => {
    if (e.status === 'deleted') return;
    const k = weekStart(e.received);
    const w = weeks.get(k) || { start: k, pending: 0, completed: 0 };
    w[e.status] += 1;
    weeks.set(k, w);
  });
  const weekly = [...weeks.values()].sort((a, b) => a.start - b.start);

  // daily volume, gaps filled with zeros up to today
  const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const dmap = new Map();
  emails.forEach((e) => {
    if (e.status === 'deleted') return;
    const k = dayStart(e.received);
    const d = dmap.get(k) || { start: k, pending: 0, completed: 0 };
    d[e.status] += 1;
    dmap.set(k, d);
  });
  const daily = [];
  if (dmap.size) {
    const last = Math.max(...dmap.keys());
    for (let d = new Date(Math.min(...dmap.keys())); d.getTime() <= last; d.setDate(d.getDate() + 1)) {
      const k = dayStart(d);
      daily.push(dmap.get(k) || { start: k, pending: 0, completed: 0 });
    }
  }

  // how long pending emails have been waiting
  const now = Date.now();
  const ageDays = pending.map((e) => Math.floor((now - new Date(e.received)) / 86400000));
  const buckets = [['Today', (d) => d < 1], ['1–2 days', (d) => d >= 1 && d <= 2], ['3–7 days', (d) => d >= 3 && d <= 7],
    ['8–14 days', (d) => d >= 8 && d <= 14], ['15+ days', (d) => d >= 15]];
  const ageBuckets = buckets.map(([label, t]) => ({ label, value: ageDays.filter(t).length }));
  const avgAge = ageDays.length ? ageDays.reduce((a, b) => a + b, 0) / ageDays.length : 0;

  const received = emails.filter((e) => e.status !== 'deleted');
  const last7 = received.filter((e) => now - new Date(e.received) < 7 * 86400000).length;
  const prev7 = received.filter((e) => { const a = now - new Date(e.received); return a >= 7 * 86400000 && a < 14 * 86400000; }).length;

  const active = pending.length + completed.length;
  return {
    daily, ageBuckets, avgAge, last7, prev7,
    total: emails.length,
    pendingCount: pending.length,
    completedCount: completed.length,
    deletedCount: deleted.length,
    rate: active ? Math.round((completed.length / active) * 100) : 0,
    vipPending: pending.filter((e) => e.flags.includes('VIP')).length,
    awaitingPending: pending.filter((e) => e.flags.includes('Awaiting Reply')).length,
    pendingByType, completedByType, employees, weekly,
    queue: [...pending].sort((a, b) => new Date(a.received) - new Date(b.received)),
  };
}
