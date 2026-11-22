import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sealRecords } from '../src/lock.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'mailbox');
const password = process.env.MAILBOX_PASSWORD;

if (!password) {
  console.error('Set MAILBOX_PASSWORD, then run this again.');
  process.exit(1);
}

function rowsOf(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.emails)) return value.emails;
  if (Array.isArray(value?.value)) return value.value;
  return [];
}

const names = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
const rows = names.flatMap((name) => rowsOf(JSON.parse(readFileSync(join(dir, name), 'utf8'))));
const sealed = await sealRecords(rows, password);
writeFileSync(join(root, 'src/mailbox.sealed.json'), JSON.stringify(sealed));
console.log(`Sealed ${rows.length} emails from ${names.length} files.`);
