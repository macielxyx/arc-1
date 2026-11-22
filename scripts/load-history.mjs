import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = resolve(root, 'public/mailbox.json');
const YEAR = 2026;
const FIRST_MONTH = 0;
const LAST_MONTH = 10;

function flowUrl() {
  const line = readFileSync(resolve(root, '.env'), 'utf8')
    .split('\n')
    .find((entry) => entry.startsWith('VITE_FLOW_URL='));
  const url = line?.slice('VITE_FLOW_URL='.length).trim();
  if (!url) throw new Error('VITE_FLOW_URL is empty in .env');
  return url;
}

function zoneOffset(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second));
  return asUtc - date.getTime();
}

function chicagoMidnight(year, monthIndex, day) {
  let utc = Date.UTC(year, monthIndex, day);
  const first = zoneOffset(new Date(utc));
  utc -= first;
  const second = zoneOffset(new Date(utc));
  if (second !== first) utc -= second - first;
  return new Date(utc).toISOString().replace('.000Z', 'Z');
}

const monthName = (index) => new Date(Date.UTC(YEAR, index, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });

function rowsOf(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.emails)) return json.emails;
  if (Array.isArray(json?.value)) return json.value;
  return null;
}

async function pullMonth(base, monthIndex) {
  const from = chicagoMidnight(YEAR, monthIndex, 1);
  const to = chicagoMidnight(YEAR, monthIndex + 1, 1);
  const url = `${base}${base.includes('?') ? '&' : '?'}from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(150000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${monthName(monthIndex)} returned ${res.status}: ${text.slice(0, 180)}`);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`${monthName(monthIndex)} did not return JSON`); }
  const rows = rowsOf(json);
  if (!rows) throw new Error(`${monthName(monthIndex)} did not return a list`);
  const start = new Date(from).getTime() - 60 * 60 * 1000;
  const end = new Date(to).getTime() + 60 * 60 * 1000;
  const outside = rows.find((row) => {
    const when = new Date(row.received || row.receivedDateTime || 0).getTime();
    return when < start || when >= end;
  });
  if (outside) {
    throw new Error(`${monthName(monthIndex)} came back with mail from ${outside.received || outside.receivedDateTime}. The flow is still using a fixed date. Update the page address, then run this again.`);
  }
  return rows;
}

const saved = JSON.parse(readFileSync(outFile, 'utf8'));
const byId = new Map((Array.isArray(saved) ? saved : []).map((row) => [row.id || row.messageId, row]));
const base = flowUrl();

for (let month = FIRST_MONTH; month <= LAST_MONTH; month += 1) {
  const rows = await pullMonth(base, month);
  rows.forEach((row) => byId.set(row.id || row.messageId, row));
  writeFileSync(outFile, JSON.stringify([...byId.values()]));
  console.log(`${monthName(month)}: ${rows.length} emails, ${byId.size} saved`);
}

console.log(`History saved. Reload the dashboard.`);
