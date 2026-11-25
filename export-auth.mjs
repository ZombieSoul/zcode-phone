import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
const ctx = await chromium.launchPersistentContext("/home/dev/projects/zcode-phone/.profile", {
  headless: true, args: ["--disable-gpu"],
});
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto("https://zcode.z.ai/remote/v4", { waitUntil: "domcontentloaded", timeout: 20000 });
const auth = await page.evaluate(() => {
  const jwtEntry = localStorage.getItem("oauth:browser_session");
  let jwt = null;
  try { jwt = JSON.parse(jwtEntry)?.zcodeJwtToken ?? null; } catch {}
  return { cookies: document.cookie, jwt };
});
writeFileSync("/home/dev/projects/zcode-phone/.auth", JSON.stringify(auth));
console.log(`exported: jwt len=${auth.jwt?.length ?? 0}, cookies=${auth.cookies.split(";").length}`);
await ctx.close();
