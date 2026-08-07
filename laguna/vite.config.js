import { defineConfig } from 'vite';

export default defineConfig({
  // Vanilla ES-module build. UI overlays are plain HTML/CSS; no framework.
  server: {
    open: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  // Tailwind scans these for class names during build.
  // (PostCSS plugin reads tailwind.config.js automatically.)
});
