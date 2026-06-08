/// <reference types="@cloudflare/workers-types" />
/// <reference types="vite/client" />

// MacroBuddy relay — a single Cloudflare Worker that does two jobs:
//   1. serves the static pad (the Vite client build, via the ASSETS binding), and
//   2. runs the relay hub: one Durable Object per room, pairing the phone and the
//      laptop and fanning *binary* frames between them.
//
// In dev this same file runs inside Vite via @cloudflare/vite-plugin (real
// workerd + miniflare, fully local) so `npm run dev` exercises the exact code
// that ships. In prod, `wrangler deploy` from client/ ships one Worker.
//
// The relay is zero-knowledge by construction: it only ever sees the room id
// (for routing) and opaque ciphertext. The 256-bit secret lives in the URL hash
// and never reaches this code.

export interface Env {
  ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

type Role = 'host' | 'controller';

const ROOM_PATH = /^\/room\/([0-9a-f]{8,})$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(ROOM_PATH);
    if (match) {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected a WebSocket upgrade', { status: 426 });
      }
      const id = env.ROOM.idFromName(match[1]!);
      return env.ROOM.get(id).fetch(request);
    }

    // The pad's LAN transport calls /config + /action same-origin.
    if (url.pathname === '/config' || url.pathname === '/action') {
      // Dev: forward to the local Node server so a hash-less `localhost:5173`
      // works as the app. (Compiled out of the production bundle.)
      if (import.meta.env.DEV) {
        return fetch(new Request('http://localhost:3000' + url.pathname + url.search, request));
      }
      // Prod: this origin is the relay host (no LAN backend here). Tell a keyed
      // pad to use the WebSocket relay. (A keyless visitor never probes /config —
      // no hash → home page — so this is only ever seen by the keyed app.)
      return Response.json({ relay: true });
    }

    // Anything else is the static pad.
    return env.ASSETS.fetch(request);
  },
};

/**
 * One room. Pairs a `host` (laptop) and a `controller` (phone) and forwards the
 * binary frames between them. Uses the WebSocket Hibernation API so an idle room
 * costs nothing. Never inspects or decrypts a payload.
 */
export class Room implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    _env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const role = new URL(request.url).searchParams.get('role');
    if (role !== 'host' && role !== 'controller') {
      return new Response('role must be host or controller', { status: 400 });
    }
    // One socket per role: drop a stale one (e.g. a reconnecting laptop).
    for (const stale of this.state.getWebSockets(role)) stale.close(1012, 'replaced');

    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server, [role]); // tag it with its role
    const other = this.other(role);
    if (this.peer(other)) {
      this.notify(role, 'online');
      this.notify(other, 'online');
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    const role = this.roleOf(ws);
    if (!role || typeof message === 'string') return; // relay binary E2E frames only
    this.peer(this.other(role))?.send(message);
  }

  webSocketClose(ws: WebSocket): void {
    const role = this.roleOf(ws);
    if (role) this.notify(this.other(role), 'offline');
  }

  webSocketError(ws: WebSocket): void {
    this.webSocketClose(ws);
  }

  // --- helpers ---

  private roleOf(ws: WebSocket): Role | undefined {
    const tag = this.state.getTags(ws)[0];
    return tag === 'host' || tag === 'controller' ? tag : undefined;
  }
  private other(role: Role): Role {
    return role === 'host' ? 'controller' : 'host';
  }
  private peer(role: Role): WebSocket | undefined {
    return this.state.getWebSockets(role)[0];
  }
  private notify(role: Role, state: 'online' | 'offline'): void {
    this.peer(role)?.send(JSON.stringify({ t: 'peer', state }));
  }
}
