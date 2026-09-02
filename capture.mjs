/**
 * capture.mjs — load the remote-control link in headless Chromium, record
 * every websocket URL and frame + every API request, for 25s. Writes
 * capture-log.json next to this script.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const LINK = readFileSync("/home/dev/ZCodeProject/link.txt", "utf-8").trim();

const log = { apis: [], sockets: {}, notes: [] };
const t0 = Date.now();
const note = (s) => log.notes.push(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

// API calls
page.on("request", (r) => {
  if (r.url().includes("zcode.z.ai") && !r.url().match(/\.(js|css|png|svg|woff)/)) {
    log.apis.push({ t: Date.now() - t0, method: r.method(), url: r.url().slice(0, 200) });
  }
});
page.on("response", async (r) => {
  if (r.url().includes("/api/") && r.status() < 300) {
    try {
      const body = await r.text();
      log.apis.push({ t: Date.now() - t0, resp: r.url().slice(0, 150), status: r.status(), body: body.slice(0, 400) });
    } catch {}
  }
});

// WebSockets: url + frames
page.on("websocket", (ws) => {
  const id = ws.url().replace(/[A-Za-z0-9_-]{15,}/g, "[T]");
  note(`WS OPEN: ${id}`);
  log.sockets[ws.url()] = { frames: [] };
  ws.on("framesent", (f) => {
    const d = typeof f.payload === "string" ? f.payload : `<binary ${f.payload?.length ?? "??"}B>`;
    log.sockets[ws.url()].frames.push({ dir: "→", t: Date.now() - t0, data: d.slice(0, 800) });
  });
  ws.on("framereceived", (f) => {
    const d = typeof f.payload === "string" ? f.payload : `<binary ${f.payload?.length ?? "??"}B>`;
    log.sockets[ws.url()].frames.push({ dir: "←", t: Date.now() - t0, data: d.slice(0, 800) });
  });
  ws.on("close", () => note(`WS CLOSE: ${id}`));
});

page.on("console", (m) => { if (m.type() === "error") note(`console.error: ${m.text().slice(0, 150)}`); });

note(`loading link…`);
await page.goto(LINK, { waitUntil: "networkidle", timeout: 20000 }).catch((e) => note(`goto: ${e.message}`));
note(`page loaded, title=${await page.title().catch(() => "?")}`);

// give it time to pair + stream
await page.waitForTimeout(20000);

writeFileSync("/home/dev/projects/zcode-phone/capture-log.json", JSON.stringify(log, null, 1));
console.log(`apis: ${log.apis.length}, sockets: ${Object.keys(log.sockets).length}, notes: ${log.notes.length}`);
await browser.close();
