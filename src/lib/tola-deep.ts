import "server-only";
import { getDb } from "./db/mongo";
import { C } from "./db/collections";
import { claude } from "./llm/claude";
import { createCampaignFromBrief } from "./campaign-create";
import { scoreCampaign } from "./scoring/run";
import { runS3 } from "./pipeline/s3-content";
import { prefetchS4Frames, runS4 } from "./pipeline/s4-video";
import { runS5 } from "./pipeline/s5-recommend";
import { campaignVideoRows } from "./koc-data/tools";
import type { AskEvent, StepPayload } from "./chat-events";
import type { Capability } from "./plan";

/**
 * Nhánh **tìm KOC chuyên sâu** của trợ lý Tola: chạy đủ S2 → S5 và phát tiến độ từng bước ra luồng
 * chat, thay vì đẩy người dùng sang một trang chiến dịch riêng.
 *
 * Chạy ở tiến trình Next (route handler) chứ không trong tiến trình MCP — tiến trình con của agent
 * chết ngay sau lượt hỏi, pipeline sẽ bị giết giữa chừng.
 */

const CLASSIFY_VERSION = "tola-route-v1";

const CLASSIFY_SYSTEM = `[${CLASSIFY_VERSION}] Phân loại yêu cầu của người bán hàng mỹ phẩm TikTok. Trả về DUY NHẤT một từ:

deep  — họ muốn TUYỂN KOC cho một chiến dịch: nêu sản phẩm cần quảng bá, kèm số KOC cần / ngân sách /
        khán giả mục tiêu / yêu cầu về chất lượng review. Ví dụ: "tìm 5 KOC bán kem chống nắng, nữ
        18-30, ngân sách 30 triệu", "cần 10 KOC trang điểm chưa ký MCN".
quick — tra cứu, xếp hạng, so sánh, hỏi về một KOC cụ thể, hỏi thông tin ngoài dữ liệu. Ví dụ: "KOC
        nào doanh thu cao nhất", "@phuongsena bán gì nhiều nhất", "ai đang tăng trưởng mạnh".

Mấu chốt: "deep" là khi họ sắp CHI TIỀN hợp tác và cần danh sách có bằng chứng; "quick" là khi họ
chỉ muốn biết một con số hoặc một câu trả lời.`;

/** Một câu hỏi có đáng chạy phân tích sâu (vài phút, vài chục cent) hay trả lời nhanh là đủ? */
export async function classifyAsk(text: string): Promise<"deep" | "quick"> {
  try {
    const res = await claude({ system: CLASSIFY_SYSTEM, prompt: text, model: "haiku", purpose: "tola-classify" });
    return /deep/i.test(res.text.slice(0, 40)) ? "deep" : "quick";
  } catch (err) {
    // Phân loại hỏng thì trả lời nhanh: thà kém sâu còn hơn âm thầm tiêu vài chục cent
    console.error("[tola] phân loại lỗi, mặc định quick", err);
    return "quick";
  }
}

const RUNNING: Record<Capability, string> = {
  score_fit: "Lọc & chấm điểm toàn bộ KOC trong ngành",
  screen_content: "Đọc bio, sản phẩm đã bán và tiêu đề video",
  analyse_videos: "Xem khung hình video để kiểm chứng demo sản phẩm",
  recommend: "Chọn KOC trong ngân sách, chia tiền & viết lý do",
};

/**
 * Chạy phân tích sâu cho một brief, phát `step_add` / `step_done` theo từng bước.
 * Trả về `campaignId` để lượt viết câu trả lời đọc `campaign_context` của đúng chiến dịch đó.
 */
export async function* runDeepSearch(prompt: string): AsyncGenerator<AskEvent, string | null> {
  const db = await getDb();
  let step = 0;

  // ── Hiểu yêu cầu ──
  yield { type: "step_add", title: "Hiểu yêu cầu", kind: "data" };
  yield { type: "step_start", index: step };
  let id: string;
  try {
    const made = await createCampaignFromBrief(prompt);
    id = made.id;
    const c = made.criteria;
    const bits = [
      c.product_focus ? `sản phẩm '${c.product_focus}'` : null,
      `${c.koc_count} KOC`,
      c.budget_total ? `ngân sách ${(c.budget_total / 1e6).toLocaleString("vi-VN")} triệu` : "chưa có ngân sách",
      c.audience_gender === "female" ? "khán giả nữ" : c.audience_gender === "male" ? "khán giả nam" : null,
      c.audience_ages.length ? `tuổi ${c.audience_ages.join("/")}` : null,
      c.mcn === "no" ? "chưa ký MCN" : c.mcn === "yes" ? "đã ký MCN" : null,
    ].filter(Boolean);
    yield { type: "step_done", index: step++, detail: bits.join(" · ") };
  } catch (err) {
    yield { type: "step_done", index: step, detail: `Không hiểu được yêu cầu: ${(err as Error).message}` };
    return null;
  }

  const planned = new Set<Capability>(
    ((await db.collection(C.campaigns).findOne({ _id: id as never }, { projection: { plan: 1 } }))?.plan?.steps ?? []).map((s: { capability: Capability }) => s.capability),
  );

  /** Chạy một bước, phát thẻ trước và sau. Lỗi một bước không giết cả lượt — bước sau vẫn chạy được. */
  const stage = async function* (
    cap: Capability,
    run: () => Promise<unknown>,
    detail: (c: Record<string, any>) => string, // eslint-disable-line @typescript-eslint/no-explicit-any
    /** Dẫn chứng của riêng bước này — hiện ngay trong thẻ, không chờ câu trả lời. */
    payload?: () => Promise<StepPayload | undefined>,
  ): AsyncGenerator<AskEvent> {
    if (!planned.has(cap)) return;
    yield { type: "step_add", title: RUNNING[cap], kind: cap === "analyse_videos" ? "videos" : "data" };
    yield { type: "step_start", index: step };
    try {
      await run();
      const c = (await db.collection(C.campaigns).findOne({ _id: id as never })) ?? {};
      const p = await payload?.().catch(() => undefined);
      yield { type: "step_done", index: step++, detail: detail(c), ...(p ? { payload: p } : {}) };
    } catch (err) {
      console.error(`[tola] bước ${cap} lỗi`, err);
      yield { type: "step_done", index: step++, detail: `Lỗi ở bước này: ${(err as Error).message}` };
    }
  };

  yield* stage(
    "score_fit",
    () => scoreCampaign(id),
    (c) => (c.scoring ? `Quét ${c.scoring.pool.toLocaleString("vi-VN")} KOC → ${c.scoring.eligible} đạt tiêu chí → rút gọn ${c.scoring.shortlisted}, sinh ${c.scoring.evidence} bằng chứng` : "xong"),
  );
  // Keyframe tải song song với bước đọc nội dung, như pipeline vẫn làm
  if (planned.has("analyse_videos")) void prefetchS4Frames(id).catch(() => undefined);
  yield* stage("screen_content", () => runS3(id), (c) => (c.s3 ? `Đã đọc nội dung của ${c.s3.kocs} KOC` : "xong"));
  /**
   * Bước xem video phải TRẢ VỀ DẪN CHỨNG, không chỉ đếm: từng video AI đã xem, có thấy đúng sản phẩm
   * không, điểm demo, ghi chú từng khung hình và chính tấm 4 khung hình đó. Xem xong mà không cho
   * người bán thấy gì thì bước này vô nghĩa với họ.
   */
  const videoStep = planned.has("analyse_videos") ? step : null;
  yield* stage(
    "analyse_videos",
    () => runS4(id),
    (c) => (c.s4 ? `Đã xem ${c.s4.videos} video của ${c.s4.kocs} KOC (4 khung hình/video, không có tiếng)` : "xong"),
    async () => {
      const rows = await campaignVideoRows(id);
      return rows.length ? { table: { tool: "campaign_videos", rows } } : undefined;
    },
  );
  yield* stage(
    "recommend",
    () => runS5(id),
    (c) => (c.s5 ? `Chọn ${c.s5.picks.length} KOC, phân bổ ${(c.s5.allocated / 1e6).toLocaleString("vi-VN")} triệu (ước tính)` : "xong"),
  );

  /**
   * Phát LẠI thẻ bước xem video, giờ chỉ giữ video của những người THỰC SỰ được chọn. Lúc S4 chạy
   * xong chưa biết ai được chọn (S5 chạy sau), nên thẻ ban đầu mang cả 10 KOC — mà người bán chỉ cần
   * bằng chứng cho 5 người họ sắp trả tiền. Giao diện gán theo chỉ số bước nên lần phát sau ghi đè
   * lần đầu, cả ở lượt đang chạy lẫn bản lưu trong `tola_chats`.
   */
  if (videoStep !== null) {
    const c = ((await db.collection(C.campaigns).findOne({ _id: id as never }, { projection: { s4: 1 } })) ?? {}) as { s4?: { videos: number; kocs: number } };
    const rows = await campaignVideoRows(id, { pickedOnly: true }).catch(() => []);
    if (rows.length)
      yield {
        type: "step_done",
        index: videoStep,
        detail: `Đã xem ${c.s4?.videos ?? rows.length} video của ${c.s4?.kocs ?? "?"} KOC để sàng lọc; dưới đây là ${rows.length} video của ${
          new Set(rows.map((r) => r.creator_id)).size
        } KOC được chọn (4 khung hình/video, không có tiếng)`,
        payload: { table: { tool: "campaign_videos", rows } },
      };
  }

  await db.collection(C.campaigns).updateOne({ _id: id as never }, { $set: { "pipeline.stage": "done", "pipeline.finished_at": new Date() } });
  return id;
}
