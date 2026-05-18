import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        'electron',
        'path',
        'fs',
        'http',
        'music-metadata',
        'node-id3',
        // sql.js: kept both the bare name AND the sub-path. The bare name
        // is needed because Vite's externalization is exact-match by
        // default — `import('sql.js/dist/sql-asm.js')` will be kept
        // external thanks to the sub-path entry, but if anything in the
        // dependency chain (or a future change) reaches for plain
        // `sql.js`, we want that external too. Including both is
        // belt-and-suspenders and costs nothing.
        'sql.js',
        'sql.js/dist/sql-asm.js',
        // Discord RPC stack should stay runtime-resolved in Electron main.
        '@ryuziii/discord-rpc',
        'ws',
        'bufferutil',
        'utf-8-validate',
      ],
    },
  },
});
