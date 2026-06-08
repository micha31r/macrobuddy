import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';

/**
 * A minimal stand-in for the Cloudflare Durable Object used in tests: one room
 * per id, pairing a `host` and a `controller` socket and forwarding *binary*
 * frames between them. It never decrypts anything — exactly like the real
 * relay, which only sees room ids + ciphertext.
 */
export interface FakeRelay {
  url: string; // ws://127.0.0.1:<port>
  close: () => Promise<void>;
}

export function startFakeRelay(): Promise<FakeRelay> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  const rooms = new Map<string, { host?: WebSocket; controller?: WebSocket }>();

  wss.on('connection', (ws, req) => {
    const u = new URL(req.url ?? '', 'ws://x');
    const match = u.pathname.match(/^\/room\/([^/]+)$/);
    const role = u.searchParams.get('role');
    if (!match || (role !== 'host' && role !== 'controller')) {
      ws.close();
      return;
    }
    const roomId = match[1]!;
    const room = rooms.get(roomId) ?? {};
    rooms.set(roomId, room);
    room[role] = ws;
    const peerRole = role === 'host' ? 'controller' : 'host';

    // announce presence both ways (plaintext text frame — carries no secret)
    if (room[peerRole]) {
      room[peerRole]!.send(JSON.stringify({ t: 'peer', state: 'online' }));
      ws.send(JSON.stringify({ t: 'peer', state: 'online' }));
    }

    ws.on('message', (data, isBinary) => {
      const peer = room[peerRole];
      if (peer && peer.readyState === peer.OPEN) peer.send(data, { binary: isBinary });
    });
    ws.on('close', () => {
      if (room[role] === ws) delete room[role];
      room[peerRole]?.send(JSON.stringify({ t: 'peer', state: 'offline' }));
    });
  });

  return new Promise((resolve) => {
    wss.on('listening', () => {
      const { port } = wss.address() as AddressInfo;
      resolve({
        url: `ws://127.0.0.1:${port}`,
        close: () => new Promise((r) => wss.close(() => r())),
      });
    });
  });
}
