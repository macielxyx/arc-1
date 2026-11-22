import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sealRecords } from '../src/lock.js';
import { MAILBOX_IDS, readMailboxFolders } from './read-mailbox.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const password = process.env.MAILBOX_PASSWORD;

if (!password) {
  console.error('Set MAILBOX_PASSWORD, then run this again.');
  process.exit(1);
}

const folders = readMailboxFolders(root);
for (const id of MAILBOX_IDS) {
  const rows = folders[id];
  const sealed = await sealRecords(rows, password);
  writeFileSync(join(root, 'src', `mailbox.${id}.sealed.json`), JSON.stringify(sealed));
  console.log(`Sealed ${id}: ${rows.length} emails.`);
}
