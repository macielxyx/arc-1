import { rmSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { writeVersion } from './scripts/write-version.mjs';

const root = dirname(fileURLToPath(import.meta.url));

function versionPlugin() {
  return {
    name: 'app-version',
    buildStart() {
      writeVersion();
    },
    configureServer(server) {
      writeVersion();
      const refresh = (file) => {
        if (!file.includes(`${sep}mailbox${sep}`) || !file.endsWith('.json')) return;
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.add(join(root, 'mailbox'));
      server.watcher.on('add', refresh);
      server.watcher.on('change', refresh);
      server.watcher.on('unlink', refresh);
    },
    closeBundle() {
      rmSync('dist/mailbox.json', { force: true });
    },
  };
}

// base './' lets the built site work on GitHub Pages under any repo name
export default defineConfig({
  plugins: [versionPlugin(), react()],
  base: './',
});
