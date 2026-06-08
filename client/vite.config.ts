import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';

// The dev pad always opens with a key (the secret in the URL hash). Print that
// keyed link from Vite itself, using its ACTUAL listening port — so it stays
// correct even when Vite auto-bumps off a busy 5173 (e.g. a leftover dev server).
// The hash is base64url(secret); for the shared dev passphrase that mirrors the
// server's encodeSecret().
function devKeyedUrl(): Plugin {
  const secret = process.env.MACROBUDDY_SECRET ?? 'macrobuddy-dev';
  const hash = Buffer.from(secret).toString('base64url');
  return {
    name: 'macrobuddy:dev-keyed-url',
    apply: 'serve',
    configureServer(server) {
      const printUrls = server.printUrls.bind(server);
      server.printUrls = () => {
        printUrls();
        const addr = server.httpServer?.address();
        const port = addr && typeof addr === 'object' ? addr.port : (server.config.server.port ?? 5173);
        server.config.logger.info(`  \x1b[32m➜\x1b[0m  MacroBuddy pad (with key):  http://localhost:${port}/#${hash}`);
      };
    },
  };
}

// The cloudflare() plugin runs the relay Worker (worker/index.ts) + its Room
// Durable Object inside the Vite dev server via workerd + miniflare — so
// `npm run dev` serves the pad and the relay on one origin (ws://localhost:5173),
// fully local. In dev the Worker forwards /config + /action to the Node server
// (see worker/index.ts), so LAN mode works hash-less too. Dev binds localhost:
// the plugin's dev WebSocket proxying does not work on a LAN-IP host.
export default defineConfig({
  // 5173 by default; auto-bump (strictPort:false) to the next free port if it's busy.
  server: { port: 5173, strictPort: false },
  plugins: [react(), cloudflare(), devKeyedUrl()],
});
