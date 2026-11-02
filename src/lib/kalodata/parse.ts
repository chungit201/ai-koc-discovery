/**
 * Parse the display-formatted numbers the Kalodata web app returns (vi-VN locale):
 *   "₫2,97tỉ" → 2_970_000_000 · "257,1k" → 257_100 · "2,1tr" → 2_100_000
 *   "0.4%" → 0.004 · "₫0,00" → 0 · "-" / "" → null · numbers pass through
 */
const UNITS: Record<string, number> = { k: 1e3, tr: 1e6, "tỉ": 1e9, "tỷ": 1e9, n: 1e3, m: 1e6, b: 1e9 };

export function parseVnNumber(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;
  let s = input.trim().replace(/[₫\s]/g, "");
  if (!s || s === "-") return null;

  if (s.endsWith("%")) {
    const n = Number(s.slice(0, -1).replace(",", "."));
    return Number.isFinite(n) ? n / 100 : null;
  }

  const m = s.match(/^(-?[\d.,]+)([a-zA-Zỉỷ]*)$/);
  if (!m) return null;
  const [, num, unit] = m;
  const mult = unit ? UNITS[unit.toLowerCase()] : 1;
  if (mult === undefined) return null;
  // vi-VN: "." groups thousands, "," is the decimal mark
  s = num.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  // Round away float noise (257,1k → 257100, not 257100.00000000003)
  return Number.isFinite(n) ? Math.round(n * mult * 1e4) / 1e4 : null;
}

/** "1m 17s" → 77 */
export function parseDurationSec(input: unknown): number | null {
  if (typeof input === "number") return input;
  if (typeof input !== "string") return null;
  const m = input.match(/(?:(\d+)m)?\s*(?:(\d+)s)?/);
  if (!m || (!m[1] && !m[2])) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}
