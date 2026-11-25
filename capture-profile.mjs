/** capture-profile.mjs — headless, signed-in (persistent profile), records the
 *  post-login handshake: ws frames, API calls, storage tokens. Output:
 *  capture-signed.json — the zphone v2 derivation corpus. */
import { writeFileSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const log = { sockets: {}, apis: [], storage: null, notes: [] };
const t0 = Date.now();
const note = (s) => { log.notes.push(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`); console.error(s); };

const ctx = await chromium.launchPersistentContext("/home/dev/projects/zcode-phone/.profile", {
  headless: true,
  ignoreDefaultArgs: ["--enable-automation"],
  args: ["--disable-blink-features=AutomationControlled", "--disable-gpu"],
});
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
});
const page = ctx.pages()[0] ?? await ctx.newPage();

page.on("websocket", (ws) => {
  const key = ws.url().replace(/[A-Za-z0-9_-]{15,}/g, "[T]");
  note(`WS OPEN: ${key}`);
  log.sockets[ws.url()] = { frames: [] };
  const rec = (dir) => (f) => {
    const d = typeof f.payload === "string" ? f.payload : `<bin ${f.payload?.length}>`;
    log.sockets[ws.url()].frames.push({ dir, t: Date.now() - t0, data: d.slice(0, 1200) });
  };
  ws.on("framesent", rec("→"));
  ws.on("framereceived", rec("←"));
  ws.on("close", () => note(`WS CLOSE: ${key}`));
});
page.on("response", async (r) => {
  const u = r.url();
  if (u.includes("zcode.z.ai/api") || u.includes("/api/")) {
    let body = "";
    try { body = (await r.text()).slice(0, 500); } catch {}
    log.apis.push({ t: Date.now() - t0, status: r.status(), url: u.slice(0, 150), body });
  }
});

note("loading (signed-in profile)…");
const LINK = readFileSync("/home/dev/ZCodeProject/link.txt", "utf-8").trim();
await page.goto(LINK, { waitUntil: "networkidle", timeout: 25000 }).catch((e) => note(`goto: ${e.message}`));
note(`title: ${await page.title().catch(() => "?")}`);

// storage snapshot — where sign-in tokens usually live
try {
  log.storage = await page.evaluate(() => ({
    localStorage: Object.fromEntries(Object.entries(localStorage).map(([k, v]) => [k, String(v).slice(0, 200)])),
    sessionStorage: Object.fromEntries(Object.entries(sessionStorage).map(([k, v]) => [k, String(v).slice(0, 200)])),
    cookieNames: document.cookie.split(";").map((c) => c.trim().split("=")[0]).filter(Boolean),
  }));
  note(`storage: ${Object.keys(log.storage.localStorage).length} local, ${log.storage.cookieNames.length} cookies`);
} catch (e) { note(`storage: ${e.message}`); }

await page.waitForTimeout(22000);   // let the full handshake + bootstrap play out
writeFileSync("/home/dev/projects/zcode-phone/capture-signed.json", JSON.stringify(log, null, 1));
const frames = Object.values(log.sockets).reduce((n, s) => n + s.frames.length, 0);
console.log(`DONE frames=${frames} apis=${log.apis.length}`);
await ctx.close();
