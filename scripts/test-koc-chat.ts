/**
 * Bộ test hỏi đáp ở trang hồ sơ KOC — chạy qua API thật rồi ghi kết quả ra docs/08-test-koc-chat.md
 *
 *   npm run test:koc            # dùng KOC mặc định, server http://localhost:3002
 *   npm run test:koc -- <creatorId> [baseUrl]
 *
 * Kiểm tra ba thứ người dùng yêu cầu:
 *  1. Câu hỏi về chỉ số / điểm nổi bật phải có **dẫn chứng** (mỗi ý trích `evidence_id` có thật).
 *  2. Kế hoạch phải **bám câu hỏi** (hỏi liên hệ thì không đọc chỉ số bán hàng; hỏi nội dung thì phải xem video).
 *  3. Hỏi tiếp trong cùng cuộc trò chuyện phải trả lời **đúng trọng tâm** (trích đúng nhóm bằng chứng).
 */
import { writeFile } from "node:fs/promises";
import type { AskEvent, StepPayload } from "../src/lib/chat-events";

const [argId, argBase] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const CREATOR = argId || "7088624652566660098"; // Mai Trịnh — dữ liệu đầy đủ
const BASE = argBase || "http://localhost:3002";

type Cap = "profile" | "read_data" | "peers" | "videos" | "answer";

interface Expect {
  /** Bước BẮT BUỘC có trong kế hoạch. */
  steps_include?: Cap[];
  /** Bước KHÔNG được có (chọn thừa = hiện dữ liệu không liên quan). */
  steps_exclude?: Cap[];
  /** Ít nhất 1 ý phải trích evidence có hậu tố này (đúng trọng tâm câu hỏi). */
  evidence_keys?: string[];
  /** Số ý tối thiểu phải có dẫn chứng. */
  min_reasons?: number;
  /** Dẫn chứng không được xuất hiện (nhiễu). */
  no_payload?: ("report" | "products" | "peers" | "videos")[];
  /** Câu trả lời phải nêu được điều này (kiểm bằng từ khoá, không phân biệt hoa thường). */
  must_mention?: string[];
}

interface Case {
  id: string;
  group: string;
  question: string;
  /** Cùng `thread` = hỏi nối tiếp trong một cuộc trò chuyện. */
  thread?: string;
  expect: Expect;
}

/** Tên bước → capability, để kiểm kế hoạch mà không phụ thuộc câu chữ AI tự đặt. */
const CAP_BY_KIND: Record<string, Cap> = { data: "read_data", peers: "peers", videos: "videos", conclusion: "answer" };

const CASES: Case[] = [
  // ── Nhóm 1: chỉ số & điểm nổi bật — bắt buộc có dẫn chứng ──
  {
    id: "metrics-overview",
    group: "Chỉ số & điểm nổi bật",
    question: "Đánh giá khả năng bán hàng, so với creator cùng tầm thế nào?",
    expect: { steps_include: ["read_data", "peers", "answer"], evidence_keys: ["peer_revenue", "peer_engagement", "peer_top"], min_reasons: 2 },
  },
  {
    id: "metrics-stability",
    group: "Chỉ số & điểm nổi bật",
    question: "Doanh thu có ổn định trong 30 ngày không?",
    expect: { steps_include: ["read_data", "answer"], steps_exclude: ["videos"], evidence_keys: ["consistency"], min_reasons: 2 },
  },
  {
    id: "metrics-engagement",
    group: "Chỉ số & điểm nổi bật",
    question: "Tỷ lệ tương tác của KOC này cao hay thấp?",
    expect: { steps_include: ["read_data", "answer"], evidence_keys: ["engagement"], min_reasons: 1 },
  },
  {
    id: "metrics-audience",
    group: "Chỉ số & điểm nổi bật",
    question: "Khán giả của KOC này chủ yếu là ai?",
    expect: { steps_include: ["answer"], evidence_keys: ["audience"], min_reasons: 1 },
  },

  // ── Nhóm 2: sản phẩm & danh mục ──
  {
    id: "products-category",
    group: "Sản phẩm & danh mục",
    question: "Chủ yếu bán danh mục và sản phẩm nào?",
    // 1 ý là đủ nếu ý đó liệt kê trọn cơ cấu danh mục kèm nguồn — từ `koc-answer-v4` model được
    // phép dùng ít ý cho câu đơn giản, nên ngưỡng 2 ở đây là kỳ vọng sai chứ không phải lỗi hệ thống
    expect: { steps_include: ["read_data", "answer"], evidence_keys: ["category_mix", "subcategory_mix", "products"], min_reasons: 1 },
  },
  {
    id: "products-brand",
    group: "Sản phẩm & danh mục",
    question: "KOC có bị phụ thuộc vào một thương hiệu nào không?",
    expect: { steps_include: ["read_data", "answer"], evidence_keys: ["products", "category_mix"], min_reasons: 1 },
  },

  // ── Nhóm 3: hồ sơ, liên hệ, chi phí — KHÔNG được kéo bảng bán hàng ──
  {
    id: "profile-contact",
    group: "Hồ sơ & chi phí",
    question: "Tôi có thể liên hệ với KOC ở đâu?",
    expect: { steps_include: ["profile", "answer"], steps_exclude: ["read_data", "peers", "videos"], evidence_keys: ["contact"], min_reasons: 1, no_payload: ["report", "products"] },
  },
  {
    id: "profile-cost",
    group: "Hồ sơ & chi phí",
    question: "Chi phí hợp tác ước tính bao nhiêu một video?",
    expect: { steps_include: ["answer"], steps_exclude: ["videos"], evidence_keys: ["cost"], min_reasons: 1, must_mention: ["ước tính"] },
  },
  {
    id: "profile-mcn",
    group: "Hồ sơ & chi phí",
    question: "KOC này có thuộc MCN nào không?",
    expect: { steps_include: ["profile", "answer"], steps_exclude: ["read_data"], evidence_keys: ["followers", "contact"], min_reasons: 1, no_payload: ["report"] },
  },

  // ── Nhóm 4: nội dung & video — bắt buộc xem video ──
  {
    id: "content-quality",
    group: "Nội dung & video",
    question: "Chất lượng nội dung và cách review sản phẩm ra sao?",
    expect: { steps_include: ["videos", "answer"], evidence_keys: ["video_"], min_reasons: 2 },
  },
  {
    id: "content-demo",
    group: "Nội dung & video",
    question: "KOC có demo sản phẩm trực tiếp trong video không?",
    expect: { steps_include: ["videos", "answer"], evidence_keys: ["video_"], min_reasons: 1 },
  },

  // ── Nhóm 5: ngoài phạm vi — phải nói thẳng ──
  {
    id: "oos-voice",
    group: "Ngoài phạm vi",
    question: "Giọng nói của KOC này có hay không?",
    expect: { min_reasons: 0, must_mention: ["âm thanh"], no_payload: ["report", "products", "peers", "videos"] },
  },

  // ── Nhóm 6: hỏi nối tiếp trong cùng cuộc trò chuyện ──
  {
    id: "thread-1-overview",
    group: "Hỏi nối tiếp",
    thread: "t-follow",
    question: "Đánh giá tổng quan KOC này giúp tôi",
    expect: { steps_include: ["answer"], min_reasons: 2 },
  },
  {
    id: "thread-2-cost",
    group: "Hỏi nối tiếp",
    thread: "t-follow",
    question: "Thế còn chi phí hợp tác thì sao?",
    expect: { steps_include: ["answer"], evidence_keys: ["cost"], min_reasons: 1, must_mention: ["ước tính"] },
  },
  {
    id: "thread-3-contact",
    group: "Hỏi nối tiếp",
    thread: "t-follow",
    question: "Vậy liên hệ với họ bằng cách nào?",
    expect: { steps_include: ["answer"], evidence_keys: ["contact"], min_reasons: 1 },
  },
];

interface Result {
  c: Case;
  ms: number;
  cost: number;
  plan: { title: string; kind: string }[];
  details: string[];
  answer: string;
  blocks: { type: string; data?: string; text?: string; items?: { text: string }[] }[];
  reasons: { text: string; evidence_ids: string[] }[];
  followUps: string[];
  payload: StepPayload;
  fails: string[];
}

async function run(c: Case, threadId: string): Promise<Result> {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/kocs/${CREATOR}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: c.question, threadId }),
  });
  if (!res.body) throw new Error(`Không có luồng trả lời (HTTP ${res.status})`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const plan: { title: string; kind: string }[] = [];
  const details: string[] = [];
  const payload: StepPayload = {};
  let answer = "";
  let reasons: { text: string; evidence_ids: string[] }[] = [];
  let blocks: Result["blocks"] = [];
  let followUps: string[] = [];
  let cost = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const e = JSON.parse(line) as AskEvent;
      if (e.type === "plan") plan.push(...e.steps);
      else if (e.type === "step_done") {
        details.push(e.detail);
        Object.assign(payload, e.payload ?? {});
      } else if (e.type === "conclusion") {
        answer = e.text;
        blocks = (e.blocks ?? []) as Result["blocks"];
        reasons = e.reasons as { text: string; evidence_ids: string[] }[];
        followUps = e.follow_ups ?? [];
      } else if (e.type === "done") cost = e.cost_usd;
      else if (e.type === "error") throw new Error(e.message);
    }
  }

  // ── Chấm điểm ──
  const caps = plan.map((s) => CAP_BY_KIND[s.kind] ?? "answer");
  // `profile` và `read_data` cùng kind "data" → phân biệt bằng mô tả bước
  const hasProfileStep = details.some((d) => d.startsWith("Hồ sơ:"));
  const hasMetricStep = details.some((d) => /chỉ số từ DB/.test(d));
  const present = new Set<Cap>(caps);
  if (hasProfileStep) present.add("profile");
  if (!hasMetricStep) present.delete("read_data");

  const fails: string[] = [];
  for (const need of c.expect.steps_include ?? []) if (!present.has(need)) fails.push(`thiếu bước "${need}"`);
  for (const ban of c.expect.steps_exclude ?? []) if (present.has(ban)) fails.push(`có bước thừa "${ban}"`);

  const minReasons = c.expect.min_reasons ?? 0;
  if (reasons.length < minReasons) fails.push(`chỉ ${reasons.length}/${minReasons} ý có dẫn chứng`);
  for (const r of reasons) if (!r.evidence_ids?.length) fails.push(`ý không trích bằng chứng: "${r.text.slice(0, 40)}…"`);

  if (c.expect.evidence_keys?.length) {
    const cited = reasons.flatMap((r) => r.evidence_ids ?? []).join(" ");
    if (!c.expect.evidence_keys.some((k) => cited.includes(k))) fails.push(`không trích bằng chứng đúng trọng tâm (${c.expect.evidence_keys.join(" / ")})`);
  }
  for (const p of c.expect.no_payload ?? []) if ((payload as Record<string, unknown>)[p]) fails.push(`hiện dẫn chứng không liên quan: ${p}`);
  for (const m of c.expect.must_mention ?? [])
    if (!`${answer} ${reasons.map((r) => r.text).join(" ")}`.toLowerCase().includes(m.toLowerCase())) fails.push(`câu trả lời không nhắc "${m}"`);

  // Số viết bằng chữ là cách lách kiểm tra bằng chứng
  if (/\b(hai|ba|bốn|năm|sáu|bảy|tám|chín|mười)\s+(mươi|trăm|nghìn|triệu|tỉ|tỷ|phần trăm)/i.test(reasons.map((r) => r.text).join(" ")))
    fails.push("có số viết bằng chữ (lách validator)");

  // Ca ngoài phạm vi (min_reasons = 0) trả lời thẳng bằng một câu, không có khối nội dung — hợp lệ
  if (!blocks.length && (c.expect.min_reasons ?? 0) > 0) fails.push("không có khối nội dung nào (blocks rỗng)");
  return { c, ms: Date.now() - started, cost, plan, details, answer, blocks, reasons, followUps, payload, fails };
}

const results: Result[] = [];
const threads = new Map<string, string>();
for (const c of CASES) {
  const key = c.thread ?? c.id;
  if (!threads.has(key)) threads.set(key, `test-${Date.now().toString(36)}-${key}`);
  process.stdout.write(`▶ ${c.id} … `);
  try {
    const r = await run(c, threads.get(key)!);
    results.push(r);
    console.log(r.fails.length ? `LỖI (${r.fails.length}) · ${r.ms}ms · $${r.cost.toFixed(4)}` : `OK · ${r.ms}ms · $${r.cost.toFixed(4)}`);
  } catch (err) {
    console.log(`NGOẠI LỆ: ${err instanceof Error ? err.message : err}`);
    results.push({ c, ms: 0, cost: 0, plan: [], details: [], answer: "", blocks: [], reasons: [], followUps: [], payload: {}, fails: [`ngoại lệ: ${err instanceof Error ? err.message : err}`] });
  }
}

// ── Ghi báo cáo ──
const pass = results.filter((r) => !r.fails.length).length;
const totalCost = results.reduce((a, r) => a + r.cost, 0);
const now = new Date().toISOString().slice(0, 16).replace("T", " ");
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

const md = [
  "# Kết quả test hỏi đáp ở trang hồ sơ KOC",
  "",
  `> Chạy ${now} UTC · KOC \`${CREATOR}\` · ${BASE} · \`npm run test:koc\``,
  `> **${pass}/${results.length} ca đạt** · tổng chi phí AI **$${totalCost.toFixed(4)}** · tổng thời gian ${(results.reduce((a, r) => a + r.ms, 0) / 1000).toFixed(1)}s`,
  "",
  "## Tiêu chí chấm",
  "",
  "| Tiêu chí | Cách kiểm |",
  "|---|---|",
  "| Có dẫn chứng | Mỗi ý trong kết luận phải trích ≥1 `evidence_id`; số ý tối thiểu theo từng ca |",
  "| Đúng trọng tâm | Ý phải trích đúng **nhóm bằng chứng** của câu hỏi (vd hỏi chi phí → `_cost`, hỏi liên hệ → `_contact`, hỏi video → `_video_`) |",
  "| Kế hoạch bám câu hỏi | Bước bắt buộc phải có, bước thừa không được xuất hiện |",
  "| Không nhiễu | Câu hỏi hồ sơ/liên hệ không được kèm bảng báo cáo hay thẻ sản phẩm |",
  "| Không lách validator | Không được viết số bằng chữ (\"hai mươi triệu\") |",
  "",
  "## Tổng hợp",
  "",
  "| # | Ca | Nhóm | Kết quả | Kế hoạch | Ý có dẫn chứng | Thời gian | Chi phí |",
  "|---|---|---|---|---|---|---|---|",
  ...results.map(
    (r, i) =>
      `| ${i + 1} | \`${r.c.id}\` | ${r.c.group} | ${r.fails.length ? "❌" : "✅"} | ${r.plan.length} bước | ${r.reasons.length} | ${(r.ms / 1000).toFixed(1)}s | $${r.cost.toFixed(4)} |`,
  ),
  "",
  "## Chi tiết từng ca",
  "",
  ...results.flatMap((r, i) => [
    `### ${i + 1}. ${r.fails.length ? "❌" : "✅"} \`${r.c.id}\` — ${r.c.group}`,
    "",
    `**Câu hỏi:** ${r.c.question}${r.c.thread ? ` _(hỏi nối tiếp trong cuộc \`${r.c.thread}\`)_` : ""}`,
    "",
    `**Kế hoạch AI lập:** ${r.plan.map((s, n) => `${n + 1}. ${esc(s.title)}`).join(" · ") || "(không có)"}`,
    "",
    `**Kết quả từng bước:** ${r.details.map((d) => esc(d)).join(" · ") || "(không có)"}`,
    "",
    `**Dẫn chứng kèm theo:** ${
      [
        r.payload.products?.length ? `${r.payload.products.length} sản phẩm` : "",
        r.payload.peers?.length ? `${r.payload.peers.length} KOC cùng tầm` : "",
        r.payload.videos?.length ? `${r.payload.videos.length} video` : "",
        r.payload.report ? "bảng báo cáo" : "",
      ]
        .filter(Boolean)
        .join(", ") || "(không có)"
    }`,
    "",
    `**Trả lời (tóm tắt nội bộ):** ${esc(r.answer) || "_(trống)_"}`,
    "",
    `**Bố cục model tự dựng:** ${r.blocks.map((b) => `${b.type}${b.data ? `:${b.data}` : ""}`).join(" → ") || "(trống)"}`,
    "",
    ...(r.reasons.length ? ["**Các ý + bằng chứng được trích:**", "", ...r.reasons.map((x) => `- ${esc(x.text)} — \`${x.evidence_ids.join("`, `")}\``), ""] : []),
    ...(r.followUps.length ? ["**Gợi ý hỏi tiếp:**", "", ...r.followUps.map((q) => `- ${esc(q)}`), ""] : []),
    ...(r.fails.length ? ["**Không đạt:**", "", ...r.fails.map((f) => `- ${esc(f)}`), ""] : []),
  ]),
].join("\n");

await writeFile("docs/08-test-koc-chat.md", md, "utf8");
console.log(`\n${pass}/${results.length} ca đạt · $${totalCost.toFixed(4)} · đã ghi docs/08-test-koc-chat.md`);
process.exit(pass === results.length ? 0 : 1);
