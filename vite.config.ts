import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the built game runs from any folder or static host.
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
