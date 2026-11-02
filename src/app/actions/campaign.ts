"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db/mongo";
import { C } from "@/lib/db/collections";
import { CAMPAIGN_CATEGORIES, parseCampaignForm, type FieldErrors } from "@/lib/campaign";
import { DEFAULT_CRITERIA, criteriaWarnings, sanitizeExtracted, type BriefPreview, type Criteria, type CriteriaSources } from "@/lib/brief";
import { parseBrief } from "@/lib/brief-parser";
import { scoreCampaign } from "@/lib/scoring/run";
import { runS3 } from "@/lib/pipeline/s3-content";
import { runS5 } from "@/lib/pipeline/s5-recommend";
import { runPipeline } from "@/lib/pipeline/run";
import { runS4 } from "@/lib/pipeline/s4-video";
import { revalidatePath } from "next/cache";

export interface CampaignFormState {
  errors: FieldErrors;
  /** Raw submitted values, so the form keeps what the user typed after a validation error */
  values?: Record<string, string>;
  /** Present once the brief is understood → the modal shows the confirm step */
  preview?: BriefPreview & { prompt: string | null; mode: "prompt" | "advanced" };
}

const rawValues = (f: FormData) => Object.fromEntries([...f.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]));

/**
 * Step 1 of "Chiến dịch mới": understand the brief.
 * Free text → one cached Haiku call (Step 3 brief parser); advanced filters → used as-is and
 * override anything the AI read from the text. Nothing is saved yet.
 */
export async function previewCampaign(_prev: CampaignFormState, formData: FormData): Promise<CampaignFormState> {
  const { input, errors } = parseCampaignForm(formData);
  if (Object.keys(errors).length) return { errors, values: rawValues(formData) };

  const criteria: Criteria = { ...DEFAULT_CRITERIA, audience_ages: [] };
  const sources: CriteriaSources = {};
  let suggestions: string[] = [];
  let llm: BriefPreview["llm"] = null;

  if (input.prompt) {
    try {
      const parsed = await parseBrief(input.prompt);
      Object.assign(criteria, parsed.values);
      for (const f of parsed.fields) sources[f] = "prompt";
      suggestions = parsed.suggestions;
      llm = {
        used: true,
        tokens_in: parsed.usage.tokens_in,
        tokens_out: parsed.usage.tokens_out,
        cost_usd: parsed.usage.cost_usd,
        cached: parsed.usage.cache_hit,
        latency_ms: parsed.usage.latency_ms,
      };
    } catch (err) {
      return { errors: { prompt: err instanceof Error ? err.message : "AI chưa phân tích được mô tả" }, values: rawValues(formData) };
    }
  }

  if (input.mode === "advanced") {
    const set = <K extends keyof Criteria>(key: K, value: Criteria[K] | null | undefined) => {
      if (value === null || value === undefined) return;
      criteria[key] = value;
      sources[key] = "form";
    };
    set("category_id", input.category_id ?? undefined);
    set("budget_total", input.budget_total);
    set("budget_min_per_koc", input.budget_min_per_koc);
    set("budget_max_per_koc", input.budget_max_per_koc);
    set("koc_count", input.koc_count ?? undefined);
    const k = (name: string) => {
      const v = String(formData.get(name) ?? "").trim();
      return v === "" ? null : Math.round(Number(v) * 1000);
    };
    set("followers_min", k("followers_min_k"));
    set("followers_max", k("followers_max_k"));
  }

  return {
    errors: {},
    values: rawValues(formData),
    preview: { criteria, sources, suggestions, warnings: criteriaWarnings(criteria), llm, prompt: input.prompt, mode: input.mode },
  };
}

/** Step 2: the seller confirmed the criteria → store the campaign and open it. */
export async function confirmCampaign(formData: FormData): Promise<void> {
  const payload = JSON.parse(String(formData.get("payload") ?? "{}")) as NonNullable<CampaignFormState["preview"]>;
  // Never trust the round-trip: re-sanitize the criteria the client sent back
  const { values } = sanitizeExtracted(payload.criteria as unknown as Record<string, unknown>);
  const criteria: Criteria = { ...DEFAULT_CRITERIA, audience_ages: [], ...values };

  const id = randomUUID();
  const db = await getDb();
  await db.collection(C.campaigns).insertOne({
    _id: id as never,
    mode: payload.mode === "prompt" ? "prompt" : "advanced",
    prompt: typeof payload.prompt === "string" ? payload.prompt.slice(0, 1000) : null,
    criteria,
    criteria_sources: payload.sources ?? {},
    ai_suggestions: (payload.suggestions ?? []).slice(0, 3),
    brief_llm: payload.llm ?? null,
    // flat copies used by list/detail pages
    category_id: criteria.category_id,
    category_name: CAMPAIGN_CATEGORIES.find((c) => c.id === criteria.category_id)?.name ?? criteria.category_id,
    budget_total: criteria.budget_total,
    budget_min_per_koc: criteria.budget_min_per_koc,
    budget_max_per_koc: criteria.budget_max_per_koc,
    koc_count: criteria.koc_count,
    status: "confirmed", // S2 scoring below moves it to "scored"
    created_at: new Date(),
  });
  // Whole pipeline runs in the background and is resumable (src/lib/pipeline/run.ts);
  // the campaign page shows the agent steps as they complete.
  void runPipeline(id);
  redirect(`/campaigns/${id}`);
}

/** Re-run S2 (e.g. after more KOCs were crawled). Deterministic, replaces previous scores. */
export async function rescoreCampaign(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  await scoreCampaign(id);
  await runS3(id);
  await runS4(id);
  await runS5(id);
  revalidatePath(`/campaigns/${id}`);
}

/** Continue an interrupted / failed campaign from the first unfinished step (finished work is reused). */
export async function resumeCampaign(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  void runPipeline(id);
  revalidatePath(`/campaigns/${id}`);
}
