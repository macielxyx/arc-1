// Mock mailbox records: same shape the Power Automate feed will return.
import { REQUEST_TYPES } from './config.js';

const owners = ['Eric Freeland', 'Jason Hurt', 'Maciel Garcia', 'Melissa Rodriguez', 'Polette Fierro', 'Seven Elder', 'Tonya Hall', 'Victoria Burk'];
const doneFolders = ['Completed', 'Completed/Invoice Adjustments', 'Completed/Customer Questions', 'Archive'];
const subjects = ['Invoice copy needed', 'Adjustment request', 'Updated PO attached', 'Question about charges', 'New tenant list', 'COI renewal', 'Remittance advice', 'Cancel service', 'Vendor form attached', 'Budget revision'];

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}
const DAY = 86400000;

export function makeMockRecords() {
  const r = rng(7);
  const start = new Date('2026-07-30T08:00:00Z').getTime();
  const span = Math.max(DAY, Date.now() - start);
  const list = [];
  for (let i = 0; i < 520; i++) {
    const received = start + r() * span;
    const ageDays = (Date.now() - received) / DAY;
    const cats = [REQUEST_TYPES[Math.floor(Math.pow(r(), 1.6) * REQUEST_TYPES.length)]];
    if (r() < 0.25) cats.push(REQUEST_TYPES[Math.floor(r() * REQUEST_TYPES.length)]);
    if (r() < 0.95) cats.push(`Owner: ${owners[Math.floor(r() * owners.length)]}`);
    if (r() < 0.05) cats.push('VIP');
    if (r() < 0.08) cats.push('Awaiting Reply');
    // older emails are far more likely to be filed
    const pendingChance = Math.max(0.04, 0.6 - ageDays * 0.02);
    const roll = r();
    let folder = 'Inbox';
    if (roll > pendingChance) folder = r() < 0.04 ? 'Deleted Items' : doneFolders[Math.floor(r() * doneFolders.length)];
    list.push({
      id: `mock-${i}`,
      messageId: `<mock-${i}@example>`,
      subject: `${subjects[Math.floor(r() * subjects.length)]} #${1000 + i}`,
      received: new Date(received).toISOString(),
      categories: [...new Set(cats)],
      folder,
    });
  }
  return list;
}
