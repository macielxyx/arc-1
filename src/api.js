import txSealed from './mailbox.tx.sealed.json';
import coSealed from './mailbox.co.sealed.json';
import { openSealed } from './lock.js';

const SEALED = { tx: txSealed, co: coSealed };

// Accepts a few likely field names from Power Automate so small naming
// differences don't break anything. Edit here if your feed differs.
function normalize(row, i) {
  const pick = (...keys) => keys.map((k) => row[k]).find((v) => v !== undefined && v !== null && v !== '');
  let cats = pick('categories', 'Categories') ?? [];
  if (typeof cats === 'string') cats = cats.split(/[;,]/); // "A; B" or "A, B"
  return {
    id: String(pick('id', 'Id') ?? `row-${i}`),
    messageId: pick('messageId', 'internetMessageId', 'InternetMessageId') ?? null,
    subject: pick('subject', 'Subject') ?? '',
    received: pick('received', 'receivedDateTime', 'receivedDate', 'DateTimeReceived'),
    categories: cats.map((c) => String(c).trim()).filter(Boolean),
    folder: String(pick('folder', 'folderPath', 'Folder') ?? ''),
  };
}

export function recordsFrom(list) {
  const byId = new Map();
  list.forEach((row, i) => {
    const record = normalize(row, i);
    byId.set(record.messageId || record.id, record);
  });
  return [...byId.values()];
}

export async function openMailbox(password) {
  const opened = {};
  for (const [id, sealed] of Object.entries(SEALED)) {
    const rows = await openSealed(sealed, password);
    if (!rows) return null;
    opened[id] = rows;
  }
  const source = import.meta.env.DEV ? (await import('./dev-mailbox.js')).devMailboxRows() : opened;
  return {
    tx: recordsFrom(source.tx || []),
    co: recordsFrom(source.co || []),
  };
}
