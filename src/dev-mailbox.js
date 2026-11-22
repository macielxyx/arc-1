const txFiles = import.meta.glob('../mailbox/tx/*.json', { eager: true, import: 'default' });
const coFiles = import.meta.glob('../mailbox/co/*.json', { eager: true, import: 'default' });

function rowsOf(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.emails)) return value.emails;
  if (Array.isArray(value?.value)) return value.value;
  return [];
}

function rowsFrom(files) {
  return Object.keys(files).sort().flatMap((path) => rowsOf(files[path]));
}

export function devMailboxRows() {
  return { tx: rowsFrom(txFiles), co: rowsFrom(coFiles) };
}
