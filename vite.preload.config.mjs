import { defineConfig } from 'vite';

/**
 * Preload-script Vite build.
 *
 * Preload runs in a sandboxed renderer context but can access a limited set
 * of Electron/Node APIs. We keep the same externalization strategy as
 * vite.main.config.mjs for consistency — anything the preload script uses
 * should be required at runtime, not bundled.
 */
export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        'electron',
        'path',
        'fs',
        'url',
      ],
    },
  },
});
