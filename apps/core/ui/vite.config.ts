import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Forge Custom UI serves static files from a relative base.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'build', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 2000 },
});
