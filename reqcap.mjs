import { chromium } from "playwright";
const ctx = await chromium.launchPersistentContext("/home/dev/projects/zcode-phone/.profile", { headless: true, args: ["--disable-gpu"] });
const page = ctx.pages()[0] ?? await ctx.newPage();
page.on("request", (r) => {
  if (r.url().includes("/api/v1/remote/token")) {
    console.log("METHOD:", r.method());
    console.log("HEADERS:", JSON.stringify(Object.fromEntries(Object.entries(r.headers()).filter(([k]) => !k.startsWith(":")))) .slice(0, 400));
    console.log("BODY:", r.postData());
  }
});
await page.goto("https://zcode.z.ai/remote/v4?sid=d_EiTNUTCsPAkjhHf8vhFYWb&mid=3ecca06a-8ddd-47e4-99e6-da3f78023a26&name=DESKTOP-M2N0LHP&app_version=4.0.0", { waitUntil: "networkidle", timeout: 25000 }).catch(()=>{});
await page.waitForTimeout(6000);
await ctx.close();
