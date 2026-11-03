import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db/mongo";
import { C } from "./db/collections";
import { claudeAgent } from "./llm/claude";
import { validateReasons, type Reason } from "./evidence/validate";
import { asksAboutVoice } from "./chat-rules";
import { autoCite, parseObject } from "./chat-creator";
import type { AnswerBlock, AskEvent, StepKind, StepPayload, ToolTable } from "./chat-events";
import type { ChatMessage } from "./chat";

/**
 * Hỏi đáp về một KOC bằng **agent có công cụ** (docs/10-koc-agent.md, P5): Claude CLI tự lập kế
 * hoạch, gọi công cụ đọc DB qua MCP `koc` (`scripts/koc-mcp.ts`), thấy thiếu thì gọi tiếp, rồi viết
 * câu trả lời dạng khối JSON. Mỗi lần gọi công cụ hiện thành một thẻ trên giao diện.
 *
 * Chống bịa giữ nguyên nguyên tắc cũ (docs/04-data-model.md §3.1): mỗi kết quả công cụ là một bản
 * ghi `evidence` của phiên; câu có số phải trích evidence của phiên và mọi số phải nằm trong claim
 * được trích (`validateReasons`), số tự tính phải đi qua `calc`. Bảng do code chép hàng từ evidence.
 */
export const AGENT_PROMPT_VERSION = "koc-agent-v3";
const HISTORY_TURNS = 8;

/**
 * Câu hỏi vẫn đi **luồng cũ** (dữ liệu agent chưa có): liên hệ, chi phí booking, chất lượng nội dung
 * kiểu cũ. Mọi câu khác — số liệu bán hàng lẫn câu **ngoài lề** ("KOC có gia đình chưa?") — đi agent:
 * agent kiểm tra DB trước, nói rõ là không có trong dữ liệu, rồi mới tìm trên web (giống Kalopilot).
 */
const OLD_FLOW_Q = /liên hệ|liên lạc|zalo|email|số điện thoại|chi phí|booking|báo giá|thuê|chỉn chu|lên hình|cách giới thiệu/i;

export const agentEnabled = () => process.env.KOC_AGENT === "1";
export const useAgentFor = (question: string) => agentEnabled() && !asksAboutVoice(question) && !OLD_FLOW_Q.test(question);

/** Công cụ có sẵn của Claude CLI cho phần thông tin ngoài dữ liệu. */
const WEB_TOOLS = ["WebSearch", "WebFetch"];

/** Đầu prompt cho chat ở trang hồ sơ KOC. */
const INTRO_KOC = `[${AGENT_PROMPT_VERSION}] Bạn là chuyên viên phân tích KOC TikTok Shop mỹ phẩm Việt Nam, trả lời người bán hàng về MỘT KOC.
Nguồn 1 (chính): các công cụ mcp__koc__* — dữ liệu Kalodata đã thu thập vào DB, 30 ngày.
Nguồn 2 (phụ): WebSearch / WebFetch — CHỈ dùng khi câu hỏi nằm ngoài dữ liệu Kalodata (đời tư công khai, tiểu sử, thương hiệu riêng, tin tức, phốt…).`;

/** Đầu prompt cho chat chiến dịch (câu hỏi giải thích / so sánh / thông tin ngoài dữ liệu). */
const INTRO_CAMPAIGN = `[${AGENT_PROMPT_VERSION}-campaign] Bạn là chuyên viên phân tích KOC TikTok Shop mỹ phẩm Việt Nam, trả lời người bán hàng về MỘT CHIẾN DỊCH đã chạy: danh sách KOC được chọn + dự phòng.
Nguồn 1 (chính): công cụ mcp__koc__*. Gọi campaign_context ĐẦU TIÊN (tiêu chí, điểm từng thành phần, ngân sách đã chia, bằng chứng chấm điểm của từng KOC). Các công cụ còn lại đọc dữ liệu MỘT KOC — truyền creator_id lấy từ campaign_context.
Nguồn 2 (phụ): WebSearch / WebFetch — CHỈ khi câu hỏi nằm ngoài dữ liệu Kalodata (phốt, tiểu sử, thương hiệu, tin tức…).

CHIẾN DỊCH
- Điểm phù hợp, xếp hạng, ngân sách là KẾT QUẢ của hệ thống (code chấm theo tiêu chí). Giải thích bằng điểm thành phần + bằng chứng; KHÔNG tự chấm lại, KHÔNG tự đề xuất con số ngân sách khác.
- "Vì sao chọn A" / "vì sao không chọn B": so điểm thành phần của A với B (campaign_context), rồi đọc thêm dữ liệu thật của cả hai (get_overview, list_products, analyze_videos… với creator_id) để chỉ ra khác biệt cụ thể. Gọi song song cho các KOC.
- So sánh nhiều KOC: cùng một công cụ cho từng KOC, chênh lệch tính bằng calc. Có thể chèn bảng {"type":"table","source":"<evidence_id của campaign_context>"}.
- Người dùng muốn ĐỔI gì (ngân sách, bỏ KOC…): không tự làm — nói họ nhắn yêu cầu đó, hệ thống sẽ chạy lại.`;

const RULES = `
CÂU HỎI NGOÀI DỮ LIỆU (vd "có gia đình chưa", "là ai", "có phải chủ thương hiệu không")
a. Gọi get_overview (DUY NHẤT công cụ mcp__koc__* cho loại câu này) để xác nhận dữ liệu Kalodata KHÔNG có thông tin này và lấy tên/handle/thương hiệu làm từ khoá. KHÔNG gọi list_products, list_videos, get_peers… — người hỏi không hỏi về bán hàng.
b. Tìm web kỹ như một người điều tra, ưu tiên nguồn gốc: kênh chính chủ của KOC (TikTok, Facebook, Instagram — KOC hay có NICK CHÍNH khác handle đang xem), báo chí Việt Nam.
   - Truy vấn đầu: tên + handle. Rồi các biến thể: tên không dấu, tên + thương hiệu bán nhiều nhất (có sẵn trong get_overview), tên + "tiktoker", tên + chủ đề câu hỏi.
   - Kết quả lệch (người trùng tên, trang không liên quan) → tìm lại với mode "extended" và truy vấn cụ thể hơn; thấy nick chính/bài báo thì tìm tiếp theo nick đó.
   - Đọc kỹ (WebFetch) 1-2 trang đáng tin nhất để lấy đúng câu chữ trước khi kết luận. Tối đa khoảng 6 lần tìm.
c. Khối đầu tiên trả lời thẳng (có/không/chưa rõ) kèm nguồn. Mỗi ý từ web PHẢI có "web_urls" = URL lấy đúng từ kết quả tìm kiếm. Không có nguồn rõ thì nói "không tìm thấy thông tin công khai đáng tin", KHÔNG đoán.
d. Thêm một ý lưu ý: thông tin này lấy từ web công khai, KHÔNG nằm trong dữ liệu Kalodata.
e. Trả lời ĐÚNG câu được hỏi, gọn. Không chèn bảng, không thêm mục phân tích bán hàng. Nếu web cho thấy điều người bán nên biết (vd KOC là chủ thương hiệu họ đang bán) thì chỉ nói 1 câu, dùng thông tin đã có trong get_overview, rồi gợi ý hỏi tiếp ở follow_ups.
f. Đời tư: chỉ nêu điều CHÍNH KOC đã công khai hoặc báo chí đưa tin; không nêu địa chỉ, số điện thoại, thông tin con cái, không suy đoán, không phán xét.

CÁCH LÀM (câu hỏi về số liệu)
1. Nghĩ ngắn: câu hỏi cần những số nào. Gọi công cụ — gọi SONG SONG các công cụ độc lập trong cùng một lượt.
2. Đọc kết quả, thấy thiếu thì gọi tiếp (vd sản phẩm top có video gắn → list_videos với product_id).
3. Hỏi về danh mục / sản phẩm / bán hàng: BẮT BUỘC đủ bộ — get_overview, category_breakdown level 1 VÀ level 2, list_products, list_videos (sort=revenue), analyze_videos (xem các video bán hàng tốt nhất: KOC có thật sự demo đúng sản phẩm không), get_peers để đối chuẩn.
   Hỏi doanh thu / ổn định: get_overview, get_daily, get_peers. Hỏi video: list_videos (views và revenue), analyze_videos, get_overview.
4. Muốn nói một con số KHÔNG có sẵn trong kết quả (tổng, tỉ trọng, gấp bao nhiêu lần, chênh lệch) → PHẢI gọi calc với số lấy từ "numbers", rồi chép kết quả calc. Tự cộng/nhân/ước lượng trong đầu là SAI và câu đó sẽ bị xoá.
5. TỰ KIỂM TRA trước khi viết: mỗi kết luận phải có ít nhất 2 bằng chứng độc lập chống đỡ (vd số liệu bán hàng + điều AI thấy trong video, hoặc số của KOC + đối chuẩn). Bằng chứng mâu thuẫn nhau thì nói rõ mâu thuẫn, không chọn phe. Điều chưa đủ dữ liệu thì nói "chưa đủ dữ liệu".
   Nhận định từ analyze_videos là AI nhìn 4 khung hình, không nghe được tiếng — viết "trong khung hình thấy…", không khẳng định về lời nói.

QUY TẮC SỐ (câu vi phạm bị hệ thống xoá)
- Chép số NGUYÊN VĂN như trong dòng tóm tắt của công cụ (vd "₫5,2 tỉ", "15%", "1,6k đơn", "gấp 7,7 lần"). Không làm tròn lại, không đổi đơn vị, không viết "khoảng/gần" thay số khác.
- Mỗi câu/ý có số phải ghi "evidence_ids" = các evidence_id của kết quả công cụ chứa đúng các số đó (calc cũng có evidence_id riêng).
- Doanh thu so đối chuẩn của get_peers là doanh thu MỸ PHẨM (khác doanh thu cả kênh) — nói rõ khi so.
- Khán giả luôn ghi "(ước tính)". Phần trăm "chưa phân loại" phải nêu là thiếu dữ liệu danh mục, không đoán nó thuộc ngành nào như sự thật.

CÂU TRẢ LỜI CUỐI: DUY NHẤT 1 object JSON (không markdown, không chữ ngoài JSON; trong chuỗi dùng nháy đơn thay nháy kép):
{"summary": 1 câu không chứa số (đặt tên cuộc trò chuyện),
 "blocks": [
   {"type":"para","text":"...","evidence_ids":["ev_s_..."],"web_urls":["https://..."]}  — khối ĐẦU TIÊN: trả lời thẳng câu hỏi trong 1-2 câu (kết luận kiểu Kalopilot),
   {"type":"heading","text":"..."},
   {"type":"bullets","items":[{"text":"...","evidence_ids":["..."],"web_urls":["..."]}]},
   (evidence_ids cho ý từ dữ liệu Kalodata, web_urls cho ý từ web; ý từ web có số thì số đó phải có trong kết quả tìm kiếm/trang đã đọc)
   {"type":"table","source":"<evidence_id của list_products | category_breakdown | list_videos | analyze_videos | get_peers | campaign_context>","title":"...","limit":10} — hệ thống vẽ bảng từ hàng của kết quả đó, bạn KHÔNG viết số trong bảng,
   {"type":"closing","text":"1 câu mời hỏi tiếp, không số"}
 ],
 "follow_ups": 2-3 câu hỏi tiếp (≤ 20 từ) trả lời được bằng các công cụ trên}
Ý không có số (nhận định từ video, suy luận) cũng PHẢI ghi evidence_ids của kết quả công cụ làm căn cứ — người bán bấm vào để xem bằng chứng.
Bố cục gợi ý cho câu hỏi danh mục/sản phẩm: kết luận → bảng cơ cấu danh mục → bảng top sản phẩm → các ý đáng chú ý (danh mục cốt lõi, định vị giá, kênh bán live/video, thương hiệu) → bảng video bán hàng + bảng analyze_videos + 1-2 ý về cách KOC demo sản phẩm → đối chuẩn cùng tầm (bảng peers + 1-2 ý) → heading "Căn cứ đi đến kết luận" + bullets: mỗi ý là một bước lập luận nối bằng chứng → kết luận (vd "doanh thu 95,8% từ live + video chỉ 0,2% → KOC bán bằng live, video chủ yếu để kéo người xem"), mỗi ý trích đủ evidence_ids → closing.
Văn phong: tiếng Việt tự nhiên như người tư vấn; câu ngắn, rõ.`;

const TITLES: Record<string, (input: Record<string, unknown>) => string> = {
  get_overview: () => "Lấy tổng quan kênh",
  list_products: (i) => `Lấy danh sách top ${Number(i.limit) || 10} sản phẩm`,
  category_breakdown: (i) => `Tính cơ cấu doanh thu theo danh mục cấp ${Number(i.level) || 2}`,
  list_videos: (i) => `Lấy danh sách video ${i.product_id ? "gắn sản phẩm" : ""} theo ${i.sort === "revenue" ? "doanh thu" : "lượt xem"}`.replace(/\s+/g, " "),
  get_daily: () => "Lấy doanh thu theo ngày",
  get_peers: () => "So sánh với KOC cùng tầm",
  analyze_videos: (i) => `AI xem ${Array.isArray(i.video_ids) && i.video_ids.length ? i.video_ids.length : 3} video (4 khung hình/video)`,
  calc: (i) => `Tính toán (${String(i.op ?? "")})`,
  campaign_context: () => "Đọc chiến dịch: tiêu chí, điểm, ngân sách",
  WebSearch: (i) => `Tìm kiếm trên web: ${String(i.query ?? "")}`,
  WebFetch: (i) => `Đọc trang web: ${String(i.url ?? "").replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}`,
};

/** Kết quả WebSearch của CLI: `Links: [{"title","url"}…]` rồi phần tóm tắt. */
function webLinks(text: string): { title: string; url: string }[] {
  const m = /Links:\s*(\[[\s\S]*?\])\s*(\n|$)/.exec(text);
  if (m)
    try {
      return (JSON.parse(m[1]) as { title?: string; url?: string }[]).filter((l) => l.url).map((l) => ({ title: String(l.title ?? l.url), url: String(l.url) }));
    } catch {
      /* rơi xuống dò URL trần */
    }
  return [...new Set(text.match(/https?:\/\/[^\s"')\]]+/g) ?? [])].map((url) => ({ title: url, url }));
}
const KIND: Record<string, StepKind> = { get_peers: "peers", list_videos: "videos", analyze_videos: "videos" };
/** Công cụ có hàng vẽ được thành bảng. */
const TABLE_TOOLS = new Set(["list_products", "category_breakdown", "list_videos", "get_peers", "analyze_videos", "campaign_context"]);

/** Dòng tóm tắt ngắn cho thẻ: lấy câu đầu của summary. */
const shortDetail = (summary: string) => {
  const s = summary.split(/(?<=[.;])\s/)[0] ?? summary;
  return s.length > 180 ? `${s.slice(0, 177)}…` : s;
};

interface SessionEvidence {
  _id: string;
  key: string;
  claim: string;
  rows?: Record<string, unknown>[];
}

/** Những gì agent đọc được trên web trong phiên — căn cứ duy nhất cho các ý có `web_urls`. */
interface WebCorpus {
  urls: Set<string>;
  text: string;
}

const NUM = /\d+(?:[.,]\d+)*/g;
const normUrl = (u: string) => u.trim().replace(/^https?:\/\/(www\.)?/, "").replace(/[/#?]+$/, "").toLowerCase();

/**
 * Lọc khối model trả về theo evidence của phiên — cùng hàng rào như luồng cũ (`sanitizeBlocks`).
 * Ý từ web: mọi URL trích phải nằm trong kết quả WebSearch/WebFetch của phiên (không bịa link), và
 * mọi con số phải xuất hiện trong claim được trích hoặc trong chữ đã đọc từ web.
 */
function sanitize(raw: unknown, evidence: Map<string, SessionEvidence>, web: WebCorpus): { blocks: AnswerBlock[]; dropped: number } {
  const ev = new Map([...evidence].map(([id, e]) => [id, e.claim]));
  const known = new Set([...web.urls].map(normUrl));
  const webNums = new Set((web.text.match(NUM) ?? []).map((n) => n.replace(/[.,]/g, "")));
  const out: AnswerBlock[] = [];
  let dropped = 0;
  const hasDigit = (s: string) => /\d/.test(s);
  const ok = (text: string, ids: string[]) => validateReasons([{ text, evidence_ids: ids }], ev).kept.length > 0;
  /** Trả `{ids, urls}` nếu ý giữ được, null nếu phải bỏ. */
  const cite = (text: string, ids: string[], urlsRaw: unknown): { ids: string[]; urls: string[] } | null => {
    const urls = (Array.isArray(urlsRaw) ? urlsRaw : []).map(String).filter((u) => known.has(normUrl(u)));
    if (Array.isArray(urlsRaw) && urlsRaw.length && !urls.length) return null; // chỉ trích link không có thật
    const realIds = ids.filter((id) => ev.has(id));
    if (!hasDigit(text)) return { ids: realIds, urls };
    if (urls.length) {
      // Ý từ web: số phải có trong web đã đọc hoặc trong claim được trích
      const cited = new Set((realIds.map((id) => ev.get(id)!).join(" ").match(NUM) ?? []).map((n) => n.replace(/[.,]/g, "")));
      return (text.match(NUM) ?? []).every((n) => webNums.has(n.replace(/[.,]/g, "")) || cited.has(n.replace(/[.,]/g, ""))) ? { ids: realIds, urls } : null;
    }
    if (ok(text, ids)) return { ids, urls };
    const auto = autoCite(text, ev);
    return auto.length && ok(text, auto) ? { ids: auto, urls } : null;
  };
  for (const b of Array.isArray(raw) ? raw : []) {
    const o = (b ?? {}) as Record<string, unknown>;
    const text = String(o.text ?? "").trim();
    const ids = (Array.isArray(o.evidence_ids) ? o.evidence_ids : []).map(String);
    switch (String(o.type)) {
      case "heading":
        if (text) out.push({ type: "heading", text: text.slice(0, 90) });
        break;
      case "para": {
        if (!text) break;
        const c = cite(text, ids, o.web_urls);
        if (c) out.push({ type: "para", text: text.slice(0, 700), evidence_ids: c.ids, ...(c.urls.length ? { web_urls: c.urls } : {}) });
        else (dropped++, console.warn("[koc-agent] bỏ đoạn vì không kiểm chứng được:", text.slice(0, 120)));
        break;
      }
      case "bullets": {
        const items: { text: string; evidence_ids: string[]; web_urls?: string[] }[] = [];
        for (const i of Array.isArray(o.items) ? o.items : []) {
          const x = (i ?? {}) as Record<string, unknown>;
          const t = String(x.text ?? "").trim().slice(0, 320);
          if (!t) continue;
          const c = cite(t, (Array.isArray(x.evidence_ids) ? x.evidence_ids : []).map(String), x.web_urls);
          if (c) items.push({ text: t, evidence_ids: c.ids, ...(c.urls.length ? { web_urls: c.urls } : {}) });
          else (dropped++, console.warn("[koc-agent] bỏ ý vì không kiểm chứng được:", t.slice(0, 120)));
        }
        if (items.length) out.push({ type: "bullets", items });
        break;
      }
      case "table": {
        const e = evidence.get(String(o.source ?? ""));
        if (!e || !TABLE_TOOLS.has(e.key) || !e.rows?.length) break;
        const limit = Math.max(1, Math.min(30, Number(o.limit) || 10));
        out.push({ type: "table", source: e._id, title: text || String(o.title ?? "").slice(0, 90) || undefined, table: { tool: e.key, rows: e.rows.slice(0, limit) } });
        break;
      }
      case "closing":
        if (text && !hasDigit(text)) out.push({ type: "closing", text: text.slice(0, 220) });
        break;
    }
  }
  return { blocks: out, dropped };
}

const historyText = (messages: ChatMessage[]) =>
  messages
    .slice(-HISTORY_TURNS)
    .map((m) => `${m.role === "user" ? "Người bán" : "Bạn"}: ${m.text}`)
    .join("\n");

/** Chat ở trang hồ sơ KOC: agent chỉ đọc được đúng KOC này. */
export async function* analyseCreatorAgent(creatorId: string, text: string, threadId?: string): AsyncGenerator<AskEvent> {
  const db = await getDb();
  const creator = await db.collection(C.creators).findOne({ _id: creatorId as never }, { projection: { nickname: 1, handle: 1 } });
  if (!creator) {
    yield { type: "error", message: "Không tìm thấy KOC" };
    return;
  }
  const chat = threadId ? await db.collection(C.creatorChats).findOne({ _id: threadId as never }) : null;
  const history = historyText((chat?.messages as ChatMessage[]) ?? []);
  yield* runAgent({
    system: INTRO_KOC + RULES,
    prompt: [`KOC: ${String(creator.nickname ?? "")} (${String(creator.handle ?? "")}).`, history ? `Hội thoại trước đó:\n${history}` : "", `Câu hỏi của người bán: ${text}`],
    env: { KOC_CREATOR: creatorId },
    purpose: "koc-agent",
  });
}

/**
 * Chat chiến dịch — câu hỏi giải thích / so sánh / thông tin ngoài dữ liệu (docs/10-koc-agent.md,
 * mục chiến dịch). Agent đọc được mọi KOC trong danh sách được chọn + dự phòng của chiến dịch, cùng
 * công cụ `campaign_context`. Không đổi gì trong chiến dịch: việc đổi vẫn do `handleTurn` + bảng
 * `RERUN_FROM` quyết.
 */
export async function* analyseCampaignAgent(campaignId: string, text: string, history: ChatMessage[], creatorIds: string[], names: Map<string, string>): AsyncGenerator<AskEvent> {
  if (!creatorIds.length) {
    yield { type: "error", message: "Chiến dịch chưa có KOC nào để phân tích" };
    return;
  }
  const h = historyText(history);
  yield* runAgent({
    system: INTRO_CAMPAIGN + RULES,
    prompt: [
      `KOC trong chiến dịch (id → tên): ${creatorIds.map((id) => `${id} → ${names.get(id) ?? id}`).join("; ")}.`,
      h ? `Hội thoại trước đó:\n${h}` : "",
      `Câu hỏi của người bán: ${text}`,
    ],
    env: { KOC_CREATORS: creatorIds.join(","), KOC_CAMPAIGN: campaignId },
    purpose: "campaign-agent",
    names,
  });
}

async function* runAgent(opts: {
  system: string;
  prompt: string[];
  /** Phạm vi đọc dữ liệu của MCP server (KOC_CREATOR | KOC_CREATORS + KOC_CAMPAIGN). */
  env: Record<string, string>;
  purpose: string;
  /** id → tên KOC, để tiêu đề thẻ ghi rõ đang đọc dữ liệu của ai (chat chiến dịch). */
  names?: Map<string, string>;
}): AsyncGenerator<AskEvent> {
  const db = await getDb();
  const session = randomUUID().slice(0, 12);

  yield { type: "plan", steps: [], agent: true };
  let n = 0;
  const stepOf = new Map<string, number>(); // tool_use_id → chỉ số bước
  const web: WebCorpus = { urls: new Set(), text: "" };
  const pendingFetch = new Map<string, string[]>(); // tool_use_id của WebFetch → URL đã đọc
  let final: { text: string; cost_usd: number } | null = null;
  try {
    for await (const ev of claudeAgent({
      system: opts.system,
      prompt: opts.prompt.filter(Boolean).join("\n\n"),
      mcp: { name: "koc", script: "scripts/koc-mcp.ts", env: { KOC_SESSION: session, ...opts.env } },
      model: "sonnet",
      purpose: opts.purpose,
      builtinTools: WEB_TOOLS,
    })) {
      if (ev.type === "tool_use") {
        const index = n++;
        stepOf.set(ev.id, index);
        // URL trang agent tự đọc cũng là nguồn hợp lệ (kết quả WebFetch không lặp lại URL)
        if (ev.name === "WebFetch" && typeof ev.input.url === "string") pendingFetch.set(ev.id, [ev.input.url]);
        const who = typeof ev.input.creator_id === "string" ? opts.names?.get(ev.input.creator_id) : undefined;
        yield { type: "step_add", title: `${(TITLES[ev.name] ?? (() => ev.name))(ev.input)}${who ? ` · ${who}` : ""}`, kind: KIND[ev.name] ?? "data" };
        yield { type: "step_start", index };
      } else if (ev.type === "tool_result") {
        const index = stepOf.get(ev.id);
        if (index === undefined) continue;
        if (WEB_TOOLS.includes(ev.name)) {
          // Web: không phải evidence Kalodata — giữ chữ + link để kiểm các ý trích web_urls
          web.text += `\n${ev.text}`;
          const links = ev.name === "WebSearch" ? webLinks(ev.text) : [];
          for (const l of links) web.urls.add(l.url);
          for (const u of ev.text.match(/https?:\/\/[^\s"')\]]+/g) ?? []) web.urls.add(u);
          for (const u of pendingFetch.get(ev.id) ?? []) web.urls.add(u);
          yield {
            type: "step_done",
            index,
            detail: ev.is_error ? "Không đọc được" : ev.name === "WebSearch" ? `${links.length} kết quả` : "Đã đọc trang",
            payload: links.length ? { web: links.slice(0, 8) } : undefined,
          };
          continue;
        }
        const evidenceId = /^evidence_id: (\S+)/.exec(ev.text)?.[1];
        const summary = ev.text.split("\n")[1] ?? "";
        // `evidence_id` đi kèm bước để chip nguồn dưới mỗi câu trỏ được về đúng thẻ này
        const payload: StepPayload | undefined = evidenceId ? { evidence_id: evidenceId } : undefined;
        if (payload && TABLE_TOOLS.has(ev.name)) {
          const doc = await db.collection(C.evidence).findOne({ _id: evidenceId as never }, { projection: { rows: 1 } });
          const rows = (doc?.rows as Record<string, unknown>[]) ?? [];
          if (rows.length) payload.table = { tool: ev.name, rows: rows.slice(0, 10) } satisfies ToolTable;
        }
        yield { type: "step_done", index, detail: ev.is_error ? ev.text.replace(/^Lỗi: /, "Lỗi: ").slice(0, 180) : shortDetail(summary), payload };
      } else if (ev.type === "done") final = { text: ev.result.text, cost_usd: ev.result.cost_usd };
    }
  } catch (err) {
    console.error("[koc-agent] lỗi", err);
    yield { type: "error", message: "Mình gặp lỗi khi phân tích — bạn thử lại giúp mình nhé." };
    yield { type: "done", cost_usd: 0 };
    return;
  }

  // ── Kiểm chứng câu trả lời theo evidence của phiên ──
  const conclusionIdx = n;
  yield { type: "step_add", title: "Kiểm chứng số liệu & viết câu trả lời", kind: "conclusion" };
  yield { type: "step_start", index: conclusionIdx };
  const docs = (await db.collection(C.evidence).find({ session_id: session }, { projection: { key: 1, claim: 1, rows: 1, cost_usd: 1 } }).toArray()) as unknown as (SessionEvidence & {
    cost_usd?: number;
  })[];
  const evidence = new Map(docs.map((d) => [String(d._id), d]));
  // Tiền AI xem video tiêu bên trong công cụ (MCP server), không nằm trong chi phí của agent
  const toolCost = docs.reduce((a, d) => a + (d.cost_usd ?? 0), 0);
  const out = parseObject(final?.text ?? "");
  const { blocks, dropped } = sanitize(out.blocks, evidence, web);
  const follow_ups = (Array.isArray(out.follow_ups) ? out.follow_ups : [])
    .filter((q): q is string => typeof q === "string" && q.trim().length > 8)
    .map((q) => q.trim().slice(0, 120))
    .filter((q) => !asksAboutVoice(q))
    .slice(0, 3);
  const summary = String(out.summary ?? "").slice(0, 400);
  if (blocks[0]?.type !== "para" && summary && !/\d/.test(summary)) blocks.unshift({ type: "para", text: summary });
  const reasons: Reason[] = blocks.flatMap((b) => (b.type === "bullets" ? b.items : b.type === "para" && b.evidence_ids?.length ? [{ text: b.text, evidence_ids: b.evidence_ids }] : []));
  yield {
    type: "step_done",
    index: conclusionIdx,
    detail: `${evidence.size} kết quả công cụ làm bằng chứng · ${reasons.length} ý có nguồn${dropped ? ` · bỏ ${dropped} ý có số không kiểm chứng được` : ""}`,
  };
  yield {
    type: "conclusion",
    text: summary || "Mình chưa trả lời được câu này từ dữ liệu hiện có.",
    reasons,
    blocks: blocks.length ? blocks : [{ type: "para", text: "Mình chưa trả lời được câu này từ dữ liệu hiện có." }],
    follow_ups,
  };
  yield { type: "done", cost_usd: (final?.cost_usd ?? 0) + toolCost };
}
