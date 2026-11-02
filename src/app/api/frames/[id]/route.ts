import { readFile } from "node:fs/promises";
import { sheetPath } from "@/lib/media/frames";

/** Keyframe sheet used by S4 (4 frames side by side) — shown in the UI as visual evidence. */
export async function GET(_req: Request, ctx: RouteContext<"/api/frames/[id]">) {
  const { id } = await ctx.params;
  if (!/^\d{8,25}$/.test(id)) return new Response("bad id", { status: 400 });
  try {
    const buf = await readFile(sheetPath(id));
    return new Response(new Uint8Array(buf), { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
