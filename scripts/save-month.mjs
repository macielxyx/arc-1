import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = resolve(root, 'public/mailbox.json');
const input = process.argv[2];

if (!input) {
  console.error('Usage: npm run save-month -- path/to/month.json');
  process.exit(1);
}

function rowsOf(value) {
  if (typeof value === 'string') return rowsOf(JSON.parse(value));
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.emails)) return value.emails;
  if (Array.isArray(value?.value)) return value.value;
  return null;
}

const incoming = rowsOf(JSON.parse(readFileSync(resolve(input), 'utf8')));
if (!incoming) throw new Error('That file is not a list of emails.');
const saved = rowsOf(JSON.parse(readFileSync(outFile, 'utf8'))) || [];
const byId = new Map(saved.map((row) => [row.id || row.messageId, row]));
incoming.forEach((row) => byId.set(row.id || row.messageId, row));
writeFileSync(outFile, JSON.stringify([...byId.values()]));
console.log(`${incoming.length} emails in this file, ${byId.size} saved to public/mailbox.json`);
