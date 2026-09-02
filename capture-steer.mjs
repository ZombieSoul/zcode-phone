/**
 * capture-steer.mjs — send a message from the page (session busy → queues),
 * then find & click the Steer button, capturing every ws frame.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const LINK = readFileSync("/home/dev/ZCodeProject/link.txt", "utf-8").trim();
const MSG = "steer capture test — disregard";

const log = { sockets: {}, notes: [], buttons: [] };
const t0 = Date.now();
const FLUSH = () => writeFileSync("/home/dev/projects/zcode-phone/capture-steer.json", JSON.stringify(log, null, 1));
const note = (s) => { log.notes.push(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`); console.error(s); FLUSH(); };

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();

page.on("websocket", (ws) => {
  log.sockets[ws.url()] = { frames: [] };
  const rec = (dir) => (f) => {
    const d = typeof f.payload === "string" ? f.payload : `<bin ${f.payload?.length}>`;
    log.sockets[ws.url()].frames.push({ dir, t: Date.now() - t0, data: d.slice(0, 1400) });
    FLUSH();
  };
  ws.on("framesent", rec("→"));
  ws.on("framereceived", rec("←"));
});

note("loading");
await page.goto(LINK, { waitUntil: "networkidle", timeout: 20000 }).catch((e) => note(`goto ${e.message}`));
await page.waitForTimeout(6000);

// send a message from the page (queues because session is busy)
const input = page.locator("textarea, [contenteditable=true]").last();
await input.waitFor({ state: "visible", timeout: 10000 });
await input.fill(MSG);
await page.keyboard.press("Enter");
note("message sent — waiting for queue UI…");
await page.waitForTimeout(2500); FLUSH();

// enumerate buttons, find steer-ish
const btns = await page.locator("button").all();
for (const b of btns) {
  const txt = (await b.textContent().catch(() => "")).trim();
  const aria = await b.getAttribute("aria-label").catch(() => "");
  const title = await b.getAttribute("title").catch(() => "");
  if (txt || aria || title) log.buttons.push({ txt: txt.slice(0, 40), aria, title });
}
note(`buttons seen: ${log.buttons.length}`);
const steerSel = log.buttons.filter(b => b.txt === "Steer" || /\bsteer\b/i.test(b.aria ?? "") || /\bsteer\b/i.test(b.title ?? ""));
note(`steer-candidates: ${JSON.stringify(steerSel)}`);

if (steerSel.length) {
  const target = page.locator('button').filter({ hasText: /^Steer$/ }).first();
  await target.click().catch((e) => note(`click failed: ${e.message}`));
  note(`clicked steer button`);
  await page.waitForTimeout(1500); // steer interrupt may kill us — file already flushed
} else {
  note("no steer button found — dumping button list for diagnosis");
}

writeFileSync("/home/dev/projects/zcode-phone/capture-steer.json", JSON.stringify(log, null, 1));
const total = Object.values(log.sockets).reduce((n, s) => n + s.frames.length, 0);
console.log(`frames: ${total}; buttons: ${log.buttons.length}; notes: ${log.notes.length}`);
await browser.close();
