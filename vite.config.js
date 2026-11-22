import { rmSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { writeVersion } from './scripts/write-version.mjs';

function versionPlugin() {
  return {
    name: 'app-version',
    buildStart() {
      writeVersion();
    },
    configureServer() {
      writeVersion();
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
