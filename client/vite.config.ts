import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The cloudflare() plugin runs the relay Worker (worker/index.ts) + its Room
// Durable Object inside the Vite dev server via workerd + miniflare — so
// `npm run dev` serves the pad and the relay on one origin (ws://localhost:5173),
// fully local. In dev the Worker forwards /config + /action to the Node server
// (see worker/index.ts), so LAN mode works hash-less too. Dev binds localhost:
// the plugin's dev WebSocket proxying does not work on a LAN-IP host.
export default defineConfig({
  plugins: [react(), cloudflare()],
});
