import "server-only";
import { getDb } from "../db/mongo";
import { C } from "../db/collections";
import type { Evidence } from "../scoring/run";
import { analyseVideo } from "../pipeline/s4-video";
import { compact } from "../format";

/**
 * Bằng chứng **từ hình ảnh video** cho một KOC, độc lập chiến dịch.
 *
 * Kết luận kiểu "review có kỹ không", "demo sản phẩm rõ không", "hình ảnh chỉn chu không" không thể
 * suy ra từ số liệu — phải nhìn video. Hàm này chọn 2 video tiêu biểu (nhiều view nhất và doanh thu
 * cao nhất), phân tích qua `analyseVideo` (dùng chung cache với S4 nên KOC đã từng nằm trong chiến
 * dịch thì **0 token**), rồi biến nhận định thành claim có `evidence_id` để AI được phép trích.
 */
export const CREATOR_VIDEO_EVIDENCE_VERSION = "koc-ev-video-v1";

export interface VideoRef {
  video_id: string;
  title: string;
  views: number;
  times: number[];
  summary: string;
  demo: string;
}

const evId = (creatorId: string, videoId: string) => `ev_koc_${creatorId}_video_${videoId}`;

export async function creatorVideoEvidence(creatorId: string, limit = 2): Promise<{ claims: Map<string, string>; videos: VideoRef[]; cost_usd: number }> {
  const db = await getDb();
  const vids = await db
    .collection(C.videos)
    .find({ creator_id: creatorId })
    .project<{ _id: string; title?: string; views?: number; revenue?: number }>({ title: 1, views: 1, revenue: 1 })
    .toArray();
  if (!vids.length) return { claims: new Map(), videos: [], cost_usd: 0 };

  // Hai video tiêu biểu: nhiều view nhất + doanh thu cao nhất (thường là hai video khác nhau)
  const byViews = [...vids].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  const byRevenue = [...vids].sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));
  const picks: typeof vids = [];
  for (const v of [byViews[0], byRevenue[0], ...byViews]) {
    if (!v || picks.some((p) => String(p._id) === String(v._id))) continue;
    picks.push(v);
    if (picks.length >= limit) break;
  }

  const claims = new Map<string, string>();
  const videos: VideoRef[] = [];
  const docs: Evidence[] = [];
  let cost = 0;

  for (const v of picks) {
    const videoId = String(v._id);
    const title = String(v.title ?? "").slice(0, 150);
    try {
      const out = await analyseVideo(videoId, title);
      cost += out.cost_usd;
      const a = out.assessment.result;
      const claim = `Video "${title.slice(0, 60)}" (${compact(v.views ?? 0)} view, xem 4 khung ở giây ${out.times.join(", ")}): demo sản phẩm ${a.product_demo} (${a.demo_score}/100), chất lượng hình ${a.production_quality}/100, độ tự nhiên ${a.authenticity}/100${
        a.products_seen.length ? `, thấy ${a.products_seen.join(", ")}` : ""
      } — ${a.summary}`;
      const id = evId(creatorId, videoId);
      claims.set(id, claim);
      docs.push({
        _id: id,
        campaign_id: null,
        creator_id: creatorId,
        key: `video_${videoId}`,
        type: "video",
        claim,
        value: a.demo_score,
        source: { collection: C.videos, ref: videoId },
        strength: a.product_demo === "có" ? "strong" : "medium",
      });
      videos.push({ video_id: videoId, title, views: v.views ?? 0, times: out.times, summary: a.summary, demo: a.product_demo });
    } catch (err) {
      console.error("[koc-video] phân tích lỗi", videoId, err instanceof Error ? err.message : err);
    }
  }

  await Promise.all(
    docs.map((d) => db.collection(C.evidence).replaceOne({ _id: d._id as never }, { ...d, version: CREATOR_VIDEO_EVIDENCE_VERSION, created_at: new Date() }, { upsert: true })),
  );
  return { claims, videos, cost_usd: cost };
}
