import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MAILBOX_IDS = ['tx', 'co'];

function rowsOf(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.emails)) return value.emails;
  if (Array.isArray(value?.value)) return value.value;
  return [];
}

export function readMailboxFolders(root) {
  const folders = {};
  for (const id of MAILBOX_IDS) {
    const dir = join(root, 'mailbox', id);
    if (!existsSync(dir)) {
      folders[id] = [];
      continue;
    }
    const names = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
    folders[id] = names.flatMap((name) => rowsOf(JSON.parse(readFileSync(join(dir, name), 'utf8'))));
  }
  return folders;
}
