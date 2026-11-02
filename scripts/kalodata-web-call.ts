/**
 * Call one Kalodata web endpoint from inside a logged-in page (same as the web app does).
 *   npm run kalo:call -- <path> '<json body>'   (GET when body omitted)
 * Writes the full JSON to stdout.
 */
import { chromium } from "playwright";
import { SESSION_FILE } from "../src/lib/kalodata/web-client";

const [path, body] = process.argv.slice(2);
const browser = await chromium.launch();
const context = await browser.newContext({ storageState: SESSION_FILE, locale: "vi-VN" });
const page = await context.newPage();
await page.goto("https://www.kalodata.com/explore", { waitUntil: "domcontentloaded" });
const out = await page.evaluate(
  async ({ path, body }) => {
    const res = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json" },
      body: body ?? undefined,
      credentials: "include",
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  },
  { path, body },
);
process.stdout.write(JSON.stringify(out.json, null, 1));
await browser.close();
