import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { ConfigStore } from './config.js';
import { dispatch } from './dispatch.js';
import type { ActionRequest } from './types.js';

export function createApp(store: ConfigStore, clientDist: string): express.Express {
  const app = express();
  app.use(express.json());

  // HEAD /config is the connectivity heartbeat (the LED) — no body, no auth.
  app.head('/config', (_req, res) => {
    res.status(200).end();
  });

  // GET /config requires the key-derived token (the pad always opens with a key).
  app.get('/config', (req, res) => {
    const required = store.token();
    if (required && req.header('x-mb-token') !== required) {
      res.status(401).json({ error: 'invalid or missing key' });
      return;
    }
    res.json(store.publicConfig());
  });

  app.post('/action', async (req, res) => {
    const { keys, gesture, token } = (req.body ?? {}) as Partial<ActionRequest>;
    const result = await dispatch(store, keys ?? [], gesture ?? 'tap', token);
    res.status(result.status).json({ ok: result.ok, error: result.error });
  });

  // Static client + SPA fallback. (Express 5: a bare app.get('*') is invalid
  // under path-to-regexp@8 — a plain `use` avoids the pitfall entirely.)
  // Cache policy: hashed assets are immutable; index.html must always
  // revalidate, otherwise Safari heuristically caches it and keeps loading
  // old bundles after rebuilds.
  app.use(
    express.static(clientDist, {
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );
  const indexHtml = path.join(clientDist, 'index.html');
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (!fs.existsSync(indexHtml)) {
      return res.status(503).send('Client not built — run `npm run build` first.');
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });

  return app;
}
