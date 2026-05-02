import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: resolve(__dirname),
  base: './',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
    modulePreload: false,
    assetsDir: 'assets',
    target: 'es2020',
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
});
