/**
 * Benchmark một chiến dịch mới từ đầu đến cuối (Step 9 của docs/01-plan.md).
 *
 *   npm run bench -- "<brief>" [--pass2]
 *
 * Tạo chiến dịch từ brief (S1 = 1 call Haiku), rồi chạy S2 → S5 tuần tự, đo
 * thời gian + token + chi phí từng bước và in JSON để dán vào docs/05-benchmark.md.
 * `--pass2` chạy lại toàn bộ pipeline trên cùng chiến dịch (sau khi xoá summary,
 * giữ nguyên cache AI) để đo phần "chạy lại = 0 token".
 */
import { randomUUID } from "node:crypto";
import { closeDb, getDb } from "../src/lib/db/mongo";
import { C } from "../src/lib/db/collections";
import { CAMPAIGN_CATEGORIES } from "../src/lib/campaign";
import { DEFAULT_CRITERIA, criteriaWarnings, type Criteria } from "../src/lib/brief";
import { parseBrief } from "../src/lib/brief-parser";
import { scoreCampaign } from "../src/lib/scoring/run";
import { runS3 } from "../src/lib/pipeline/s3-content";
import { prefetchS4Frames, runS4 } from "../src/lib/pipeline/s4-video";
import { runS5 } from "../src/lib/pipeline/s5-recommend";

const args = process.argv.slice(2);
const pass2 = args.includes("--pass2");
const prompt = args.find((a) => !a.startsWith("--"));
if (!prompt) {
  console.error('Thiếu brief. Ví dụ: npm run bench -- "Cần 6 KOC trang điểm, ngân sách 60 triệu"');
  process.exit(1);
}

const timed = async <T>(fn: () => Promise<T>): Promise<[T, number]> => {
  const t = Date.now();
  const out = await fn();
  return [out, Date.now() - t];
};

const db = await getDb();

// ── S1: brief → criteria (1 call Haiku, cache theo hash brief) ──
const [parsed, s1ms] = await timed(() => parseBrief(prompt));
const criteria: Criteria = { ...DEFAULT_CRITERIA, audience_ages: [], ...parsed.values };
console.log("[bench] kế hoạch AI:", JSON.stringify(parsed.plan, null, 1));
if (args.includes("--plan-only")) {
  console.log("[bench] tiêu chí:", JSON.stringify(criteria));
  await closeDb();
  process.exit(0);
}
const s1 = { ms: s1ms, tokens_in: parsed.usage.tokens_in, tokens_out: parsed.usage.tokens_out, cost_usd: parsed.usage.cost_usd, cached: parsed.usage.cache_hit };

const id = randomUUID();
await db.collection(C.campaigns).insertOne({
  _id: id as never,
  mode: "prompt",
  prompt: prompt.slice(0, 1000),
  criteria,
  plan: parsed.plan,
  criteria_sources: Object.fromEntries(parsed.fields.map((f) => [f, "prompt"])),
  ai_suggestions: parsed.suggestions.slice(0, 3),
  brief_llm: { used: true, ...s1, latency_ms: s1ms },
  category_id: criteria.category_id,
  category_name: CAMPAIGN_CATEGORIES.find((c) => c.id === criteria.category_id)?.name ?? criteria.category_id,
  budget_total: criteria.budget_total,
  budget_min_per_koc: criteria.budget_min_per_koc,
  budget_max_per_koc: criteria.budget_max_per_koc,
  koc_count: criteria.koc_count,
  status: "confirmed",
  created_at: new Date(),
  bench: true,
});
console.log(`[bench] campaign ${id}`);
console.log(`[bench] criteria`, JSON.stringify(criteria), "warnings:", criteriaWarnings(criteria));

/** Các bước trả về null nếu chiến dịch/dữ liệu không còn — với bench thì đó là lỗi, dừng ngay. */
const need = <T>(stage: string, v: T | null): T => {
  if (v === null || v === undefined) throw new Error(`${stage} không trả về kết quả`);
  return v;
};

/** Chỉ đo các bước AI đã lập kế hoạch, giống hệt `runPipeline`. */
const planned = new Set(parsed.plan.steps.map((s) => s.capability));

async function fullRun(label: string) {
  const [s2raw, s2ms] = await timed(() => scoreCampaign(id));
  const s2 = need("S2", s2raw);
  console.log(`[bench] ${label} S2 ${s2ms}ms pool=${s2.pool} eligible=${s2.eligible} shortlist=${s2.shortlisted}`);
  // Khung hình tải song song với S3 như khi chạy thật
  const frames = planned.has("analyse_videos") ? prefetchS4Frames(id).catch((e) => console.error("[bench] prefetch lỗi", e)) : null;

  let s3ms = 0;
  let s3: Awaited<ReturnType<typeof runS3>> | null = null;
  if (planned.has("screen_content")) {
    const [r, ms] = await timed(() => runS3(id).then((x) => need("S3", x)));
    [s3, s3ms] = [r, ms];
    console.log(`[bench] ${label} S3 ${ms}ms calls=${r.calls} new=${r.analysed} cache=${r.from_cache} $${r.cost_usd}`);
  }
  await frames;

  let s4ms = 0;
  let s4: Awaited<ReturnType<typeof runS4>> | null = null;
  if (planned.has("analyse_videos")) {
    const [r, ms] = await timed(() => runS4(id).then((x) => need("S4", x)));
    [s4, s4ms] = [r, ms];
    console.log(`[bench] ${label} S4 ${ms}ms videos=${r.videos} new=${r.analysed} cache=${r.from_cache} failed=${r.failed} $${r.cost_usd}`);
  }

  let s5ms = 0;
  let s5: Awaited<ReturnType<typeof runS5>> | null = null;
  if (planned.has("recommend")) {
    const [r, ms] = await timed(() => runS5(id).then((x) => need("S5", x)));
    [s5, s5ms] = [r, ms];
    console.log(`[bench] ${label} S5 ${ms}ms picks=${r.picks.length}/${r.wanted} $${r.cost_usd}`);
  }

  const total_ms = s2ms + s3ms + s4ms + s5ms;
  const total_cost = (s3?.cost_usd ?? 0) + (s4?.cost_usd ?? 0) + (s5?.cost_usd ?? 0);
  return {
    label,
    s2: { ms: s2ms, ...s2 },
    s3: s3 && { ms: s3ms, ...s3 },
    s4: s4 && { ms: s4ms, ...s4 },
    s5: s5 && { ms: s5ms, ...s5, picks: s5.picks.length },
    total_ms,
    total_cost_usd: Math.round((total_cost + s1.cost_usd) * 1e5) / 1e5,
  };
}

const runs = [await fullRun("pass1")];

if (pass2) {
  await db.collection(C.campaigns).updateOne({ _id: id as never }, { $unset: { scoring: "", s3: "", s4: "", s5: "" } });
  runs.push(await fullRun("pass2 (cache)"));
}

const final = await db.collection(C.campaigns).findOne({ _id: id as never });
console.log(
  "\n[bench] REPORT\n" +
    JSON.stringify(
      {
        campaign_id: id,
        prompt,
        criteria,
        s1,
        runs,
        picks: (final?.s5?.picks ?? []).map((p: { creator_id: string; budget: number; reasons: unknown[] }) => ({ creator_id: p.creator_id, budget: p.budget, reasons: p.reasons.length })),
        allocated: final?.s5?.allocated,
        dropped_reasons: final?.s5?.dropped_reasons,
        skipped_over_cap: final?.s5?.skipped_over_cap?.length ?? 0,
      },
      null,
      2,
    ),
);
await closeDb();
process.exit(0);
