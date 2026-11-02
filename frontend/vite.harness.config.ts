import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// TEMPORARY headless-test config. Builds the real app sources with a
// MemoryRouter harness entry for file:// screenshot verification.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '.harness-dist',
    emptyOutDir: true,
    rollupOptions: { input: '.harness/index.html' },
  },
});
