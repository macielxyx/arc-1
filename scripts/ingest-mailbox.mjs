import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSealed, sealRecords } from '../src/lock.js';
import { MAILBOX_IDS, readMailboxFolders } from './read-mailbox.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function rowKey(row) {
  return String(row.messageId || row.internetMessageId || row.id || row.Id || '');
}

function jsonNames(id) {
  const dir = join(root, 'mailbox', id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.json'));
}

export async function ingestMailboxes(password) {
  const incoming = readMailboxFolders(root);
  const added = MAILBOX_IDS.reduce((sum, id) => sum + incoming[id].length, 0);
  if (!added) return { added: 0 };
  if (!password) {
    throw new Error('Add the MAILBOX_PASSWORD secret before uploading a mailbox file.');
  }

  for (const id of MAILBOX_IDS) {
    const fresh = incoming[id];
    if (!fresh.length) continue;
    const sealedPath = join(root, 'src', `mailbox.${id}.sealed.json`);
    let existing = [];
    if (existsSync(sealedPath)) {
      existing = await openSealed(JSON.parse(readFileSync(sealedPath, 'utf8')), password);
      if (!existing) throw new Error(`Could not open the encrypted ${id} mailbox.`);
    }
    const byId = new Map();
    for (const row of existing) byId.set(rowKey(row), row);
    for (const row of fresh) byId.set(rowKey(row), row);
    writeFileSync(sealedPath, JSON.stringify(await sealRecords([...byId.values()], password)));
    for (const name of jsonNames(id)) rmSync(join(root, 'mailbox', id, name));
    console.log(`Encrypted ${id}: ${fresh.length} uploaded rows, ${byId.size} stored.`);
  }
  return { added };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  ingestMailboxes(process.env.MAILBOX_PASSWORD)
    .then((result) => {
      if (!result.added) console.log('No new mailbox files.');
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
