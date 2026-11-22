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
  const list = [];
  let id = 0;

  const push = (received, forcedOwner) => {
    const ageDays = (Date.now() - received) / DAY;
    const cats = [REQUEST_TYPES[Math.floor(Math.pow(r(), 1.6) * REQUEST_TYPES.length)]];
    if (r() < 0.25) cats.push(REQUEST_TYPES[Math.floor(r() * REQUEST_TYPES.length)]);
    const owner = forcedOwner || (r() < 0.95 ? owners[Math.floor(r() * owners.length)] : null);
    if (owner) cats.push(`Owner: ${owner}`);
    if (r() < 0.05) cats.push('VIP');
    if (r() < 0.08) cats.push('Awaiting Reply');
    const pendingChance = Math.max(0.04, 0.6 - ageDays * 0.02);
    const roll = r();
    let folder = 'Inbox';
    if (roll > pendingChance) folder = r() < 0.04 ? 'Deleted Items' : doneFolders[Math.floor(r() * doneFolders.length)];
    list.push({
      id: `mock-${id}`,
      messageId: `<mock-${id}@example>`,
      subject: `${subjects[Math.floor(r() * subjects.length)]} #${1000 + id}`,
      received: new Date(received).toISOString(),
      categories: [...new Set(cats)],
      folder,
    });
    id += 1;
  };

  // Every owner has mail in each month from January through June.
  for (let month = 0; month < 6; month += 1) {
    const days = new Date(2026, month + 1, 0).getDate();
    owners.forEach((owner, oi) => {
      const count = 7 + ((oi * 2 + month) % 5) + Math.floor(r() * 3);
      for (let k = 0; k < count; k += 1) {
        const day = 1 + Math.floor(r() * days);
        push(new Date(2026, month, day, 9, Math.floor(r() * 50)).getTime(), owner);
      }
    });
  }

  const start = new Date(2026, 6, 1, 9).getTime();
  const span = Math.max(DAY, Date.now() - start);
  for (let i = 0; i < 520; i += 1) push(start + r() * span);

  return list;
}
