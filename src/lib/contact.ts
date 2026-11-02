/** Normalise a creator's contact fields: drop empty/junk values, label and link the real ones. */
const LABELS: Record<string, string> = {
  email: "Email",
  zalo: "Zalo",
  facebook: "Facebook",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  line: "Line",
  homepage: "Website",
};

export interface ContactItem {
  key: string;
  label: string;
  value: string;
  href: string | null;
}

export function contactItems(contact: Record<string, unknown> | null | undefined): ContactItem[] {
  const out: ContactItem[] = [];
  for (const [key, raw] of Object.entries(contact ?? {})) {
    const value = String(raw ?? "").trim();
    // Junk like "!!!", "-", "." carries no letters/digits → hide
    if (!value || !/[\p{L}\p{N}]/u.test(value)) continue;
    out.push({ key, label: LABELS[key] ?? key, value, href: hrefFor(key, value) });
  }
  return out;
}

function hrefFor(key: string, v: string): string | null {
  const url = /^https?:\/\//i.test(v) ? v : null;
  if (key === "email" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  if (url) return url;
  if (key === "facebook") return `https://www.facebook.com/${encodeURIComponent(v)}`;
  if (key === "instagram") return `https://www.instagram.com/${encodeURIComponent(v.replace(/^@/, ""))}`;
  if (key === "zalo" && /^\+?\d[\d\s.-]{7,}$/.test(v)) return `https://zalo.me/${v.replace(/\D/g, "")}`;
  if (key === "whatsapp" && /^\+?\d[\d\s.-]{7,}$/.test(v)) return `https://wa.me/${v.replace(/\D/g, "")}`;
  if (key === "homepage" && /^[\w-]+(\.[\w-]+)+/.test(v)) return `https://${v}`;
  return null;
}
