/**
 * Log in to the Kalodata web app with the account in .env.local and save the session.
 * Opens a visible browser: if Kalodata shows a captcha/OTP, complete it by hand.
 *
 *   npm run kalo:login
 */
import { chromium } from "playwright";
import { SESSION_FILE } from "../src/lib/kalodata/web-client";

// Crawler uses its own account so people can stay logged in on the web with the main account
const STATE = SESSION_FILE;
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ locale: "vi-VN" });
const page = await context.newPage();

await page.goto("https://www.kalodata.com/login", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

// Fill whatever phone/email + password inputs the login form shows
const user = process.env.KALODATA_WEB_USERNAME ?? "";
const pass = process.env.KALODATA_WEB_PASSWORD ?? "";
if (!user || !pass) throw new Error("Set KALODATA_WEB_USERNAME / KALODATA_WEB_PASSWORD (crawler account) in .env.local");
const phoneInput = page.locator('input[placeholder="Số điện thoại"], input[placeholder*="phone" i]').first();
const passInput = page.locator('input[type="password"]').first();
if (await passInput.count()) {
  await phoneInput.fill(user);
  await passInput.fill(pass);
  await page.locator('button[type="submit"]').first().click();
}

// Logged in once the app navigates away from /login. Report what's on screen while waiting.
const TIMEOUT_S = 90;
let loggedIn = false;
for (let i = 0; i < TIMEOUT_S; i++) {
  if (!page.url().includes("/login")) {
    loggedIn = true;
    break;
  }
  if (i % 10 === 0) {
    const msg = await page
      .locator('[class*="error" i], [class*="message" i], [role="alert"], [class*="captcha" i]')
      .allInnerTexts()
      .catch(() => []);
    console.log(`[${i}s] still on ${page.url()} ${msg.filter(Boolean).join(" | ").slice(0, 200)}`);
  }
  await page.waitForTimeout(1000);
}

if (loggedIn) {
  await page.waitForTimeout(2000);
  await context.storageState({ path: STATE });
  console.log(`✔ logged in → ${page.url()}\n  session saved to ${STATE}`);
} else {
  await page.screenshot({ path: ".auth/login-failed.png" });
  console.log(`✖ not logged in after ${TIMEOUT_S}s — screenshot at .auth/login-failed.png`);
}
await browser.close();
