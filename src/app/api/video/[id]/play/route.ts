import { MediaError, invalidateVideo, mediaCandidates, resolveVideo } from "@/lib/tiktok-media";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const PASS_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"];

/**
 * Streams the video's MP4 through this server (with HTTP Range, so the player can seek).
 * The browser never talks to TikTok's CDN directly, which rejects hotlinked requests.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/video/[id]/play">) {
  const { id } = await ctx.params;
  if (!/^\d{8,25}$/.test(id)) return new Response("bad id", { status: 400 });

  let media;
  try {
    media = await resolveVideo(id);
  } catch (err) {
    const e = err as MediaError;
    return Response.json({ error: e.message }, { status: e.status ?? 502 });
  }

  const range = req.headers.get("range");
  for (const url of mediaCandidates(media)) {
    try {
      const upstream = await fetch(url, {
        headers: { "user-agent": UA, ...(range ? { range } : {}) },
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      const type = upstream.headers.get("content-type") ?? "";
      if (!upstream.ok || !upstream.body || !(type.startsWith("video/") || type.includes("octet-stream"))) continue;
      const headers = new Headers({ "cache-control": "private, max-age=3600" });
      for (const h of PASS_HEADERS) {
        const v = upstream.headers.get(h);
        if (v) headers.set(h, h === "content-type" && !type.startsWith("video/") ? "video/mp4" : v);
      }
      if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch {
      // try the next candidate
    }
  }

  // Every link failed: the signed URLs probably expired — drop the cache so the next press re-resolves
  await invalidateVideo(id);
  return Response.json({ error: "Không tải được video từ TikTok, thử lại sau" }, { status: 502 });
}
