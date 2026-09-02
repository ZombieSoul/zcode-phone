# zphone

**Scriptable messaging for ZCode sessions — speak the Remote Control relay protocol directly, no browser.**

A ~200-line Node script that connects to ZCode's web remote-control relay,
authenticates, opens a workspace bridge, and sends messages to **any session in
any workspace** — waking sleeping sessions with full context. Built for the
"overnight script needs to tell the agent something" problem: cron jobs, fleet
monitors, and CI can now message a specific coding session and get delivery
confirmation back.

```
your script ──► zphone ──► z.ai relay ──► desktop ──► the session you chose
                                                     (wakes with full context)
```

## Usage

```bash
# discover sessions (any workspace)
node zphone.mjs --sessions
node zphone.mjs --sessions --workspace /home/dev/projects/luanti

# send to the active session
node zphone.mjs "build broke — logs at /tmp/3am.log"

# send to a specific session (the browser's session-picker, scripted)
node zphone.mjs "test run failed" --session sess_xxx --workspace /path/to/proj

# force-steer a BUSY session (interrupts the running turn, like the UI's Steer button)
node zphone.mjs "STOP — new priority, drop everything" --steer
```

The response tells you what happened:

| `delivery` | meaning |
|---|---|
| `"queue"` | session was busy — message queued, handled at turn end |
| `"startNow"` | session was sleeping — woke and started processing |

## Getting the link (the credential)

Remote Control's connection link **is** the auth: open the phone-icon dialog in
ZCode (Mobile Remote Control), copy the link, and save it to `link.txt`. The
script reads it for `sid`, `hash`, `mid`, `app_version`.

- Treat `link.txt` as a bearer key — it is gitignored here, keep it that way.
- Refreshing the QR in the desktop dialog invalidates the old link (that's your
  kill-switch). Generate a fresh `link.txt` after refreshing.

## How it works (the protocol, reverse-engineered)

Every layer was extracted from the official web client (`zcode.z.ai/remote/v4`)
and verified against live captures:

1. **Transport** — `wss://zcode.z.ai/ws?mid=<machine-id>`
2. **Auth** — challenge/response: server sends `nonce`, client proves with
   `HMAC-SHA256(key=<hash param>, msg="nonce|terminal|<sid>")`, base64url
3. **Bootstrap** — `bootstrap-request` returns workspaces + active task
4. **Bridge** — `workspace-bridge-open` per connection
5. **Framing** — binary TLV inside base64 `rpc-frame` envelopes, crc32-checked:
   `[04 04 06][varint op][06 id][01 ns][01 method][04 01][05 json]`
   ops: `100` Promise · `102` EventListen · `201` PromiseSuccess · `202` PromiseError
6. **Conversation handshake** — `helloConversationV4` → `initializeConversationV4
   {kind:"clientHello", protocolVersion:3, clientId}` → `subscribeConversationV4
   {sessionId}` — the envelope's `clientId` must match the init (else
   `fault.command.clientMismatch`)
7. **Send** — `sendConversationCommandV4` with a `sendText` envelope naming the
   target `sessionId`

The capture harness (`capture.mjs`, `capture-send.mjs` — Playwright) drove the
real client to produce the frame corpus used to decode all of the above.

## Caveats

- Rides an undocumented-but-sanctioned surface (the product's own remote-control
  channel). App updates may change the protocol; the frame corpus lives in
  `capture-*.json` (gitignored, local only) to re-derive against.
- One remote connection at a time — while zphone is connected, the phone/browser
  page can't be.
- `--read` mode (scrape replies back into the script) is straightforward future
  work — `subscribeConversationV4` is already wired in the handshake.
- **Steer is implemented** (v1.2): a two-phase sequence decoded from the web
  client's Steer button — send normally (queues), then a second
  `sendConversationCommandV4` with `type:"sendQueuedNow"` and
  `payload:{queueItemId: "queue_<commandId>"}`, with a stale-revision retry
  (the host uses optimistic concurrency and hands back the fresh revision on
  `proto.staleRevision`).

## Requirements

- Node.js ≥ 22 (native `WebSocket`, `zlib.crc32`)
- ZCode desktop running and reachable, with a Remote Control link in `link.txt`
- Zero npm dependencies for zphone itself (Playwright only for the capture harness)

## License

MIT
