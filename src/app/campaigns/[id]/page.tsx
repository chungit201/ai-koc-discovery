import { AlertTriangle, CircleCheck, Loader2, Wallet } from "lucide-react";
import type { S5Pick } from "@/lib/pipeline/s5-recommend";
import type { Reason } from "@/lib/evidence/validate";
import { AgentSteps, ResumeButton, type AgentStep } from "@/components/agent-steps";
import { resumeCampaign, sendMessage } from "@/app/actions/campaign";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { AutoRefresh } from "@/components/auto-refresh";
import { EvidenceList } from "@/components/evidence-list";
import { VideoEvidence } from "@/components/video-evidence";
import { VideoThumb } from "@/components/video-thumb";
import { campaignTitle, getCampaign, getShortlist, type ShortlistRow } from "@/lib/data/queries";
import { fmtM } from "@/lib/campaign";
import { compact, dateTime, tiktokVideo } from "@/lib/format";
import { SCORE_LABELS, WEIGHTS, type ScoreKey } from "@/lib/scoring/rules";
import type { Capability } from "@/lib/plan";
import { ChatThread } from "@/components/chat-thread";
import { TolaMark } from "@/components/tola-mark";
import { AI_NAME } from "@/lib/brand";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCampaign(id);
  if (!c) notFound();
  const { summary, plan, finished: ran, writing, screened, videoDone, s3, s4, s5, error, stalled, rows } = await getShortlist(id);
  const halted = Boolean(error) || stalled;
  const scored = Boolean(summary);
  const pickN = c.koc_count ?? 5;
  const finished = ran && !error;
  const pickBy = new Map((s5?.picks ?? []).map((p, i) => [p.creator_id, { ...p, order: i }]));
  const picks = rows.filter((r) => pickBy.has(r.creator_id)).sort((a, b) => pickBy.get(a.creator_id)!.order - pickBy.get(b.creator_id)!.order);
  const reserve = rows.filter((r) => !pickBy.has(r.creator_id));
  // Không có bước đề xuất (thiếu ngân sách) → vẫn chỉ trả đúng số KOC người dùng yêu cầu;
  // shortlist rộng hơn (≥15) chỉ là nhóm dự phòng để thay người khi chat tiếp.
  const topRows = rows.slice(0, pickN);
  /**
   * Agent đã viết câu trả lời mở đầu (`chat.ts: writeOpeningAnswer`) → nó là câu trả lời chính, hiện
   * trong `ChatThread` bên dưới. Trang không lặp lại đoạn văn hard-code nữa; các thẻ KOC vẫn giữ
   * nhưng gập lại thành mục "chi tiết", vì bảng của agent đã nói đủ ý để quyết định.
   */
  const opened = (c.messages ?? []).some((m) => m.role === "assistant" && m.opening);
  const videoPlanned = plan.steps.some((s) => s.capability === "analyse_videos");

  const chips = [
    c.category_name,
    c.budget_total ? `Tổng ${fmtM(c.budget_total)}` : null,
    c.budget_max_per_koc ? `${c.budget_min_per_koc ? `${fmtM(c.budget_min_per_koc)} – ` : "≤ "}${fmtM(c.budget_max_per_koc)}/KOC` : null,
    c.koc_count ? `${c.koc_count} KOC` : null,
  ].filter(Boolean) as string[];

  // Trạng thái thật của từng năng lực: AI đặt tên bước (`title` trong kế hoạch), còn kết quả
  // và con số bên dưới đều do code lấy từ DB.
  const STAGE: Record<Capability, { done: boolean; doneLabel: string; detail?: string; doing: string; content?: React.ReactNode }> = {
    score_fit: {
      done: scored,
      doneLabel: summary ? `Đã lọc & chấm điểm ${summary.pool.toLocaleString("vi-VN")} KOC` : "Đã lọc & chấm điểm KOC",
      detail: summary ? `Quét ${summary.pool.toLocaleString("vi-VN")} KOC → ${summary.eligible} đạt tiêu chí → rút gọn ${summary.shortlisted} KOC` : undefined,
      doing: "Đang đối chiếu follower, khán giả, ngân sách, doanh thu…",
    },
    screen_content: {
      done: screened,
      doneLabel: s3 ? `Đã phân tích ${s3.kocs} KOC` : "Đã phân tích các KOC",
      detail: s3 ? `Đã đọc bio, video và sản phẩm của ${s3.kocs} KOC` : undefined,
      doing: "Đang đọc bio, tiêu đề video và sản phẩm đã bán…",
      content: screened ? <ScreenedList rows={rows} /> : undefined,
    },
    analyse_videos: {
      done: videoDone,
      doneLabel: s4 ? `Đã xem ${s4.videos} video của ${s4.kocs} KOC` : "Đã xem video của KOC dẫn đầu",
      detail: s4 ? `Đã xem ${s4.videos} video của ${s4.kocs} KOC để kiểm chứng demo sản phẩm` : undefined,
      doing: "Đang xem khung hình video — mất vài phút…",
      content: videoDone ? <WatchedVideos rows={rows} /> : undefined,
    },
    recommend: {
      done: Boolean(s5),
      doneLabel: s5 ? `Đã chọn ${s5.picks.length} KOC & chia ngân sách` : "Đã chọn KOC & chia ngân sách",
      detail: s5 ? `Chọn ${s5.picks.length} KOC · phân bổ ${fmtM(s5.allocated)}${s5.budget_total ? ` / ${fmtM(s5.budget_total)}` : ""} (ước tính) · lý do đều kèm bằng chứng` : undefined,
      doing: "Đang chọn KOC trong ngân sách và viết lý do kèm bằng chứng…",
    },
  };

  // Each step: done → its result line; first unfinished → running (or error); the rest pending.
  // `label` là nhãn khi đang chạy/chờ (do AI viết), `doneLabel` là kết quả khi xong.
  const raw: { id: string; label: string; doneLabel?: string; done: boolean; detail?: string; doing: string; content?: React.ReactNode }[] = [
    { id: "brief", label: "Hiểu yêu cầu chiến dịch", doneLabel: "Đã hiểu yêu cầu chiến dịch", done: true, detail: chips.join(" · "), doing: "" },
    ...plan.steps.map((s) => ({ id: s.capability, label: s.title, ...STAGE[s.capability] })),
  ];
  const current = raw.findIndex((s) => !s.done);
  const steps: AgentStep[] = raw.map((s, i) =>
    s.done
      ? { id: s.id, label: s.doneLabel ?? s.label, status: "done", detail: s.detail, content: s.content }
      : i === current
        ? error
          ? { id: s.id, label: s.label, status: "error", detail: "Có lỗi khi xử lý bước này. Tiến độ trước đó đã được lưu — bấm Tiếp tục để chạy lại từ đây." }
          : stalled
          ? { id: s.id, label: s.label, status: "error", detail: "Quá trình bị gián đoạn. Tiến độ đã được lưu — bấm Tiếp tục để chạy tiếp từ bước này." }
          : { id: s.id, label: s.label, status: "running", detail: s.doing }
        : // bước chưa tới: bỏ "Đang " để đọc như việc sắp làm ("Xem video của KOC dẫn đầu")
          { id: s.id, label: s.label.replace(/^Đang /, ""), status: "pending" },
  );

  const thought = `Tìm ${pickN} KOC ${String(c.category_name ?? "").toLowerCase()}${c.budget_total ? `, tổng ngân sách ${fmtM(c.budget_total)}` : ""} — lọc theo dữ liệu thật, đọc nội dung và xem video để kiểm chứng.`;

  return (
    <main className="flex min-h-screen flex-col">
      {!finished && !halted && <AutoRefresh seconds={4} />}
      <header className="sticky top-0 z-10 bg-page/90 px-4 py-3 backdrop-blur sm:px-6 lg:px-8 lg:py-4">
        <h1 className="truncate text-[15px] font-semibold">{campaignTitle(c)}</h1>
        <div className="text-[12px] text-ink-muted">
          <Link href="/campaigns" className="hover:text-brand">
            Chiến dịch
          </Link>{" "}
          · {dateTime(c.created_at)}
        </div>
      </header>

      {/* ── Conversation ── */}
      <div className="mx-auto w-full max-w-[980px] flex-1 space-y-5 px-4 pb-10 pt-4 sm:px-6">
        {/* user turn */}
        <div className="flex justify-end">
          <div className="max-w-[75%] rounded-2xl bg-zinc-100 px-4 py-3 text-[14.5px] leading-relaxed">{c.prompt?.replaceAll("**", "") ?? chips.join(" · ")}</div>
        </div>

        {/* AI turn */}
        <div className="space-y-4">
          {/* Cùng một dấu nhận diện với nút trợ lý ở thanh tab dưới */}
          <div className="flex items-center gap-2 text-[16px] font-bold">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-b from-[#454cab] to-[#1b1d4d] text-white">
              <TolaMark size={17} />
            </span>
            {AI_NAME}
          </div>
          {/* Kế hoạch AI tự lập từ yêu cầu — các thẻ bên dưới chạy đúng danh sách này */}
          <div className="text-[14.5px] leading-relaxed">
            <p>Tôi sẽ thực hiện theo kế hoạch sau:</p>
            <ol className="mt-2 space-y-1.5">
              {plan.steps.map((s, i) => (
                <li key={s.capability} className="font-semibold">
                  {i + 1}. {s.title}
                </li>
              ))}
            </ol>
          </div>
          <AgentSteps key={String(finished)} steps={steps} done={finished} thought={thought} />
          {halted && (
            <form action={resumeCampaign}>
              <input type="hidden" name="id" value={id} />
              <ResumeButton />
            </form>
          )}

          {/* Kế hoạch chỉ xếp hạng (không có bước đề xuất) → trả lời bằng danh sách đã xếp.
              Có câu trả lời của agent rồi thì gập danh sách lại, không nói lại cùng một ý hai lần. */}
          {(finished || writing) && summary && !s5 && (
            <>
              {!opened && (
                <p className="text-[14.5px] leading-relaxed">
                  Từ <b className="num">{summary.pool.toLocaleString("vi-VN")}</b> KOC, có <b className="num">{summary.eligible}</b> KOC đạt tiêu chí. Dưới đây là{" "}
                  <b className="text-brand">{topRows.length} KOC</b> dẫn đầu, xếp theo {plan.rank_by === "revenue" ? "doanh thu giảm dần" : "độ phù hợp"}. Muốn mình chọn ra
                  nhóm tốt nhất và chia ngân sách thì cho biết sản phẩm và ngân sách chiến dịch.
                </p>
              )}
              {opened ? (
                <details className="rounded-2xl border border-line bg-white px-4 py-3">
                  <summary className="cursor-pointer text-[13.5px] font-semibold">Chi tiết điểm & bằng chứng từng KOC ({topRows.length})</summary>
                  <div className="space-y-4 pt-3">
                    {topRows.map((r, i) => (
                      <KocCard key={r.creator_id} r={r} rank={i + 1} videoPlanned={videoPlanned} />
                    ))}
                  </div>
                </details>
              ) : (
                <div className="space-y-4">
                  {topRows.map((r, i) => (
                    <KocCard key={r.creator_id} r={r} rank={i + 1} videoPlanned={videoPlanned} />
                  ))}
                  {rows.length > topRows.length && (
                    <p className="text-[13px] text-ink-muted">
                      Còn <b className="text-ink">{rows.length - topRows.length}</b> KOC dự phòng đã qua vòng chấm điểm — nhắn cho mình nếu bạn muốn xem thêm hoặc thay ai đó
                      trong danh sách trên.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {(finished || writing) && summary && s5 && (
            <>
              {!opened && (
                <p className="text-[14.5px] leading-relaxed">
                  Từ <b className="num">{summary.pool.toLocaleString("vi-VN")}</b> KOC, có <b className="num">{summary.eligible}</b> KOC đạt tiêu chí. Mình đề xuất{" "}
                  <b className="text-brand">{picks.length} KOC</b> dưới đây, tổng chi phí ước tính <b className="num">{fmtM(s5!.allocated)}</b>
                  {s5!.budget_total ? <> trong ngân sách {fmtM(s5!.budget_total)}</> : null}. Mỗi lý do đều dẫn bằng chứng từ dữ liệu thật.
                </p>
              )}
              {picks.length > 0 && (
                <div className="overflow-x-auto rounded-2xl border border-line bg-white">
                  <table className="w-full min-w-[460px] text-[13.5px]">
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
              {/* Chỉ hiện đúng số KOC được đề xuất; nhóm dự phòng chỉ nhắc một dòng để đỡ loãng.
                  Có câu trả lời của agent rồi thì gập lại — bảng ngân sách ở trên vẫn là con số chốt. */}
              {rows.length && opened ? (
                <details className="rounded-2xl border border-line bg-white px-4 py-3">
                  <summary className="cursor-pointer text-[13.5px] font-semibold">Chi tiết điểm & bằng chứng từng KOC ({picks.length})</summary>
                  <div className="space-y-4 pt-3">
                    {picks.map((r, i) => (
                      <KocCard key={r.creator_id} r={r} rank={i + 1} pick={pickBy.get(r.creator_id)} videoPlanned={videoPlanned} />
                    ))}
                  </div>
                </details>
              ) : rows.length ? (
                <div className="space-y-4">
                  {picks.map((r, i) => (
                    <KocCard key={r.creator_id} r={r} rank={i + 1} pick={pickBy.get(r.creator_id)} videoPlanned={videoPlanned} />
                  ))}
                  {reserve.length > 0 && (
                    <p className="text-[13px] text-ink-muted">
                      Còn <b className="text-ink">{reserve.length}</b> KOC dự phòng đã qua vòng chấm điểm — nhắn cho mình nếu bạn muốn thay ai đó trong danh sách trên.
                    </p>
                  )}
                </div>
              ) : (
                <p className="rounded-2xl border border-line bg-white p-6 text-center text-ink-muted">
                  Chưa tìm thấy KOC phù hợp. Thử nới tiêu chí (follower, ngân sách, MCN) và tạo chiến dịch mới.
                </p>
              )}
            </>
          )}
        </div>

        {/* Agent đang viết nhận định — đặt NGAY TRÊN chỗ câu trả lời sắp hiện (cuối trang, trước
            khung chat), không phải trên đầu kết quả: nó là bước cuối cùng, không phải bước đầu. */}
        {writing && (
          <div className="flex items-start gap-3 rounded-2xl border border-line bg-white px-4 py-3">
            <Loader2 size={17} className="mt-0.5 shrink-0 animate-spin text-brand" />
            <div>
              <p className="text-[14px] font-medium">Đang đọc lại toàn bộ số liệu để viết nhận định…</p>
              <p className="text-[12.5px] text-ink-muted">Khoảng 1 phút. Trang tự cập nhật khi xong, bạn không cần tải lại.</p>
            </div>
          </div>
        )}

        {/* ── Các lượt trao đổi tiếp theo (client: tin nhắn hiện ngay khi gửi) ── */}
        <ChatThread
          campaignId={id}
          messages={c.messages}
          action={sendMessage}
          quick={["Tăng ngân sách lên 80 triệu", "Bỏ KOC đầu tiên, gợi ý người khác", "Vì sao chọn những KOC này?"]}
        />
      </div>

    </main>
  );
}

/**
 * Danh sách kết quả trong thẻ bước: cao tối đa ~1 màn hình rồi cuộn bên trong. 15 KOC hay 20 video
 * đổ thẳng ra trang thì đẩy phần kết luận xuống quá xa, người bán phải lăn chuột mãi mới thấy.
 */
const SCROLL = "max-h-[340px] overflow-y-auto pr-1";

/**
 * Bước "đọc nội dung" (S3) — hiện ĐÚNG những KOC đã đọc kèm nhận xét, thay vì một dòng "Đã đọc bio,
 * video và sản phẩm của 15 KOC". Người bán cần nhìn thấy việc đã làm thì mới tin con số phía sau.
 */
function ScreenedList({ rows }: { rows: ShortlistRow[] }) {
  const seen = rows.filter((r) => r.ai);
  if (!seen.length) return null;
  return (
    <ul className={`divide-y divide-line border-t border-line ${SCROLL}`}>
      {seen.map((r) => (
        <li key={r.creator_id} className="flex items-start gap-2.5 py-2">
          <Avatar id={r.creator_id} name={r.nickname || r.handle} size={26} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 text-[13px]">
              <a href={`/kocs/${r.creator_id}`} className="font-medium hover:text-brand">
                {r.nickname || r.handle}
              </a>
              <span className="text-[11.5px] text-ink-muted">độ sâu review {r.ai!.review_depth}/100</span>
              {r.ai!.niches.slice(0, 3).map((n) => (
                <span key={n} className="rounded bg-zinc-100 px-1.5 py-px text-[11px] text-zinc-600">
                  {n}
                </span>
              ))}
            </p>
            <p className="text-[12.5px] text-zinc-600">{clip(r.ai!.summary, 150)}</p>
            {r.ai!.risks.length > 0 && <p className="text-[11.5px] text-amber-700">Lưu ý: {clip(r.ai!.risks.join("; "), 110)}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Tóm tắt một ý của AI về nội dung KOC: cắt ngắn để danh sách 15 người còn đọc lướt được. */
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * Bước "xem video" (S4) — **danh sách video đã lấy**, mỗi dòng một thumbnail nhỏ + tiêu đề một dòng,
 * bấm vào phát ngay. Cố ý KHÔNG đổ 4 khung hình + nhận xét của từng video ra đây: chỗ này chỉ để
 * người bán thấy đã đụng tới những video nào; phần phân tích khung hình nằm trong thẻ từng KOC.
 */
function WatchedVideos({ rows }: { rows: ShortlistRow[] }) {
  const items = rows.flatMap((r) => r.videos.map((v) => ({ ...v, koc: r.nickname || r.handle, handle: r.handle })));
  if (!items.length) return null;
  return (
    <div className="space-y-2 border-t border-line pt-2.5">
      <div className={`space-y-1.5 ${SCROLL}`}>
        {items.map((v) => (
          <div key={v.video_id} className="flex items-center gap-2.5 rounded-lg bg-zinc-50/80 p-1.5">
            <VideoThumb id={v.video_id} title={v.title} tiktokUrl={tiktokVideo(v.handle, v.video_id)} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px]">{v.title}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-muted">
                <span className="truncate">{v.koc}</span>
                <span className={`shrink-0 rounded px-1.5 py-px ${v.product_demo === "có" ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>
                  demo {v.product_demo}
                </span>
              </p>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-ink-muted">{items.length} video · bấm để xem; nhận xét từng khung hình nằm ở thẻ chi tiết của mỗi KOC.</p>
    </div>
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

function KocCard({ r, rank, pick, videoPlanned = true }: { r: ShortlistRow; rank: number; pick?: S5Pick; videoPlanned?: boolean }) {
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
      {/* 7 điểm thành phần: 2 cột trên điện thoại, 4 trên tablet, đủ 7 một hàng trên màn rộng */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 border-y border-line py-3 sm:grid-cols-4 xl:grid-cols-7">
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
            // "Chưa phân tích" chỉ đúng khi kế hoạch CÓ bước xem video; không có bước đó mà vẫn
            // ghi vậy thì đọc như một lỗi (người bán đã hiểu nhầm đúng kiểu này).
            <p className="text-[12px] text-ink-muted">{videoPlanned ? "Chưa phân tích video." : "Kế hoạch này không có bước xem video."}</p>
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
