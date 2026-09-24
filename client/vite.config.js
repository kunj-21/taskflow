import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy keeps the SPA and API on one origin in dev, same as NGINX does in production,
// so the httpOnly refresh cookie just works.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
});
