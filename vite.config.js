import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const pagine = ['index', 'annuncio', 'proponi', 'admin', 'privacy', 'cookie', 'condizioni'];

export default defineConfig({
  build: {
    rollupOptions: {
      input: Object.fromEntries(pagine.map((p) => [p, resolve(import.meta.dirname, `${p}.html`)])),
    },
  },
});
