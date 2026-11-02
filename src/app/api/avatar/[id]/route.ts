import { getDb } from "@/lib/db/mongo";
import { C } from "@/lib/db/collections";
import type { Binary } from "mongodb";

const GRADIENTS = [
  ["#38bdf8", "#2563eb"],
  ["#f472b6", "#f43f5e"],
  ["#a78bfa", "#4f46e5"],
  ["#fcd34d", "#f97316"],
  ["#34d399", "#0d9488"],
  ["#e879f9", "#9333ea"],
];

/** Stored avatar bytes; falls back to an initial-letter SVG so the UI never shows a broken image. */
export async function GET(req: Request, ctx: RouteContext<"/api/avatar/[id]">) {
  const { id } = await ctx.params;
  const db = await getDb();
  const doc = await db
    .collection<{ _id: string; content_type: string; data: Binary }>(C.avatars)
    .findOne({ _id: id });
  if (doc) {
    return new Response(Buffer.from(doc.data.buffer), {
      headers: { "content-type": doc.content_type, "cache-control": "public, max-age=604800, immutable" },
    });
  }

  const name = (new URL(req.url).searchParams.get("n") ?? "?").replace(/^@/, "");
  const letter = (name[0] ?? "?").toUpperCase().replace(/[<>&"]/g, "");
  const [a, b] = GRADIENTS[[...name].reduce((s, ch) => s + ch.charCodeAt(0), 0) % GRADIENTS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><text x="32" y="41" font-family="system-ui,sans-serif" font-size="26" font-weight="600" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
  // Short cache: once the real avatar is downloaded it should replace this placeholder
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=300" } });
}
