# MONITORING.md — zphone for unattended experiment monitoring

Runbook for using zphone as the "mouth" of a watchdog script during long
experiments (lab runs, overnight builds, fleet monitors).

## Pre-experiment checklist

1. **Update ZCode** (take minor updates — small jumps beat accumulated ones).
2. **Run the verification suite:**
   ```bash
   node zphone.mjs --status     # auth + handshake + RPC → all op=201
   node zphone.mjs "pre-flight ping"          # → status:"accepted"
   node zphone.mjs "pre-flight steer" --steer # → interrupt works
   ```
3. **Link freshness:** the link survives restarts and app updates (verified
   3.10.1→3.10.2). Only the desktop's **Stop** or **Refresh QR** buttons
   invalidate it. Regenerate only if you've pressed those: open the phone-icon
   dialog → copy the new link into `link.txt`.

## Verified durability (2026-09-02)

- Link age: 3h39m continuous, still authenticating
- Desktop restart + minor app update: link and protocol both survived,
  full suite green on the same `link.txt`

## Failure modes → meaning → action

| Symptom | Meaning | Action |
|---|---|---|
| Relay closes immediately / auth never completes | link invalidated (Stop/Refresh pressed) or desktop remote-control off | regenerate link via phone dialog; check dialog is open-enabled |
| `relay error: …` | rejected at relay | same as above |
| `status:"stale"` / `proto.staleRevision` (repeated) | target session very busy; retry loop exhausted | resend, or accept queue semantics (it'll deliver at turn end) |
| Connection refused / DNS failure | network or relay down | retry with backoff; check desktop app is running |
| `fault.command.clientMismatch` | zphone bug (clientId mismatch) | shouldn't happen; file issue |
| `handshakeRequired` | handshake order changed in an update | run `capture-steer.mjs`, diff against README protocol spec, patch |

## Delivery semantics (read the response)

- `"delivery":"queue"` — target was busy; message queued, delivers at turn end
- `"delivery":"startNow"` — target was idle; woke and processing now
- `--steer` — force-interrupt a busy target (two-phase `sendQueuedNow`)

## Contention rules

**One remote slot.** zphone, the browser page, and your phone cannot be
connected simultaneously — a connecting client kicks the previous one. Don't
run monitor sends while a human is using the phone/browser view.

## Post-update ritual (2 minutes, after any ZCode update)

```bash
node zphone.mjs --status && node zphone.mjs "post-update ping — disregard"
```

Green → protocol unchanged. Red → `node capture-steer.mjs`, decode
(`capture-steer.json`), diff vs README, patch constants. The captures in this
directory are the regression corpus.

## 2026-11-24: ZCode 4.0.0 broke the auth model — zphone v1 inoperative

- New links carry NO `hash` param; remote control now requires **account
  sign-in** (web client lands on a Sign In page; ws challenge key is issued
  by the signed-in session). Proven: HMAC proofs with empty/sid/mid keys
  all rejected; old link authenticates but routes dead (`relay error:
  INTERNAL`) because the desktop re-paired post-3.18.
- **Recovery path (zphone v2):** headed Playwright + persistent profile →
  one-time z.ai sign-in → capture new handshake → re-derive proof source →
  patch. Harness already exists (capture.mjs family).
- **Interim:** parent-session + session_recall recovers interrupted
  subagents without the relay.
