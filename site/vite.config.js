import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// The site reads ../results/*.json and ../uploads/processed_EP1.mp3 at build time, so every number on the page is generated, never typed.
export default defineConfig({
  base: '/SonicClear-AI-Studio-Grade-Audio-Enhancer/',
  plugins: [react()],
  server: { fs: { allow: ['..'] } },
});
