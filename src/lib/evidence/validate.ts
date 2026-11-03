/**
 * Anti-hallucination gate for LLM-written reasons (docs/02-tola-ai.md §5).
 * A reason survives only if it cites ≥1 evidence id that really belongs to that KOC, and every
 * number it mentions appears in one of the cited evidence claims (numbers come from code, never the LLM).
 */
export interface Reason {
  text: string;
  evidence_ids: string[];
}

export interface ValidationResult {
  kept: Reason[];
  dropped: { reason: Reason; why: "no_evidence" | "unknown_evidence" | "unsupported_number" }[];
}

const NUM = /\d+(?:[.,]\d+)*/g;
const norm = (n: string) => n.replace(/[.,]/g, "");

export function validateReasons(reasons: Reason[], evidence: Map<string, string>): ValidationResult {
  const kept: Reason[] = [];
  const dropped: ValidationResult["dropped"] = [];
  for (const r of reasons) {
    const ids = [...new Set(r.evidence_ids)];
    if (!ids.length) {
      dropped.push({ reason: r, why: "no_evidence" });
      continue;
    }
    if (ids.some((id) => !evidence.has(id))) {
      dropped.push({ reason: r, why: "unknown_evidence" });
      continue;
    }
    const cited = ids.map((id) => evidence.get(id)!).join(" ");
    const citedNums = new Set((cited.match(NUM) ?? []).map(norm));
    if ((r.text.match(NUM) ?? []).some((n) => !citedNums.has(norm(n)))) {
      dropped.push({ reason: r, why: "unsupported_number" });
      continue;
    }
    kept.push({ text: r.text, evidence_ids: ids });
  }
  return { kept, dropped };
}
