// One page load: how does the Kalodata web app load creator avatars? (no credits, web session)
import { chromium } from "playwright";
import { SESSION_FILE } from "../src/lib/kalodata/web-client";

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: SESSION_FILE, locale: "vi-VN" });
const page = await context.newPage();
const imageReqs: string[] = [];
page.on("request", (r) => {
  if (r.resourceType() === "image") imageReqs.push(r.url());
});
await page.goto("https://www.kalodata.com/creator", { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForTimeout(3000);

// Avatars inside the creator table rows, with the handle shown next to them
const rows = await page.$$eval("tr", (trs) =>
  trs.slice(0, 6).map((tr) => {
    const img = tr.querySelector("img");
    const handle = [...tr.querySelectorAll("*")].map((e) => e.textContent?.trim() ?? "").find((t) => t.startsWith("@")) ?? "";
    return { handle: handle.split(/\s/)[0], src: img?.getAttribute("src") ?? "" };
  }),
);
console.log("table avatars:", JSON.stringify(rows.filter((r) => r.src), null, 1));
const hosts = [...new Set(imageReqs.map((u) => new URL(u).host))];
console.log("image hosts:", hosts);
console.log("sample image urls:\n" + imageReqs.filter((u) => u.includes("kalocdn")).slice(0, 12).join("\n"));
await browser.close();
