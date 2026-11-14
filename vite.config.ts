import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  worker: { format: 'es' },
  server: {
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  preview: {
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  // No manualChunks on purpose: forcing three/r3f into named chunks drags React in with them and
  // makes the whole 3D stack part of the initial load. Rollup's own split keeps it behind lazy().
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
});
