import "server-only";
import { getDb } from "./db/mongo";
import { C } from "./db/collections";

/**
 * Resolve a TikTok video to a playable MP4 the same way D:/projects/SEO/video-downloader does:
 * tikwm's public parser (https://www.tikwm.com/api/?hd=1&url=…). Called only when someone presses
 * play, cached in `video_media`, and serialized to ~1 request/second (tikwm's free rate limit).
 */
const RESOLVER = process.env.SHORTFORM_RESOLVER_URL ?? "https://www.tikwm.com/api/";
const CACHE_MS = 3 * 3_600_000; // TikTok CDN links are signed and expire after a few hours
const MIN_GAP_MS = 1100;

export interface VideoMedia {
  _id: string;
  play?: string;
  hdplay?: string;
  cover?: string;
  duration?: number;
  fetched_at: Date;
}

let lastCall = 0;
let queue: Promise<unknown> = Promise.resolve();

export class MediaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function resolveVideo(videoId: string): Promise<VideoMedia> {
  const db = await getDb();
  const cache = db.collection<VideoMedia>(C.videoMedia);
  const hit = await cache.findOne({ _id: videoId });
  if (hit && Date.now() - hit.fetched_at.getTime() < CACHE_MS && (hit.play || hit.hdplay)) return hit;

  const video = await db.collection(C.videos).findOne({ _id: videoId as never }, { projection: { creator_id: 1 } });
  if (!video) throw new MediaError("Video không có trong cơ sở dữ liệu", 404);
  const creator = await db.collection(C.creators).findOne({ _id: video.creator_id as never }, { projection: { handle: 1 } });
  const handle = String(creator?.handle ?? "").replace(/^@/, "") || "_";
  const sourceUrl = `https://www.tiktok.com/@${handle}/video/${videoId}`;

  // One tikwm call at a time, spaced out
  const run = queue.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const res = await fetch(`${RESOLVER}?hd=1&url=${encodeURIComponent(sourceUrl)}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!res.ok) throw new MediaError(`Trình phân giải trả về ${res.status}`, 502);
    return (await res.json()) as { code?: number; msg?: string; data?: Record<string, unknown> };
  });
  queue = run.catch(() => undefined);
  const payload = await run;

  if (payload.code !== 0 || !payload.data) {
    const msg = payload.msg ?? "Không phân giải được video";
    throw new MediaError(/limit/i.test(msg) ? "Đang bị giới hạn tốc độ, thử lại sau vài giây" : msg, /limit/i.test(msg) ? 429 : 422);
  }
  const d = payload.data;
  const doc: VideoMedia = {
    _id: videoId,
    play: typeof d.play === "string" ? d.play : undefined,
    hdplay: typeof d.hdplay === "string" ? d.hdplay : undefined,
    cover: typeof d.cover === "string" ? d.cover : undefined,
    duration: typeof d.duration === "number" ? d.duration : undefined,
    fetched_at: new Date(),
  };
  await cache.replaceOne({ _id: videoId }, doc, { upsert: true });
  return doc;
}

/** Candidate MP4 URLs in order: TikTok edge, then tikwm's own mirror (edges sometimes drop connections). */
export function mediaCandidates(m: VideoMedia): string[] {
  const urls = [m.play, m.hdplay].filter((u): u is string => Boolean(u));
  urls.push(`https://www.tikwm.com/video/media/play/${m._id}.mp4`);
  return [...new Set(urls)];
}

export async function invalidateVideo(videoId: string) {
  const db = await getDb();
  await db.collection(C.videoMedia).deleteOne({ _id: videoId as never });
}
