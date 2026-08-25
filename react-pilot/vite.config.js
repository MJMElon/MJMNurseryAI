import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* Built with relative asset paths and emitted into app/, so the result is
   just files GitHub Pages serves — the same deployment the rest of the
   portal already uses. No server, no Node in production. */
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'app',
    emptyOutDir: true,
    sourcemap: false        // deliberately off — see README, "What Inspect shows"
  }
});
