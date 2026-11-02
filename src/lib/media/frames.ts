import "server-only";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mediaCandidates, resolveVideo } from "../tiktok-media";

/**
 * Keyframe sheet for one video: 4 frames at 10/35/60/85% of the duration, each 270×480 (9:16),
 * stacked horizontally into a single 1080×480 JPEG. One small image instead of a whole video
 * keeps S4's image tokens low. Sheets are kept on disk (.cache/frames) and reused.
 */
export const FRAME_POINTS = [0.1, 0.35, 0.6, 0.85];
const DIR = join(process.cwd(), ".cache", "frames");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export interface FrameSheet {
  path: string;
  base64: string;
  duration: number; // seconds
  times: number[]; // second of each frame, left → right
}

export const sheetPath = (videoId: string) => join(DIR, `${videoId}.jpg`);

// One build per video at a time: S4 and the background prefetch may ask for the same sheet
const inflight = new Map<string, Promise<FrameSheet>>();

export function frameSheet(videoId: string): Promise<FrameSheet> {
  let p = inflight.get(videoId);
  if (!p) {
    p = buildSheet(videoId).finally(() => inflight.delete(videoId));
    inflight.set(videoId, p);
  }
  return p;
}

async function buildSheet(videoId: string): Promise<FrameSheet> {
  await mkdir(DIR, { recursive: true });
  const out = sheetPath(videoId);
  const meta = `${out}.json`;
  if (existsSync(out) && existsSync(meta)) {
    const m = JSON.parse(await readFile(meta, "utf8")) as { duration: number; times: number[] };
    return { path: out, base64: (await readFile(out)).toString("base64"), ...m };
  }

  const media = await resolveVideo(videoId);
  const tiles = FRAME_POINTS.map((_, i) => join(DIR, `${videoId}_${i}.jpg`));
  const cut = (input: string, t: number, tile: string, remote: boolean) =>
    ffmpeg([
      "-y",
      ...(remote ? ["-user_agent", UA, "-rw_timeout", "20000000"] : []),
      "-ss",
      String(t),
      "-i",
      input,
      "-frames:v",
      "1",
      "-vf",
      "scale=270:480:force_original_aspect_ratio=increase,crop=270:480",
      "-q:v",
      "4",
      tile,
    ]);

  let duration = media.duration ?? 0;
  let times: number[] = [];
  let done = false;
  try {
    // Fast path: ffmpeg seeks the remote MP4 with HTTP range requests → only ~4 small chunks are fetched
    if (duration > 0) {
      times = FRAME_POINTS.map((p) => Math.max(0, Math.round(duration * p * 10) / 10));
      for (const url of mediaCandidates(media)) {
        try {
          await Promise.all(times.map((t, i) => cut(url, t, tiles[i], true)));
          done = true;
          break;
        } catch {
          /* next candidate / fall back to download */
        }
      }
    }
    // Fallback: download the whole MP4 once, then cut locally
    if (!done) {
      const tmp = join(DIR, `${videoId}.mp4`);
      let ok = false;
      for (const url of mediaCandidates(media)) {
        try {
          const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(60_000) });
          if (!res.ok || !(res.headers.get("content-type") ?? "").match(/video|octet/)) continue;
          await writeFile(tmp, Buffer.from(await res.arrayBuffer()));
          ok = true;
          break;
        } catch {
          /* next candidate */
        }
      }
      if (!ok) throw new Error(`không tải được video ${videoId}`);
      try {
        duration = duration || (await probeDuration(tmp));
        times = FRAME_POINTS.map((p) => Math.max(0, Math.round(duration * p * 10) / 10));
        await Promise.all(times.map((t, i) => cut(tmp, t, tiles[i], false)));
      } finally {
        await rm(tmp, { force: true });
      }
    }
    await ffmpeg(["-y", ...tiles.flatMap((t) => ["-i", t]), "-filter_complex", `hstack=inputs=${tiles.length}`, "-q:v", "4", out]);
    await writeFile(meta, JSON.stringify({ duration, times }));
    return { path: out, base64: (await readFile(out)).toString("base64"), duration, times };
  } finally {
    await Promise.all(tiles.map((t) => rm(t, { force: true })));
  }
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.FFMPEG_PATH || "ffmpeg", ["-loglevel", "error", ...args], { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(0, 200)}`))));
  });
}

function probeDuration(file: string): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { windowsHide: true });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => resolve(Number(out.trim()) || 30));
    p.on("error", () => resolve(30));
  });
}
