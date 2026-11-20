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
  return [...seen.values()]
    .filter((r) => r.received && new Date(r.received).getTime() >= start)
    .map((r) => {
      const types = [], flags = [], owners = [];
      r.categories.forEach((c) => {
        const k = c.toLowerCase().trim();
        if (k.startsWith(OWNER_PREFIX)) owners.push(titleCase(c.slice(OWNER_PREFIX.length).trim()));
        else if (typeMap.has(k)) types.push(typeMap.get(k));
        else if (flagMap.has(k)) flags.push(flagMap.get(k));
      });
      return {
        ...r,
        types: types.length ? types : ['Uncategorized'],
        owners: owners.length ? owners : ['Unassigned'],
        flags,
        status: statusOf(r.folder),
      };
    })
    .filter((e) => e.status !== 'excluded');
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

  const active = pending.length + completed.length;
  return {
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
