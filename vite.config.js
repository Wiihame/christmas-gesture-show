import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [],
  optimizeDeps: {
    include: ['@mediapipe/tasks-vision'],
  },
});
