import "server-only";
import type { Db } from "mongodb";
import { getDb } from "../db/mongo";
import { C } from "../db/collections";
import { DEFAULT_CRITERIA, type Criteria } from "../brief";
import { compact, pct, vnd } from "../format";
import { SCORING_VERSION, clamp01, estimateCost, focusPattern, percentileOf, weightsFor, type ScoreKey } from "./rules";

/**
 * S2 — hard filters + quantitative scoring + evidence for one campaign. Pure code, 0 tokens.
 * Deterministic and idempotent: re-running replaces this campaign's scores and evidence.
 */

const COSMETICS = "848776,848648";
export const SHORTLIST_SIZE = (n: number) => Math.min(60, Math.max(15, n * 3));
const MIN_VIDEOS = 3;

export interface Evidence {
  _id: string;
  campaign_id: string;
  creator_id: string;
  key: string;
  type: "metric" | "product" | "video" | "audience" | "cost";
  claim: string; // Vietnamese sentence written by code, numbers from the DB
  value: number | string | null;
  source: { collection: string; ref: string };
  strength: "strong" | "medium" | "weak";
}

interface Creator {
  _id: string;
  handle: string;
  nickname?: string;
  followers?: number;
  mcn?: string | null;
  bio?: string | null;
  audience?: { gender_majority?: string | null; age_majority?: string | null; age_buckets_matched?: string[] };
}

export async function scoreCampaign(campaignId: string) {
  const started = Date.now();
  const db = await getDb();
  const camp = await db.collection(C.campaigns).findOne({ _id: campaignId as never });
  if (!camp) throw new Error("Không tìm thấy chiến dịch");
  const crit: Criteria = { ...DEFAULT_CRITERIA, audience_ages: [], ...((camp.criteria as Partial<Criteria>) ?? legacyCriteria(camp)) };

  // ── Load the pool (everything is in MongoDB already; no crawling here) ──
  const creators = await db.collection<Creator>(C.creators).find({}).toArray();
  const detailed = new Set((await db.collection(C.creators).find({ detail_updated_at: { $exists: true } }, { projection: { _id: 1 } }).toArray()).map((c) => String(c._id)));
  const listRows = await latestBy(db, { source: "web:creator/queryList", category_scope: { $in: [COSMETICS, crit.category_id] } }, (r) => (r.category_scope === crit.category_id ? 2 : 1));
  const totals = await latestBy(db, { source: "web:creator/detail/total", category_scope: "all" }, () => 1);
  const products = await db
    .collection(C.creatorProducts)
    .aggregate<{ _id: string; items: { name: string; revenue: number; sales: number; product_id: string }[] }>([
      { $lookup: { from: C.products, localField: "product_id", foreignField: "_id", as: "p" } },
      { $group: { _id: "$creator_id", items: { $push: { name: { $first: "$p.name" }, revenue: "$revenue", sales: "$sales_volume", product_id: "$product_id" } } } },
    ])
    .toArray();
  const productsBy = new Map(products.map((p) => [p._id, p.items]));
  const videos = await db
    .collection(C.videos)
    .aggregate<{ _id: string; items: { id: string; title: string; views: number; revenue: number }[] }>([
      { $group: { _id: "$creator_id", items: { $push: { id: "$_id", title: "$title", views: "$views", revenue: "$revenue" } } } },
    ])
    .toArray();
  const videosBy = new Map(videos.map((v) => [v._id, v.items]));

  const focus = focusPattern(crit.category_id, crit.product_focus);
  const focusLabel = crit.product_focus ?? "danh mục chiến dịch";

  // ── Hard filters ──
  type Row = { c: Creator; list: Record<string, any>; total?: Record<string, any>; cost: ReturnType<typeof estimateCost>; reasons: string[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const rows: Row[] = [];
  for (const c of creators) {
    const id = String(c._id);
    const list = listRows.get(id);
    if (!list) continue; // not in the campaign's category pool at all
    const reasons: string[] = [];
    const followers = c.followers ?? 0;
    if (!detailed.has(id)) reasons.push("no_detail");
    if (crit.followers_min !== null && followers < crit.followers_min) reasons.push("followers_low");
    if (crit.followers_max !== null && followers > crit.followers_max) reasons.push("followers_high");
    if (crit.audience_gender && c.audience?.gender_majority && c.audience.gender_majority !== crit.audience_gender) reasons.push("gender");
    if (crit.mcn === "no" && c.mcn) reasons.push("mcn_signed");
    if (crit.mcn === "yes" && !c.mcn) reasons.push("mcn_unsigned");
    const cost = estimateCost(followers, Boolean(c.mcn));
    if (crit.budget_max_per_koc && cost.min > crit.budget_max_per_koc) reasons.push("over_budget");
    if (detailed.has(id) && (videosBy.get(id)?.length ?? 0) < MIN_VIDEOS) reasons.push("few_videos");
    rows.push({ c, list, total: totals.get(id), cost, reasons });
  }
  const eligible = rows.filter((r) => r.reasons.length === 0);

  // ── Percentiles are computed inside the eligible pool ──
  const pRev = percentileOf(eligible.map((r) => r.list.revenue ?? 0));
  const pViews = percentileOf(eligible.map((r) => r.list.views ?? 0));
  const pEng = percentileOf(eligible.map((r) => r.list.video_engagement_rate ?? 0));
  // Absolute revenue from campaign-focus products, ranked inside the eligible pool
  const focusRevenueOf = (id: string) => (productsBy.get(id) ?? []).filter((p) => focus.test(p.name ?? "")).reduce((a, p) => a + (p.revenue ?? 0), 0);
  const pFocusRev = percentileOf(eligible.map((r) => focusRevenueOf(String(r.c._id))));
  const weights = weightsFor(crit.product_focus);

  const scoreDocs: Record<string, unknown>[] = [];
  const evidenceDocs: Evidence[] = [];
  const short = campaignId.slice(0, 8);

  for (const r of eligible) {
    const id = String(r.c._id);
    const ev = (key: string, e: Omit<Evidence, "_id" | "campaign_id" | "creator_id" | "key">) => {
      const _id = `ev_${short}_${id}_${key}`;
      evidenceDocs.push({ _id, campaign_id: campaignId, creator_id: id, key, ...e });
      return _id;
    };
    const ids: string[] = [];
    const prods = productsBy.get(id) ?? [];
    const vids = videosBy.get(id) ?? [];
    const daily: { day: string; revenue: number | null }[] = r.total?.daily ?? [];

    // performance
    const performance = 0.6 * pRev(r.list.revenue ?? 0) + 0.4 * pViews(r.list.views ?? 0);
    ids.push(
      ev("revenue", {
        type: "metric",
        claim: `Doanh thu ${r.list.category_scope === crit.category_id ? "danh mục" : "mỹ phẩm"} 30 ngày ${vnd(r.list.revenue)} (top ${Math.max(1, Math.round((1 - pRev(r.list.revenue ?? 0)) * 100))}% nhóm đủ điều kiện)`,
        value: r.list.revenue ?? null,
        source: { collection: C.creatorMetrics, ref: String(r.list._id) },
        strength: pRev(r.list.revenue ?? 0) >= 0.7 ? "strong" : "medium",
      }),
    );

    // engagement
    const engagement = pEng(r.list.video_engagement_rate ?? 0);
    ids.push(
      ev("engagement", {
        type: "metric",
        claim: `Tỷ lệ tương tác video ${pct(r.list.video_engagement_rate)} (cao hơn ${Math.round(engagement * 100)}% KOC đủ điều kiện)`,
        value: r.list.video_engagement_rate ?? null,
        source: { collection: C.creatorMetrics, ref: String(r.list._id) },
        strength: engagement >= 0.7 ? "strong" : engagement >= 0.4 ? "medium" : "weak",
      }),
    );

    // consistency (exact per-day values)
    const dayRev = daily.map((d) => d.revenue ?? 0);
    const sum = dayRev.reduce((a, b) => a + b, 0);
    const active = dayRev.filter((v) => v > 0).length;
    const topShare = sum ? Math.max(...dayRev) / sum : 1;
    const consistency = daily.length ? clamp01(0.6 * (active / daily.length) + 0.4 * (1 - topShare)) : 0.5;
    if (daily.length)
      ids.push(
        ev("consistency", {
          type: "metric",
          claim: `Có doanh thu ${active}/${daily.length} ngày; ngày cao nhất chiếm ${pct(topShare, 0)} tổng`,
          value: active,
          source: { collection: C.creatorMetrics, ref: String(r.total?._id) },
          strength: consistency >= 0.7 ? "strong" : "medium",
        }),
      );

    // content fit: products + videos about the campaign focus, and how specialised the KOC is
    const prodRevenue = prods.reduce((a, p) => a + (p.revenue ?? 0), 0);
    const focusProds = prods.filter((p) => focus.test(p.name ?? ""));
    const focusProdRevenue = focusProds.reduce((a, p) => a + (p.revenue ?? 0), 0);
    const focusVideos = vids.filter((v) => focus.test(v.title ?? ""));
    const specialisation = r.total?.revenue ? clamp01((r.list.revenue ?? 0) / r.total.revenue) : 0.5;
    const content_fit = clamp01(
      0.3 * (prodRevenue ? focusProdRevenue / prodRevenue : 0) + // share of their sales
        0.25 * (focusProdRevenue > 0 ? pFocusRev(focusProdRevenue) : 0) + // absolute focus sales vs peers
        0.25 * Math.min(1, focusVideos.length / 5) + // talks about it on video
        0.2 * specialisation, // cosmetics share of total revenue
    );
    if (focusProds.length) {
      const top = [...focusProds].sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))[0];
      ids.push(
        ev("focus_products", {
          type: "product",
          claim: `Đã bán ${focusProds.length} sản phẩm ${focusLabel}, doanh thu ${vnd(focusProdRevenue)} (${pct(prodRevenue ? focusProdRevenue / prodRevenue : 0, 0)} doanh thu sản phẩm); nổi bật: ${(top.name ?? "").slice(0, 70)}`,
          value: focusProdRevenue,
          source: { collection: C.creatorProducts, ref: `${id}:${top.product_id}` },
          strength: focusProdRevenue / (prodRevenue || 1) >= 0.3 ? "strong" : "medium",
        }),
      );
    }
    if (focusVideos.length) {
      const top = [...focusVideos].sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0];
      ids.push(
        ev("focus_videos", {
          type: "video",
          claim: `${focusVideos.length}/${vids.length} video 30 ngày nói về ${focusLabel}; video nhiều view nhất ${compact(top.views)} lượt`,
          value: focusVideos.length,
          source: { collection: C.videos, ref: String(top.id) },
          strength: focusVideos.length >= 3 ? "strong" : "medium",
        }),
      );
    }
    if (r.total?.revenue)
      ids.push(
        ev("specialisation", {
          type: "metric",
          claim: `${pct(specialisation, 0)} doanh thu tổng đến từ mỹ phẩm (${vnd(r.list.revenue)} / ${vnd(r.total.revenue)})`,
          value: specialisation,
          source: { collection: C.creatorMetrics, ref: String(r.total._id) },
          strength: specialisation >= 0.6 ? "strong" : "medium",
        }),
      );

    // audience fit (Kalodata majority buckets)
    const age = r.c.audience?.age_majority ?? r.c.audience?.age_buckets_matched?.[0] ?? null;
    const ageOk = !crit.audience_ages.length || (age !== null && crit.audience_ages.includes(age));
    const genderOk = !crit.audience_gender || r.c.audience?.gender_majority === crit.audience_gender;
    const audience_fit = (ageOk ? 0.6 : 0.15) + (genderOk ? 0.4 : 0);
    ids.push(
      ev("audience", {
        type: "audience",
        claim: `Khán giả chiếm đa số: ${r.c.audience?.gender_majority === "female" ? "nữ" : (r.c.audience?.gender_majority ?? "?")}, tuổi ${age ?? "?"}${crit.audience_ages.length ? (ageOk ? " — khớp mục tiêu" : " — lệch mục tiêu") : ""}`,
        value: age,
        source: { collection: C.creators, ref: id },
        strength: ageOk && genderOk ? "strong" : "weak",
      }),
    );

    // cost fit (estimate)
    // Per-KOC budget: explicit max, else total ÷ number of KOCs (an even split)
    const perKoc = crit.budget_max_per_koc ?? (crit.budget_total && crit.koc_count ? crit.budget_total / crit.koc_count : null);
    const cost_fit = perKoc ? clamp01(perKoc / r.cost.mid) : 1;
    ids.push(
      ev("cost", {
        type: "cost",
        claim: `Chi phí ước tính ${vnd(r.cost.min)}–${vnd(r.cost.max)}/video, theo quy mô ${compact(r.c.followers)} follower`,
        value: r.cost.mid,
        source: { collection: C.creators, ref: id },
        strength: "weak",
      }),
    );

    const scores: Record<ScoreKey, number> = { performance, content_fit, engagement, cost_fit, consistency, audience_fit };
    const total = (Object.keys(weights) as ScoreKey[]).reduce((a, k) => a + weights[k] * scores[k], 0);
    scoreDocs.push({
      campaign_id: campaignId,
      creator_id: id,
      eligible: true,
      scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, Math.round(v * 1000) / 10])),
      total: Math.round(total * 1000) / 10,
      cost_estimate: r.cost,
      evidence_ids: ids,
      focus_counts: { products: focusProds.length, videos: focusVideos.length },
    });
  }

  // rank + shortlist
  scoreDocs.sort((a, b) => (b.total as number) - (a.total as number));
  const shortlistSize = SHORTLIST_SIZE(crit.koc_count);
  scoreDocs.forEach((d, i) => Object.assign(d, { rank: i + 1, shortlisted: i < shortlistSize }));

  const excluded = rows.filter((r) => r.reasons.length);
  for (const r of excluded)
    scoreDocs.push({ campaign_id: campaignId, creator_id: String(r.c._id), eligible: false, excluded_reasons: r.reasons, cost_estimate: r.cost });
  const reasonCounts: Record<string, number> = {};
  for (const r of excluded) {
    reasonCounts[r.reasons[0]] = (reasonCounts[r.reasons[0]] ?? 0) + 1;
  }

  // ── Persist (replace previous run of this campaign) ──
  const now = new Date();
  await db.collection(C.campaignScores).deleteMany({ campaign_id: campaignId });
  await db.collection(C.evidence).deleteMany({ campaign_id: campaignId });
  if (scoreDocs.length) await db.collection(C.campaignScores).insertMany(scoreDocs.map((d) => ({ ...d, version: SCORING_VERSION, created_at: now })));
  if (evidenceDocs.length) await db.collection<Evidence>(C.evidence).insertMany(evidenceDocs.map((d) => ({ ...d, created_at: now })) as never);
  const summary = {
    version: SCORING_VERSION,
    weights,
    pool: rows.length,
    eligible: eligible.length,
    excluded: excluded.length,
    shortlisted: Math.min(shortlistSize, eligible.length),
    evidence: evidenceDocs.length,
    excluded_by_reason: reasonCounts,
    tokens: 0,
    duration_ms: Date.now() - started,
    scored_at: now,
  };
  await db.collection(C.campaigns).updateOne({ _id: campaignId as never }, { $set: { status: "scored", scoring: summary } });
  return summary;
}

/** Latest metric row per creator for a filter; `prefer` breaks ties between scopes. */
async function latestBy(db: Db, filter: object, prefer: (r: Record<string, unknown>) => number) {
  const rows = await db.collection(C.creatorMetrics).find(filter).sort({ updated_at: -1 }).toArray();
  const map = new Map<string, Record<string, any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const r of rows) {
    const id = String(r.creator_id);
    const cur = map.get(id);
    if (!cur || prefer(r) > prefer(cur)) map.set(id, r);
  }
  return map;
}

/** Campaigns created before `criteria` existed stored flat fields only. */
function legacyCriteria(c: Record<string, unknown>): Partial<Criteria> {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    category_id: (c.category_id as string) ?? DEFAULT_CRITERIA.category_id,
    budget_total: n(c.budget_total),
    budget_min_per_koc: n(c.budget_min_per_koc),
    budget_max_per_koc: n(c.budget_max_per_koc),
    koc_count: n(c.koc_count) ?? DEFAULT_CRITERIA.koc_count,
  };
}
