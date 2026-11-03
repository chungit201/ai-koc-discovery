// Chụp màn hình các trang ở khổ điện thoại + báo chỗ tràn ngang.
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : ["/kocs", "/campaigns"];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

for (const path of PAGES) {
  await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(800);
  const over = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      // Chỉ báo phần tử TỰ nó tràn, không báo con nằm trong vùng cuộn ngang hợp lệ
      let scrollable = false;
      let p: HTMLElement | null = el.parentElement;
      while (p && !scrollable) {
        const ov = getComputedStyle(p).overflowX;
        // `hidden` cũng cắt phần thừa (vd `truncate`) → không phải tràn thật
        if (ov === "auto" || ov === "scroll" || ov === "hidden") scrollable = true;
        p = p.parentElement;
      }
      if (!scrollable && (r.right > vw + 1 || r.left < -1)) bad.push(`${el.tagName.toLowerCase()}.${el.className?.toString().slice(0, 60)} → ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    return { vw, scrollW: document.documentElement.scrollWidth, bad: [...new Set(bad)].slice(0, 6) };
  });
  const file = `.mobile${path.replace(/\//g, "_") || "_root"}.png`;
  await page.screenshot({ path: file, fullPage: process.env.FULL === "1" });
  console.log(`${path.padEnd(14)} viewport ${over.vw} · scrollWidth ${over.scrollW} ${over.scrollW > over.vw + 1 ? "← TRÀN NGANG" : "ok"} · ${file}`);
  for (const b of over.bad) console.log("   tràn:", b);
}

await browser.close();
