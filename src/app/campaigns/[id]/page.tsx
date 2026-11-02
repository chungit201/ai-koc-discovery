import { AlertTriangle, ArrowUp, Bot, CircleCheck, Wallet } from "lucide-react";
import type { S5Pick } from "@/lib/pipeline/s5-recommend";
import type { Reason } from "@/lib/evidence/validate";
import { AgentSteps, ResumeButton, type AgentStep } from "@/components/agent-steps";
import { resumeCampaign } from "@/app/actions/campaign";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { AutoRefresh } from "@/components/auto-refresh";
import { EvidenceList } from "@/components/evidence-list";
import { VideoEvidence } from "@/components/video-evidence";
import { campaignTitle, getCampaign, getShortlist, type ShortlistRow } from "@/lib/data/queries";
import { fmtM } from "@/lib/campaign";
import { compact, dateTime } from "@/lib/format";
import { SCORE_LABELS, WEIGHTS, type ScoreKey } from "@/lib/scoring/rules";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCampaign(id);
  if (!c) notFound();
  const { summary, screened, videoDone, s3, s4, s5, error, stalled, rows } = await getShortlist(id);
  const halted = Boolean(error) || stalled;
  const scored = Boolean(summary);
  const pickN = c.koc_count ?? 5;
  const finished = Boolean(s5) && !error;
  const pickBy = new Map((s5?.picks ?? []).map((p, i) => [p.creator_id, { ...p, order: i }]));
  const picks = rows.filter((r) => pickBy.has(r.creator_id)).sort((a, b) => pickBy.get(a.creator_id)!.order - pickBy.get(b.creator_id)!.order);
  const reserve = rows.filter((r) => !pickBy.has(r.creator_id));

  const chips = [
    c.category_name,
    c.budget_total ? `Tổng ${fmtM(c.budget_total)}` : null,
    c.budget_max_per_koc ? `${c.budget_min_per_koc ? `${fmtM(c.budget_min_per_koc)} – ` : "≤ "}${fmtM(c.budget_max_per_koc)}/KOC` : null,
    c.koc_count ? `${c.koc_count} KOC` : null,
  ].filter(Boolean) as string[];

  // Each step: done → its result line; first unfinished → running (or error); the rest pending
  const raw: { label: string; done: boolean; detail?: string; doing: string }[] = [
    { label: "Hiểu yêu cầu chiến dịch", done: true, detail: chips.join(" · "), doing: "" },
    {
      label: "Lọc & chấm điểm KOC",
      done: scored,
      detail: summary ? `Quét ${summary.pool.toLocaleString("vi-VN")} KOC → ${summary.eligible} đạt tiêu chí → rút gọn ${summary.shortlisted} KOC` : undefined,
      doing: "Đang đối chiếu follower, khán giả, ngân sách, doanh thu…",
    },
    {
      label: "Đọc nội dung từng KOC",
      done: screened,
      detail: s3 ? `Đã đọc bio, video và sản phẩm của ${s3.kocs} KOC` : undefined,
      doing: "AI đang đọc bio, tiêu đề video và sản phẩm đã bán…",
    },
    {
      label: "Xem video của KOC dẫn đầu",
      done: videoDone,
      detail: s4 ? `Đã xem ${s4.videos} video của ${s4.kocs} KOC để kiểm chứng demo sản phẩm` : undefined,
      doing: "AI đang xem khung hình video — mất vài phút…",
    },
    {
      label: "Chọn KOC, chia ngân sách & viết lý do",
      done: Boolean(s5),
      detail: s5 ? `Chọn ${s5.picks.length} KOC · phân bổ ${fmtM(s5.allocated)}${s5.budget_total ? ` / ${fmtM(s5.budget_total)}` : ""} (ước tính) · lý do đều kèm bằng chứng` : undefined,
      doing: "AI đang chọn KOC trong ngân sách và viết lý do kèm bằng chứng…",
    },
  ];
  const current = raw.findIndex((s) => !s.done);
  const steps: AgentStep[] = raw.map((s, i) =>
    s.done
      ? { label: s.label, status: "done", detail: s.detail }
      : i === current
        ? error
          ? { label: s.label, status: "error", detail: "Có lỗi khi xử lý bước này. Tiến độ trước đó đã được lưu — bấm Tiếp tục để chạy lại từ đây." }
          : stalled
          ? { label: s.label, status: "error", detail: "Quá trình bị gián đoạn. Tiến độ đã được lưu — bấm Tiếp tục để chạy tiếp từ bước này." }
          : { label: s.label, status: "running", detail: s.doing }
        : { label: s.label, status: "pending" },
  );

  const thought = `Tìm ${pickN} KOC ${String(c.category_name ?? "").toLowerCase()}${c.budget_total ? `, tổng ngân sách ${fmtM(c.budget_total)}` : ""} — lọc theo dữ liệu thật, đọc nội dung và xem video để kiểm chứng.`;

  return (
    <main className="flex min-h-screen flex-col">
      {!finished && !halted && <AutoRefresh seconds={4} />}
      <header className="sticky top-0 z-10 bg-page/90 px-8 py-4 backdrop-blur">
        <h1 className="truncate text-[15px] font-semibold">{campaignTitle(c)}</h1>
        <div className="text-[12px] text-ink-muted">
          <Link href="/campaigns" className="hover:text-brand">
            Chiến dịch
          </Link>{" "}
          · {dateTime(c.created_at)}
        </div>
      </header>

      {/* ── Conversation ── */}
      <div className="mx-auto w-full max-w-[980px] flex-1 space-y-5 px-6 pb-10 pt-4">
        {/* user turn */}
        <div className="flex justify-end">
          <div className="max-w-[75%] rounded-2xl bg-zinc-100 px-4 py-3 text-[14.5px] leading-relaxed">{c.prompt?.replaceAll("**", "") ?? chips.join(" · ")}</div>
        </div>

        {/* AI turn */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-[16px] font-bold">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-white">
              <Bot size={16} />
            </span>
            DETOLA AI
          </div>
          <AgentSteps key={String(finished)} steps={steps} done={finished} thought={thought} />
          {halted && (
            <form action={resumeCampaign}>
              <input type="hidden" name="id" value={id} />
              <ResumeButton />
            </form>
          )}

          {finished && summary && (
            <>
              <p className="text-[14.5px] leading-relaxed">
                Từ <b className="num">{summary.pool.toLocaleString("vi-VN")}</b> KOC, có <b className="num">{summary.eligible}</b> KOC đạt tiêu chí. Mình đề xuất{" "}
                <b className="text-brand">{picks.length} KOC</b> dưới đây, tổng chi phí ước tính <b className="num">{fmtM(s5!.allocated)}</b>
                {s5!.budget_total ? <> trong ngân sách {fmtM(s5!.budget_total)}</> : null}. Mỗi lý do đều dẫn bằng chứng từ dữ liệu thật.
              </p>
              {picks.length > 0 && (
                <div className="overflow-hidden rounded-2xl border border-line bg-white">
                  <table className="w-full text-[13.5px]">
                    <thead className="bg-zinc-50 text-left text-[11.5px] uppercase tracking-wide text-ink-muted">
                      <tr>
                        <th className="px-4 py-2 font-semibold">#</th>
                        <th className="px-4 py-2 font-semibold">KOC</th>
                        <th className="px-4 py-2 text-right font-semibold">Điểm</th>
                        <th className="px-4 py-2 text-right font-semibold">Ngân sách (ước tính)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {picks.map((r, i) => (
                        <tr key={r.creator_id} className="border-t border-line">
                          <td className="num px-4 py-2.5 text-ink-muted">{i + 1}</td>
                          <td className="px-4 py-2.5">
                            <a href={`#koc-${r.creator_id}`} className="flex items-center gap-2 font-medium hover:text-brand">
                              <Avatar id={r.creator_id} name={r.handle} size={26} /> {r.nickname || r.handle}
                            </a>
                          </td>
                          <td className="num px-4 py-2.5 text-right">{Math.round(r.total)}</td>
                          <td className="num px-4 py-2.5 text-right font-semibold">{fmtM(pickBy.get(r.creator_id)!.budget)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line bg-zinc-50 font-semibold">
                        <td colSpan={3} className="px-4 py-2.5">Tổng</td>
                        <td className="num px-4 py-2.5 text-right">
                          {fmtM(s5!.allocated)}
                          {s5!.budget_total ? <span className="font-normal text-ink-muted"> / {fmtM(s5!.budget_total)}</span> : null}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              {(s5!.picks.length < s5!.wanted || s5!.skipped_over_cap.length > 0) && (
                <div className="space-y-1.5 rounded-2xl border border-line bg-white px-4 py-3 text-[13px] text-ink-muted">
                  {s5!.picks.length < s5!.wanted && (
                    <p>
                      Chỉ có <b className="text-ink">{s5!.picks.length}/{s5!.wanted}</b> KOC đạt điểm tối thiểu {s5!.min_score} trong ngân sách — mình không thêm KOC yếu hơn chỉ để đủ số lượng.
                    </p>
                  )}
                  {s5!.skipped_over_cap.map((k) => {
                    const r = rows.find((x) => x.creator_id === k.creator_id);
                    return (
                      <p key={k.creator_id}>
                        <a href={`#koc-${k.creator_id}`} className="font-medium text-ink hover:text-brand">
                          {r?.nickname || r?.handle || k.creator_id}
                        </a>{" "}
                        (điểm {Math.round(k.score)}) chưa được chọn vì chi phí ước tính tối thiểu {fmtM(k.cost_min)} vượt mức {fmtM(s5!.cap ?? 0)}/KOC.
                      </p>
                    );
                  })}
                </div>
              )}
              {rows.length ? (
                <div className="space-y-4">
                  {picks.map((r, i) => (
                    <KocCard key={r.creator_id} r={r} rank={i + 1} pick={pickBy.get(r.creator_id)} />
                  ))}
                  {reserve.length > 0 && <h3 className="pt-4 text-[15px] font-semibold text-ink-muted">KOC dự phòng · {reserve.length}</h3>}
                  {reserve.map((r, i) => (
                    <KocCard key={r.creator_id} r={r} rank={picks.length + i + 1} />
                  ))}
                </div>
              ) : (
                <p className="rounded-2xl border border-line bg-white p-6 text-center text-ink-muted">
                  Chưa tìm thấy KOC phù hợp. Thử nới tiêu chí (follower, ngân sách, MCN) và tạo chiến dịch mới.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Composer (follow-up chat is not wired yet) ── */}
      <div className="sticky bottom-0 bg-gradient-to-t from-page via-page to-transparent px-6 pb-5 pt-6">
        <div className="mx-auto max-w-[980px] rounded-2xl border border-line bg-white px-4 py-3 shadow-sm">
          <textarea
            disabled
            rows={2}
            placeholder="Hỏi thêm về chiến dịch này… (sắp có)"
            className="w-full resize-none bg-transparent text-[14px] outline-none placeholder:text-ink-muted"
          />
          <div className="flex justify-end">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-zinc-100 text-zinc-400">
              <ArrowUp size={16} />
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}

/** Total score as a ring (single value meter, track = lighter step of the same hue). */
function ScoreRing({ value }: { value: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid h-14 w-14 shrink-0 place-items-center" role="img" aria-label={`Điểm ${value.toFixed(1)} trên 100`}>
      <svg viewBox="0 0 56 56" className="absolute inset-0 -rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--color-brand-soft)" strokeWidth="5" />
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--color-brand)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(value / 100) * c} ${c}`} />
      </svg>
      <span className="num text-[15px] font-bold">{Math.round(value)}</span>
    </div>
  );
}

const STRENGTH_ORDER = { strong: 0, medium: 1, weak: 2 } as const;

function KocCard({ r, rank, pick }: { r: ShortlistRow; rank: number; pick?: S5Pick }) {
  const picked = Boolean(pick);
  const claimOf = new Map(r.evidence.map((e) => [e.id, e.claim]));
  const keys = Object.keys(WEIGHTS) as ScoreKey[];
  const ev = [...r.evidence].filter((e) => e.type !== "ai" && e.type !== "video_moment").sort(
    (a, b) => (STRENGTH_ORDER[a.strength as keyof typeof STRENGTH_ORDER] ?? 3) - (STRENGTH_ORDER[b.strength as keyof typeof STRENGTH_ORDER] ?? 3),
  );
  const meta = [r.handle, `${compact(r.followers)} follower`, r.audience_age ? `Nữ ${r.audience_age}` : null, r.mcn].filter(Boolean).join(" · ");

  return (
    <article id={`koc-${r.creator_id}`} className={`card flex scroll-mt-20 flex-col p-5 transition hover:shadow-md ${picked ? "ring-2 ring-brand/40" : ""}`}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <Avatar id={r.creator_id} name={r.handle} size={52} />
          <span
            className={`num absolute -left-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10.5px] font-bold text-white ring-2 ring-white ${picked ? "bg-brand" : "bg-zinc-700"}`}
          >
            {rank}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link href={`/kocs/${r.creator_id}`} className="truncate text-[15px] font-semibold hover:text-brand">
              {r.nickname || r.handle}
            </Link>
            {picked && <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[10.5px] font-semibold text-brand">Đề xuất</span>}
          </div>
          <div className="truncate text-[12px] text-ink-muted">{meta}</div>
        </div>
        <ScoreRing value={r.total} />
      </div>

      {/* Score strip: one row, number first */}
      <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-2.5 border-y border-line py-3 sm:grid-cols-6">
        {keys.map((k) => (
          <div key={k} className="min-w-0">
            <div className="truncate text-[10.5px] text-ink-muted">{SCORE_LABELS[k]}</div>
            <div className="num text-[14px] font-semibold">{Math.round(r.scores[k] ?? 0)}</div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-brand-soft">
              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(3, r.scores[k] ?? 0)}%` }} />
            </div>
          </div>
        ))}
      </div>

      {/* Body: why it fits | what the AI saw */}
      <div className="mt-4 grid flex-1 gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{pick ? "Lý do đề xuất" : "Vì sao phù hợp"}</h3>
          {pick && pick.reasons.length > 0 ? (
            <ul className="space-y-2">
              {pick.reasons.map((x) => (
                <ReasonLine key={x.text} reason={x} claims={claimOf} />
              ))}
              {pick.caution && <ReasonLine reason={pick.caution} claims={claimOf} caution />}
            </ul>
          ) : (
            r.ai && (
              <div className="space-y-1.5">
                <p className="text-[13px] leading-snug text-zinc-800">{r.ai.summary}</p>
                {r.ai.risks[0] && (
                  <p className="flex gap-1.5 text-[12px] text-amber-700">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {r.ai.risks[0]}
                  </p>
                )}
              </div>
            )
          )}
          {pick && <h3 className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Bằng chứng</h3>}
          <EvidenceList items={ev} initial={3} />
          <div className="flex items-center justify-between border-t border-line pt-2.5 text-[12px]">
            <span className="flex items-center gap-1.5 text-ink-muted">
              <Wallet size={14} className="text-brand" /> Chi phí ước tính
            </span>
            <span className="num text-right">
              {pick ? <b className="font-semibold text-brand">{fmtM(pick.budget)}</b> : null}
              <span className={pick ? "ml-1.5 text-ink-muted" : "font-semibold"}>
                {pick ? "· " : ""}
                {fmtM(r.cost.min)} – {fmtM(r.cost.max)}
              </span>
            </span>
          </div>
        </div>
        <div className="min-w-0">
          {r.videos.length ? (
            <VideoEvidence videos={r.videos} handle={r.handle} />
          ) : (
            <p className="text-[12px] text-ink-muted">Chưa phân tích video.</p>
          )}
        </div>
      </div>
    </article>
  );
}

/** One AI reason; hovering/clicking the evidence chip shows the exact claims it cites. */
function ReasonLine({ reason, claims, caution }: { reason: Reason; claims: Map<string, string>; caution?: boolean }) {
  const cited = reason.evidence_ids.map((id) => claims.get(id)).filter(Boolean) as string[];
  return (
    <li className={`flex gap-2 text-[13px] leading-snug ${caution ? "text-amber-800" : "text-zinc-800"}`}>
      {caution ? <AlertTriangle size={14} className="mt-0.5 shrink-0" /> : <CircleCheck size={14} className="mt-0.5 shrink-0 text-brand" />}
      <span>
        {reason.text}{" "}
        <details className="inline">
          <summary className="inline cursor-pointer list-none rounded-full bg-zinc-100 px-1.5 py-px text-[10.5px] font-medium text-ink-muted hover:bg-brand-soft hover:text-brand">
            {cited.length} bằng chứng
          </summary>
          <span className="mt-1 block space-y-0.5 border-l-2 border-brand-soft pl-2 text-[11.5px] text-ink-muted">
            {cited.map((c) => (
              <span key={c} className="block">
                {c}
              </span>
            ))}
          </span>
        </details>
      </span>
    </li>
  );
}
