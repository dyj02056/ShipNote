import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 개발 중에는 /api를 CLI 서버(4173)로 넘긴다.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:4173' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
