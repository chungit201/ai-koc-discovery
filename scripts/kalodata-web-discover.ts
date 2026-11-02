/**
 * Record the internal JSON calls the Kalodata web app makes on given pages (uses saved session).
 *   npm run kalo:discover -- <url> [<url> ...]
 * Output: .auth/network/<n>.json  (request url, method, post body, response sample)
 */
import { chromium } from "playwright";
import { SESSION_FILE } from "../src/lib/kalodata/web-client";
import { mkdirSync, writeFileSync } from "node:fs";

const urls = process.argv.slice(2);
mkdirSync(".auth/network", { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ storageState: SESSION_FILE, locale: "vi-VN" });
const page = await context.newPage();
const calls: { page: string; url: string; method: string; body: string | null; status: number; sample: string }[] = [];
const SKIP = /sentry|google|naver|openai|aliyuncs|\/api\/log|configurations|\.(js|css|png|svg|woff)/;

page.on("response", async (res) => {
  const req = res.request();
  if (SKIP.test(req.url()) || !(res.headers()["content-type"] ?? "").includes("json")) return;
  const text = await res.text().catch(() => "");
  calls.push({ page: page.url(), url: req.url(), method: req.method(), body: req.postData(), status: res.status(), sample: text.slice(0, 4000) });
});

for (const url of urls) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(4000);
  // scroll to trigger lazy-loaded panels (audience, videos, products)
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(1200);
  }
}

writeFileSync(".auth/network/calls.json", JSON.stringify(calls, null, 1));
for (const c of calls) console.log(c.method, c.status, c.url.replace("https://www.kalodata.com", ""), c.body ? c.body.slice(0, 160) : "");
await browser.close();
