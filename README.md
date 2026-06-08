# MacroBuddy

Turn your phone into a macro pad for your computer, over local WiFi.

A small Node server runs on the host (macOS or Windows), reads `macropad.yaml`,
and serves a single-page webapp. Open it on your phone, tap a key, and the host
sends a hotkey to the focused app or runs a script. The default pad replicates
a 4×4 hardware macro pad — dark keys, blue accents, heroicons.

## Quick start

```sh
npm install
npm run build      # build the client once
npm start          # start the server
```

The terminal prints a QR code — scan it with your phone (same WiFi) and the pad
opens in the browser. The plain URL is printed underneath as a fallback.

> **macOS**: the first hotkey press triggers an Accessibility permission prompt
> (System Settings → Privacy & Security → Accessibility) — allow your terminal.
>
> **Both OSes**: allow the firewall prompt so the phone can reach the server.

## Configuration — `macropad.yaml`

One YAML file defines the whole pad, in two sections: **`keys`** (what each
button looks like and where it sits) and **`macros`** (what they do). The file
hot-reloads: edit it while the server runs, then re-focus the page on your
phone (or pull-to-refresh) to see changes. Invalid edits are logged and the
last good config keeps serving.

```yaml
comboWindow: 150       # ms to collect more keys into a combo
doubleTapWindow: 250   # ms gap for a double-tap / how long a tapped modifier stays armed
holdThreshold: 350     # ms a press becomes a hold

layout:
  cols: 4              # grid columns
  rows: 4              # grid rows

keys:
  - id: 1                  # required numeric id, unique
    label: Tests           # optional text
    icon: beaker           # optional heroicons *24/solid* name (kebab-case)
    color: "#3273f5"       # optional CSS color
    shape: circle          # optional: square (default) | circle
    col: 1                 # grid column start (1-based)
    row: 1                 # grid row start (1-based)
    colSpan: 2             # optional, default 1
    rowSpan: 1             # optional, default 1
  - id: 9
    icon: clipboard
    col: 3
    row: 1
  - id: 4
    modifier: true         # a combo root (see below)
    icon: cog-6-tooth
    col: 4
    row: 1
  - spacer: true           # renders empty — fills a grid cell for alignment
    col: 2
    row: 1

macros:
  - keys: [1]                       # one id = a single key (gesture defaults to tap)
    action: { type: hotkey, keys: "cmd+shift+t" }
  - keys: [9], on: tap              # the same key can bind three gestures…
    action: { type: hotkey, keys: "cmd+c" }
  - keys: [9], on: double
    action: { type: hotkey, keys: "cmd+shift+c" }
  - keys: [9], on: hold
    action: { type: hotkey, keys: "cmd+x" }
  - keys: [4], on: double           # a modifier's own action (double-tap only)
    action: { type: hotkey, keys: "cmd+comma" }
  - keys: [4, 9]                    # a combo: modifier 4 + key 9 held together
    action: { type: script, run: python, path: ./scripts/deploy.py, args: ["--prod"] }
```

- **Keys** define presentation + position; each real key needs a unique
  **numeric `id`**. `spacer: true` renders empty space (no id/action). A
  `modifier: true` key is a combo root (below). Cells with no key are blank.
- **Single-key macros** bind one id with a gesture — `on: tap` (default),
  `double`, or `hold`. A key can define all three.
- **Combos** bind several ids: **exactly one modifier + one or more normal
  keys**, held together (no `on`). Engage the modifier by **holding or tapping**
  it, then press the other key(s). A modifier can't have its own tap/hold
  action — but its **double-tap** can.
- If two macros bind the same keys + gesture, the **last one wins**.
- **Timing** (ms): `comboWindow` collects combo keys; `doubleTapWindow` is the
  double-tap gap (and modifier latch time); `holdThreshold` is the hold
  duration. Pressing a key always plays its sound and animates **instantly** —
  only the resolved action waits on these.

Icon names come from [heroicons](https://heroicons.com) (solid set), e.g.
`bolt`, `magnifying-glass`, `squares-2x2`.

### Hotkeys

`keys` is a `+`-separated combo. `cmd` is OS-agnostic: it presses **⌘ on
macOS** and **Ctrl on Windows**, so one config works on both.

| Group | Tokens |
|---|---|
| Modifiers | `cmd`/`command`/`win`/`meta`/`super`, `ctrl`, `shift`, `alt`/`option`/`opt` |
| Letters / digits | `a`–`z`, `0`–`9` |
| Function | `f1`–`f24` |
| Named | `enter`, `tab`, `esc`, `space`, `backspace`/`delete`, `forwarddelete`, `insert`, `up`/`down`/`left`/`right`, `home`, `end`, `pageup`, `pagedown` |
| Punctuation | `comma`, `period`, `slash`, `backslash`, `semicolon`, `quote`, `minus`, `equal`, `leftbracket`, `rightbracket`, `grave`/`backtick` |
| Media | `mute`, `volumeup`, `volumedown`, `playpause`, `nexttrack`, `prevtrack` |

Hotkeys are sent with the prebuilt native bindings
[`@nut-tree-fork/libnut-*`](https://www.npmjs.com/package/@nut-tree-fork/libnut-darwin)
(nut-js's engine, used directly — nothing compiles at install time). They are
**optional** dependencies: if they can't load (e.g. on a headless box)
everything else still works and hotkey presses return a clear error.

### Scripts

Scripts cover everything beyond hotkeys — paste a prompt, focus a window,
deploy. They run with the host's user privileges:

- `bash` — macOS/Linux (Windows needs Git Bash/WSL on PATH)
- `pwsh` — PowerShell 7+ (on older Windows, alias `pwsh` to `powershell.exe`)
- `python` — runs `python3` on macOS/Linux, `python` on Windows

The server responds as soon as the script is spawned; output and exit codes are
logged in the server terminal.

## Fullscreen & themes on the phone

- The top bar has a light/dark **switch** (remembered on the device) and a
  **fullscreen toggle** — tap to enter, tap again to exit (uses the
  webkit-prefixed API on iOS Safari where needed).
- **iPhone alternative**: **Share → Add to Home Screen** — opening from the
  home-screen icon hides all browser chrome.

## Remote access — other networks (optional)

LAN mode needs the phone and laptop on the same network. On locked-down WiFi
(many corporate / university / public networks isolate clients) that isn't
possible. An **optional relay** lifts that restriction: the pad is served from a
public host and your laptop connects *out* to it — no inbound port, no shared
network. It's a hot-swappable transport; the LAN path is untouched and used
whenever you scan the LAN QR.

**How it stays secure.** On start the laptop mints a fresh 256-bit secret and
prints a second QR — `https://<host>/#<secret>`. The secret rides in the URL
**hash**, which browsers never send over the network, so it never reaches the
relay. From it, the phone and the laptop each derive (HKDF-SHA-256):

- a **room id** — public, routes the WebSocket to the right room, and
- an **AES-256-GCM key** — private, encrypts every message.

The relay only ever sees the room id and **ciphertext**; it can't read your
keypresses or config. Possession of the secret *is* the authorization — only a
peer that has it can produce frames the laptop accepts. The secret is **fresh
per server start**, so re-scan after a restart.

> The one trust assumption: whoever hosts the static pad serves its JavaScript.
> Host it yourself (you control the deploy) to keep the chain end-to-end.

**The relay is a Cloudflare Worker** (`client/worker/index.ts` + `client/wrangler.jsonc`)
that serves the pad and runs one Durable Object per room. It runs locally in dev
and ships with one command.

*Try it locally* — no Cloudflare account needed:

```sh
npm install
npm run dev          # Node server (:3000) + Vite (:5173)
```

`http://localhost:5173/` is the **home page** (no key → landing page, everywhere).
The pad always needs the key: the server prints a keyed URL
(`http://localhost:5173/#<secret>` — "With hot reload") that opens the app over
plain HTTP, so default `npm run dev` never touches the relay (works on any Node).
To test the **WebSocket relay** locally, `npm run dev:relay` runs the Worker +
Durable Object inside Vite (via `@cloudflare/vite-plugin` / `workerd`) — that path
needs Node 22/24 LTS (see Development).

*Deploy it* — to use the pad off your own network (one-time setup):

1. **Build:** `npm run build` — emits the pad (`client/dist/client`) + the Worker
   (`client/dist/macrobuddy_relay`).
2. **Sign in (once):** `cd client && npx wrangler login`.
3. **Ship it:** `npm run deploy` (= `wrangler deploy` from `client/`). The Worker
   serves the pad + relay at your domain (production: `https://macrobuddy.dev`).
4. **Run the host:** `npm start` — it connects to `https://macrobuddy.dev` by
   default, so both QRs print (the gray LAN one at home, the purple live one
   anywhere). Point it elsewhere with `MACROBUDDY_RELAY_APP_URL=https://…`, or set
   it empty (`MACROBUDDY_RELAY_APP_URL=`) for LAN-only.

The home page's one-command install is served from the app itself
(`uv run https://macrobuddy.dev/setup.py` → `client/public/setup.py`); the script
clones the public repo at `github.com/micha31r/macrobuddy`. Forking? Change the
`https://macrobuddy.dev` default in `server/src/index.ts`, the install URL in
`client/src/HomeScreen.tsx`, and `REPO` in `client/public/setup.py`.

## Security

- **LAN only — never expose this server to the internet.** It executes
  scripts and keystrokes on your machine by design.
- Only load config files you trust; `script` actions run arbitrary code.
- **The pad always requires the key.** Each start mints a 256-bit secret and puts
  it in the QR's URL hash (`/#…`) — which browsers never send on the wire. From it
  the phone derives a token it sends with every request; the server verifies it
  (a keyless or wrong-key visitor gets the home page / a 401, never the pad).
  `MACROBUDDY_SECRET=<passphrase>` pins a stable key across restarts (handy in dev).
- **Remote access keeps these guarantees**: the laptop only ever *dials out* to
  the relay (nothing inbound), and the relay sees only ciphertext (see
  [Remote access](#remote-access--other-networks-optional)). There the 256-bit
  hash secret is the authorization, so the token is optional.

## Troubleshooting

- **Hotkeys return "hotkey support unavailable"** — almost always a
  `node_modules` installed on a different OS than the one running the server
  (e.g. installed inside a dev container/WSL, then run on the host). Native
  binaries (the libnut bindings, esbuild) are per-platform. Fix on the machine
  that runs the server:

  ```sh
  rm -rf node_modules && npm install
  ```

- **Hotkeys silently do nothing on macOS** — grant Accessibility permission to
  your terminal app (System Settings → Privacy & Security → Accessibility);
  the first hotkey press requests it.

## Development

```sh
npm run dev        # Node server (:3000) + Vite (:5173) — keyed HTTP app, no relay
npm run dev:relay  # …plus the relay Worker + Durable Object inside Vite (Node 22/24)
npm test           # unit tests: crypto, config/gestures, input controller, relay, auth
npm run typecheck  # strict TS across the workspaces (incl. the Worker)
npm run deploy     # wrangler deploy the relay Worker (from client/)
```

`npm run dev` pins a stable dev key (`MACROBUDDY_SECRET=macrobuddy-dev`) and prints
a keyed `localhost:5173/#…` URL; the Vite Worker forwards `/config` + `/action` to
the Node server, so the keyed app runs over plain HTTP (no WebSocket → any Node).
Keyless `localhost:5173/` is the home page. Server CLI:
`npm start -- /path/to/other-config.yaml`, port via `PORT=8080`.

> **Node for `dev:relay`:** the in-Vite relay embeds Cloudflare's `miniflare`,
> which **crashes on Node 25** (an upstream `workers-sdk` bug — a WebSocket upgrade
> trips an assertion). Use **Node 22 or 24 LTS** for `npm run dev:relay` — `nvm use`
> picks it up from `.nvmrc`. Plain `npm run dev` (and the host, `npm start`) run on
> any Node ≥18; only the in-Vite relay path is affected.

Workspaces: `shared/` (the relay wire protocol + its E2E crypto), `server/`,
`client/`. The relay Worker lives in `client/worker/` with `client/wrangler.jsonc`;
`vite build` emits the pad (`dist/client`) and the Worker, and `npm run deploy`
ships them as one Cloudflare Worker — so dev and prod run identical code.

## Out of scope (v1)

No PWA/offline, no native app, no multi-host — per spec. (Remote access adds an
**optional, opt-in** WebSocket relay; LAN mode stays WebSocket-free.)
