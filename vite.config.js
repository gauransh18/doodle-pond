import { defineConfig } from 'vite';

// In development, /api goes to `wrangler pages dev` (npm run pond) when it's running on 8788.
// Without it, the app finds no API and plays a local pond.
export default defineConfig({
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:8788', changeOrigin: true } },
  },
});
