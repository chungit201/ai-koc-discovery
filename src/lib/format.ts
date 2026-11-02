const nf = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

/** 34_510_000_000 → "34,5 tỉ" · 1_750_000 → "1,8 tr" · 25_400 → "25,4k" */
export function compact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${nf.format(v / 1e9)} tỉ`;
  if (abs >= 1e6) return `${nf.format(v / 1e6)} tr`;
  if (abs >= 1e3) return `${nf.format(v / 1e3)}k`;
  return nf.format(v);
}

export const vnd = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `₫${compact(v)}`);

export function pct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return `${(v * 100).toFixed(digits).replace(".", ",")}%`;
}

export function dateTime(d: Date | string | null | undefined): string {
  if (!d) return "–";
  return new Date(d).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

export const tiktokProfile = (handle: string) => `https://www.tiktok.com/${handle.startsWith("@") ? handle : `@${handle}`}`;
export const tiktokVideo = (handle: string, videoId: string) => `${tiktokProfile(handle)}/video/${videoId}`;
