#!/usr/bin/env node
/**
 * zphone — browserless ZCode remote-control client (v1.1).
 *
 * Raw relay protocol: wss + HMAC challenge auth + bootstrap + workspace
 * bridge + binary TLV rpc-frames with crc32. Schema decoded from live
 * captures of the official web client (see capture-send.json).
 *
 * Usage:
 *   node zphone.mjs "<message>"            send to active task
 *   node zphone.mjs --status               connect, print hello + bootstrap
 */
import { readFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import { crc32 } from "node:zlib";

const link = readFileSync("/home/dev/ZCodeProject/link.txt", "utf-8").trim();
const q = Object.fromEntries(new URL(link).searchParams.entries());
const { sid, hash, mid, app_version } = q;

const args = process.argv.slice(2);
const STATUS = args.includes("--status");
const LIST_SESSIONS = args.includes("--sessions");
const SESSION_FLAG = args.indexOf("--session");
const TARGET_SESSION = SESSION_FLAG >= 0 ? args[SESSION_FLAG + 1] : null;
const MESSAGE = args.find((a, i) => !a.startsWith("--") && i !== SESSION_FLAG + 1) ?? null;
const WORKSPACE = args.find((a, i) => !a.startsWith("--") && i !== SESSION_FLAG + 1 && a.startsWith("/")) ?? "/home/dev/ZCodeProject";

const log = (s) => console.error(s);
const varint = (n) => { const o = []; do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; o.push(b); } while (n); return Buffer.from(o); };
const b64u = (b) => Buffer.from(b).toString("base64url");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── TLV frame codec (schema verified against captured frames) ──
function encodePromise(id, ns, method, argsObj) {
  const json = Buffer.from(JSON.stringify(argsObj));
  return Buffer.concat([
    Buffer.from([0x04, 0x04, 0x06]),
    varint(100),                      // op: Promise
    Buffer.from([0x06]), varint(id),  // field 6: id
    Buffer.from([0x01]), varint(ns.length), Buffer.from(ns, "utf8"),
    Buffer.from([0x01]), varint(method.length), Buffer.from(method, "utf8"),
    Buffer.from([0x04, 0x01]),        // field 4: expects-reply flag
    Buffer.from([0x05]), varint(json.length), json,
  ]);
}
function decodeFrame(raw) {
  // server: [04 02 06][op][06][id]([05][len][json] | [04][value]…)
  let i = 3; const rdVar = () => { let v = 0, s = 0, x; do { x = raw[i++]; v |= (x & 0x7f) << s; s += 7; } while (x & 0x80); return v; };
  const op = rdVar();
  let id = -1, json = null;
  while (i < raw.length) {
    const tag = raw[i++];
    if (tag === 0x06) id = rdVar();
    else if (tag === 0x05) { const len = rdVar(); json = raw.slice(i, i + len).toString("utf8"); i += len; }
    else if (tag === 0x04) rdVar();
    else if (tag === 0x01) { const len = rdVar(); i += len; }
    else break;
  }
  return { op, id, json };
}

// ── relay client ──
log(`[*] relay connect (mid=${mid.slice(0, 8)}…)`);
const ws = new WebSocket(`wss://zcode.z.ai/ws?mid=${mid}`);
let stage = "connect", bridge = null, outerSeq = 0, promiseId = 0;
const pending = new Map();
const state = { activeTaskId: null };

const send = (o) => { log(`> ${JSON.stringify(o).slice(0, 130)}`); ws.send(JSON.stringify(o)); };

function rpc(ns, method, args) {
  const id = ++promiseId;
  const frame = encodePromise(id, ns, method, args);
  const seq = ++outerSeq;
  send({ type: "data", payload: {
    zcode_type: "rpc-frame", bridgeSessionId: bridge.id, bridgeGeneration: 1,
    seq, messageSeq: seq, fragmentIndex: 0, fragmentCount: 1,
    messageBytes: frame.length,
    checksum: { algorithm: "crc32", value: (crc32(frame) >>> 0).toString(16).padStart(8, "0") },
    dataBase64: frame.toString("base64"),
  }});
  return new Promise((res) => pending.set(id, { res, method, t: Date.now() }));
}

ws.addEventListener("message", (ev) => {
  let m; try { m = JSON.parse(ev.data); } catch { return; }
  const t = m.type;
  if (t === "auth_challenge") {
    const proof = b64u(createHmac("sha256", Buffer.from(hash, "utf8")).update(`${m.nonce}|terminal|${sid}`).digest());
    send({ type: "auth_response", device_sid: sid, proof, client_ts: Date.now() });
  } else if ((t === "auth_ack" || t === "pair_status_ack") && stage === "auth") {
    stage = "paired"; log("[*] authenticated");
    send({ type: "data", payload: { zcode_type: "bootstrap-request", requestId: `bootstrap-${randomUUID()}` } });
  } else if (t === "data") {
    const pl = m.payload;
    if (pl?.requestId && pl.result?.initialViewState) {
      state.activeTaskId = pl.result.initialViewState.activeTaskId;
      log(`[*] bootstrap: activeTask=${state.activeTaskId.slice(0, 20)}…`);
      bridge = { id: `bridge-${randomUUID()}` };
      stage = "bridging";
      send({ type: "data", payload: {
        zcode_type: "workspace-bridge-open", requestId: `wb-${randomUUID()}`,
        bridgeSessionId: bridge.id, bridgeGeneration: 1,
        workspaceKey: WORKSPACE, taskId: state.activeTaskId,
      }});
    } else if (pl?.zcode_type === "rpc-frame" && bridge && stage === "ready") {
      const raw = Buffer.from(pl.dataBase64, "base64");
      const { op, id, json } = decodeFrame(raw);
      if (op === 201 || op === 202) {
        const p = pending.get(id);
        if (p) { pending.delete(id); p.res({ op, json, method: p.method }); }
      } else if (op === 204) {
        log(`[event] ${json?.slice(0, 160)}`);
      } else {
        log(`[frame op=${op} id=${id}] ${json?.slice(0, 120) ?? ""}`);
      }
    } else if ((pl?.zcode_type === "workspace-bridge-ack" || pl?.bridge?.bridgeSessionId) && stage === "bridging") {
      stage = "ready"; log("[*] bridge ready");
      main();
    }
  } else if (t === "error") {
    log(`[!] relay error: ${m.code}`); process.exit(1);
  }
});
ws.addEventListener("open", () => {
  stage = "auth";
  send({ type: "auth_init", role: "terminal", device_sid: sid,
    meta: { platform: "web", version: app_version ?? "web", name: "zphone" }, client_ts: Date.now() });
});
ws.addEventListener("close", (e) => { log(`[!] closed ${e.code} (stage=${stage})`); process.exit(0); });

async function main() {
  // conversation handshake (decoded from official client): hello → init → subscribe
  const clientId = `client-${randomUUID()}`;
  await rpc("zcode-agent", "helloConversationV4", {});
  const init = await rpc("zcode-agent", "initializeConversationV4", {
    kind: "clientHello", protocolVersion: 3, clientId,
    clientKind: "web", appVersion: "unknown",
    capabilities: { workspaceHookReviewUi: true },
  });
  log(`[*] hello → init ok (op=${init.op})`);

  if (LIST_SESSIONS) {
    const r = await rpc("zcode-task", "listTasks", { workspacePath: WORKSPACE });
    const tasks = r.json ? JSON.parse(r.json) : null;
    const list = Array.isArray(tasks) ? tasks : tasks?.tasks ?? tasks?.items ?? [tasks];
    if (Array.isArray(list)) {
      for (const t of list) {
        const id = t.taskId ?? t.id ?? t.sessionId ?? "?";
        const title = t.title ?? t.name ?? "";
        const upd = t.updatedAt ? new Date(t.updatedAt > 1e12 ? t.updatedAt : t.updatedAt * 1000).toISOString().slice(0, 16) : "";
        console.log(`${String(id).slice(0, 26).padEnd(28)} ${upd.padEnd(17)} ${String(title).slice(0, 60)}`);
      }
    } else {
      console.log(r.json?.slice(0, 1200));
    }
    process.exit(0);
  }

  const target = TARGET_SESSION ?? state.activeTaskId;
  const sub = await rpc("zcode-agent", "subscribeConversationV4",
    { workspacePath: WORKSPACE, sessionId: target });
  log(`[*] subscribed to ${target.slice(0, 22)}… (op=${sub.op})`);

  if (STATUS) {
    const r = await rpc("zcode-agent", "conversationRowsRangeV4",
      { workspacePath: WORKSPACE, sessionId: state.activeTaskId, beforeRowId: 9, limit: 2 });
    log(`[*] status RPC → op=${r.op}`);
    console.log((r.json ?? "(no json)").slice(0, 900));
    process.exit(0);
  }
  if (!MESSAGE) { log("no message given"); process.exit(0); }
  log(`[*] sending to ${target.slice(0, 22)}…`);
  const r = await rpc("zcode-agent", "sendConversationCommandV4",
    { workspacePath: WORKSPACE,
      envelope: { commandId: randomUUID(), clientId,
                  sessionId: target, type: "sendText",
                  payload: { text: MESSAGE }, issuedAt: Date.now() } });
  log(`[*] result: op=${r.op} ${r.json?.slice(0, 220) ?? "(empty)"}`);
  await wait(2500);
  process.exit(0);
}

setTimeout(() => { log("[!] 40s timeout"); process.exit(1); }, 40000);
