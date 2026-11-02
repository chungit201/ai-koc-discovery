import { ChevronRight, Loader2, CheckCircle2, PauseCircle } from "lucide-react";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { DeepSearchButton } from "@/components/deep-search-button";
import { Pill } from "@/components/kit";
import { campaignTitle, listCampaigns, promptPreview } from "@/lib/data/queries";
import { fmtM } from "@/lib/campaign";
import { dateTime } from "@/lib/format";

const PROGRESS = {
  done: { text: "Đã có đề xuất", tone: "green", icon: CheckCircle2 },
  running: { text: "Đang xử lý", tone: "blue", icon: Loader2 },
  halted: { text: "Tạm dừng", tone: "amber", icon: PauseCircle },
} as const;

export default async function CampaignsPage() {
  const campaigns = await listCampaigns();
  return (
    <main className="mx-auto w-full max-w-[1440px] space-y-6 px-8 py-8 xl:px-10">
      {/* có chiến dịch đang chạy → tự làm mới để nhãn tiến độ không bị đứng */}
      {campaigns.some((c) => c.progress === "running") && <AutoRefresh seconds={6} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Chiến dịch</h1>
          <p className="mt-1 text-[14px] text-ink-muted">Mỗi chiến dịch: danh mục, ngân sách và số KOC — hệ thống đề xuất KOC kèm bằng chứng</p>
        </div>
        <DeepSearchButton variant="header" />
      </div>

      <section className="card divide-y divide-line">
        {campaigns.map((c) => (
          <Link key={c.id} href={`/campaigns/${c.id}`} className="flex items-center gap-4 px-6 py-4 transition hover:bg-brand-soft/40">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-semibold">{campaignTitle(c)}</span>
                <Pill tone={PROGRESS[c.progress].tone} icon={PROGRESS[c.progress].icon}>
                  {PROGRESS[c.progress].text}
                </Pill>
              </div>
              {promptPreview(c) && <div className="mt-1 text-[13px] text-zinc-700">“{promptPreview(c)}”</div>}
              <div className="num mt-1 text-[13px] text-ink-muted">
                {c.mode === "prompt"
                  ? `Nhập bằng mô tả · ${dateTime(c.created_at)}`
                  : `${c.koc_count} KOC · tổng ${fmtM(c.budget_total)} · ${fmtM(c.budget_min_per_koc)} – ${fmtM(c.budget_max_per_koc)}/KOC · ${dateTime(c.created_at)}`}
              </div>
            </div>
            <ChevronRight size={18} className="text-ink-muted" />
          </Link>
        ))}
        {!campaigns.length && <p className="px-6 py-14 text-center text-ink-muted">Chưa có chiến dịch nào. Bấm “Chiến dịch mới” để bắt đầu.</p>}
      </section>
    </main>
  );
}
