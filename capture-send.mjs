/**
 * capture-send.mjs — load the link, type a test message into the session
 * input, send it, and capture the exact rpc-frame that carries it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const LINK = readFileSync("/home/dev/ZCodeProject/link.txt", "utf-8").trim();
const MSG = "protocol test — disregard";

const log = { sockets: {}, notes: [] };
const t0 = Date.now();
const note = (s) => log.notes.push(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();

page.on("websocket", (ws) => {
  log.sockets[ws.url()] = { frames: [] };
  const rec = (dir) => (f) => {
    const d = typeof f.payload === "string" ? f.payload : `<bin ${f.payload?.length}>`;
    log.sockets[ws.url()].frames.push({ dir, t: Date.now() - t0, data: d.slice(0, 1200) });
  };
  ws.on("framesent", rec("→"));
  ws.on("framereceived", rec("←"));
});

note("loading");
await page.goto(LINK, { waitUntil: "networkidle", timeout: 20000 }).catch((e) => note(`goto ${e.message}`));
await page.waitForTimeout(6000); // pair + bootstrap + session view render

note("looking for input…");
const input = page.locator("textarea, [contenteditable=true], input[type=text]").last();
await input.waitFor({ state: "visible", timeout: 15000 }).catch(() => note("no input found"));
const tag = await input.evaluate((el) => el.tagName).catch(() => "?");
note(`input: ${tag}`);
await input.fill(MSG).catch((e) => note(`fill: ${e.message}`));
await page.keyboard.press("Enter");
note("sent — capturing 6s of frames");
await page.waitForTimeout(6000);

writeFileSync("/home/dev/projects/zcode-phone/capture-send.json", JSON.stringify(log, null, 1));
const total = Object.values(log.sockets).reduce((n, s) => n + s.frames.length, 0);
console.log(`frames captured: ${total}; notes: ${log.notes.join(" | ")}`);
await browser.close();
