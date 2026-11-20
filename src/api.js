import { makeMockRecords } from './mockData.js';

const FLOW_URL = import.meta.env.VITE_FLOW_URL;
export const usingMock = !FLOW_URL;
export const refreshSeconds = Number(import.meta.env.VITE_REFRESH_SECONDS) || 60;

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

export async function fetchRecords() {
  if (usingMock) {
    await new Promise((r) => setTimeout(r, 400));
    return makeMockRecords();
  }
  // Plain GET with no custom headers => no CORS preflight
  const res = await fetch(FLOW_URL);
  if (!res.ok) throw new Error(`Feed returned ${res.status}`);
  const json = await res.json();
  const rows = Array.isArray(json) ? json : json.emails ?? json.value ?? [];
  return rows.map(normalize);
}
