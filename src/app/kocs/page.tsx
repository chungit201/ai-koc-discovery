import { LayoutGrid, Search, TableProperties, Venus } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { Sparkline } from "@/components/charts/sparkline";
import { FilterSelect } from "@/components/filter-select";
import { FilterDrawer } from "@/components/filter-drawer";
import { TolaOrb } from "@/components/tola-mark";
import { TolaAskBar } from "@/components/tola-ask-bar";
import { AI_NAME } from "@/lib/brand";
import { KocActions } from "@/components/koc-actions";
import { ScrollShadows } from "@/components/scroll-shadows";
import { Delta, Pill, ShareBar } from "@/components/kit";
import { CATEGORY_NAMES, PAGE_SIZE, searchKocs, type KocFilters, type KocRow } from "@/lib/data/queries";
import { compact, pct, vnd } from "@/lib/format";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

const FILTERS: { name: string; label: string; options: { value: string; label: string }[] }[] = [
  {
    name: "age",
    label: "Mọi độ tuổi",
    options: [
      { value: "", label: "" },
      { value: "18-24", label: "Tuổi 18 – 24" },
      { value: "25-34", label: "Tuổi 25 – 34" },
    ],
  },
  {
    name: "followers",
    label: "Mọi quy mô",
    options: [
      { value: "", label: "" },
      { value: "0-50000", label: "Nano < 50k" },
      { value: "50000-200000", label: "Micro 50–200k" },
      { value: "200000-500000", label: "Mid 200–500k" },
      { value: "500000-1000000", label: "Macro 500k–1tr" },
      { value: "1000000-", label: "Mega > 1tr" },
    ],
  },
  {
    name: "mcn",
    label: "Mọi trạng thái MCN",
    options: [
      { value: "", label: "" },
      { value: "no", label: "Chưa ký MCN" },
      { value: "yes", label: "Đã ký MCN" },
    ],
  },
];

/**
 * Pinned columns stay visible while the wide table scrolls horizontally. Their shadow only shows
 * while something is hidden behind them (ScrollShadows sets data-left / data-right).
 */
const STICKY = [
  "sticky right-0 z-10",
  // gradient strip on the left edge = "more to scroll this way"
  "before:pointer-events-none before:absolute before:inset-y-0 before:-left-4 before:w-4 before:bg-gradient-to-l before:from-black/[0.08] before:to-transparent",
  "before:opacity-0 before:transition-opacity group-data-[right=true]/scroll:before:opacity-100",
].join(" ");
const PIN_RANK = "sticky left-0 z-10 w-14 min-w-14";
const PIN_CREATOR = [
  "sticky left-14 z-10",
  "after:pointer-events-none after:absolute after:inset-y-0 after:-right-4 after:w-4 after:bg-gradient-to-r after:from-black/[0.08] after:to-transparent",
  "after:opacity-0 after:transition-opacity group-data-[left=true]/scroll:after:opacity-100",
].join(" ");

/**
 * Hai kiểu xem. "Bảng" = bảng đầy đủ trên desktop, và danh sách dòng gọn trên mobile (cùng dữ liệu,
 * bảng 13 cột không đọc nổi ở khổ hẹp). "Thẻ" = lưới thẻ ở mọi khổ.
 */
const VIEWS = [
  { v: "table", label: "Bảng", Icon: TableProperties },
  { v: "card", label: "Thẻ", Icon: LayoutGrid },
] as const;

const SORTS = [
  { value: "revenue", label: "Doanh thu" },
  { value: "engagement", label: "Tương tác" },
  { value: "views", label: "Lượt xem" },
  { value: "followers", label: "Follower" },
];

export default async function KocsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [minF, maxF] = (one(sp.followers) ?? "").split("-");
  const filters: KocFilters = {
    run: one(sp.run),
    q: one(sp.q),
    age: one(sp.age),
    minFollowers: minF ? Number(minF) : undefined,
    maxFollowers: maxF ? Number(maxF) : undefined,
    mcn: one(sp.mcn) as KocFilters["mcn"],
    deep: one(sp.deep) as KocFilters["deep"],
    sort: (one(sp.sort) as KocFilters["sort"]) ?? "revenue",

    page: Number(one(sp.page) ?? 1),
  };
  const view: "table" | "card" = one(sp.view) === "card" ? "card" : "table";
  const { rows, total, scope } = await searchKocs(filters);
  const maxRevenue = Math.max(1, ...rows.map((r) => r.revenue ?? 0));
  const page = filters.page ?? 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v !== undefined && v !== "") p.set(k, String(Array.isArray(v) ? v[0] : v));
    return `?${p}`;
  };
  const sortLabel = SORTS.find((s) => s.value === filters.sort)?.label.toLowerCase() ?? "doanh thu";

  return (
    // lg:pb-28: chừa chỗ cho ô hỏi Tola nổi ở đáy (chỉ desktop)
    <main className="mx-auto w-full max-w-[1760px] space-y-5 px-4 py-5 sm:space-y-6 sm:px-6 sm:py-6 lg:px-8 lg:pb-28 lg:pt-8 xl:px-10">
      {/* ── Header: title left, primary CTA top-right ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Nhà sáng tạo</h1>
          <p className="mt-1 text-[14px] text-ink-muted">
            {scope ? `${CATEGORY_NAMES[scope.category_id] ?? scope.category_id} · dữ liệu 30 ngày gần nhất` : "Chưa có dữ liệu"}
          </p>
        </div>
        {/* Dưới lg đã có nút trợ lý nổi giữa thanh tab — không hiện trùng */}
        <Link
          href="/tola"
          className="hidden h-10 items-center gap-2 rounded-xl bg-gradient-to-b from-[#454cab] to-[#1b1d4d] px-4 text-[13px] font-semibold text-white shadow-[var(--shadow-pop)] transition hover:brightness-110 lg:flex"
        >
          <TolaOrb size={24} /> Hỏi {AI_NAME}
        </Link>
      </div>

      {/* ── Toolbar ──
          Mobile: ô tìm kiếm chiếm hết hàng, nút Bộ lọc (gồm cả sắp xếp) và nút chuyển kiểu xem
          đứng cạnh dưới dạng icon. Desktop: các select lọc + hàng nút sắp xếp hiện thẳng ra. */}
      <div className="space-y-2.5 lg:flex lg:flex-wrap lg:items-center lg:justify-between lg:gap-3 lg:space-y-0">
        <div className="flex items-center gap-2 lg:flex-wrap lg:gap-2.5">
          <form method="get" className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-white px-3 focus-within:border-brand lg:w-64 lg:flex-none">
            {Object.entries(sp)
              .filter(([k]) => k !== "q" && k !== "page")
              .map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={one(v)} />
              ))}
            <Search size={16} className="text-ink-muted" />
            <input name="q" defaultValue={filters.q} placeholder="Tìm nhà sáng tạo…" className="h-full flex-1 bg-transparent text-[13px] outline-none" />
          </form>

          <FilterDrawer className="lg:hidden" groups={FILTERS} sorts={{ name: "sort", label: "Doanh thu", options: SORTS }} />

          <div className="hidden lg:contents">
            {FILTERS.map((f) => (
              <FilterSelect key={f.name} name={f.name} label={f.label} options={f.options} />
            ))}
          </div>

          {/* Nút chuyển kiểu xem: mobile chỉ icon cho vừa hàng, desktop kèm chữ */}
          <div className="flex shrink-0 items-center rounded-xl bg-zinc-100 p-1 lg:hidden" role="group" aria-label="Kiểu hiển thị">
            {VIEWS.map(({ v, label, Icon }) => (
              <Link
                key={v}
                href={qs({ view: v === "table" ? undefined : v })}
                aria-pressed={view === v}
                title={`Xem dạng ${label.toLowerCase()}`}
                className={`grid h-8 w-9 place-items-center rounded-lg ${view === v ? "bg-white shadow-sm" : "text-zinc-500"}`}
              >
                <Icon size={16} />
              </Link>
            ))}
          </div>
        </div>

        <div className="hidden flex-wrap items-center gap-2.5 lg:flex">
          <div className="flex items-center rounded-xl bg-zinc-100 p-1">
            {SORTS.map((s) => (
              <Link
                key={s.value}
                href={qs({ sort: s.value, page: undefined })}
                className={`rounded-lg px-3 py-1.5 text-[13px] ${filters.sort === s.value ? "bg-white font-semibold shadow-sm" : "text-zinc-600 hover:text-ink"}`}
              >
                {s.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center rounded-xl bg-zinc-100 p-1" role="group" aria-label="Kiểu hiển thị">
            {VIEWS.map(({ v, label, Icon }) => (
              <Link
                key={v}
                href={qs({ view: v === "table" ? undefined : v })}
                aria-pressed={view === v}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] ${view === v ? "bg-white font-semibold shadow-sm" : "text-zinc-600 hover:text-ink"}`}
              >
                <Icon size={15} /> {label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* ── Leaderboard ── */}
      <section className="card overflow-hidden">
        {/* Màn hẹp: tiêu đề và dòng chú thích xuống dòng thay vì chen nhau mỗi bên một nửa */}
        <div className="flex flex-col gap-0.5 px-4 pb-3 pt-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <h2 className="text-[17px] font-semibold">Bảng xếp hạng nhà sáng tạo</h2>
          <span className="text-[13px] text-ink-muted">
            {total.toLocaleString("vi-VN")} KOC · xếp theo {sortLabel}
          </span>
        </div>
        {/**
         * Hai cách xem, cùng một dữ liệu:
         *  - "Bảng" = DANH SÁCH DÒNG (không còn bảng 13 cột rộng 1360px). Bảng cũ buộc cuộn ngang,
         *    trên điện thoại chỉ thấy hạng và tên còn mọi số liệu nằm ngoài màn hình.
         *  - "Thẻ" = lưới thẻ đầy đủ, có biểu đồ xu hướng và nút thao tác.
         */}
        {view === "card" ? (
          <div className="grid grid-cols-1 gap-4 px-4 pb-6 sm:grid-cols-2 sm:px-6 xl:grid-cols-3 2xl:grid-cols-4">
            {rows.map((r, i) => (
              <KocCard key={r.id} r={r} rank={(page - 1) * PAGE_SIZE + i + 1} />
            ))}
            {!rows.length && <p className="col-span-full py-16 text-center text-ink-muted">Không có nhà sáng tạo phù hợp bộ lọc.</p>}
          </div>
        ) : (
          <>
            {/* Mobile: danh sách dòng gọn. Bảng đầy đủ chỉ hiện từ lg — ở khổ hẹp nó buộc cuộn
                ngang và toàn bộ cột số liệu nằm ngoài màn hình. */}
            <div className="divide-y divide-line lg:hidden">
              {rows.map((r, i) => (
                <KocRow key={r.id} r={r} rank={(page - 1) * PAGE_SIZE + i + 1} />
              ))}
              {!rows.length && <p className="py-16 text-center text-ink-muted">Không có nhà sáng tạo phù hợp bộ lọc.</p>}
            </div>
            <ScrollShadows className="hidden lg:block">
          {/* Wide table scrolls inside the card; header labels never wrap */}
          <table className="w-full min-w-[1360px]">
            <thead className="whitespace-nowrap text-left text-[12px] text-ink-muted">
              <tr className="border-b border-line">
                <th className={`${PIN_RANK} bg-white py-3 pl-6 pr-2 font-medium`}>#</th>
                <th className={`${PIN_CREATOR} min-w-[260px] bg-white px-3 py-3 font-medium`}>Nhà sáng tạo</th>
                <th className="w-40 px-3 py-3 text-right font-medium">Doanh thu mỹ phẩm</th>
                <th className="px-3 py-3 text-right font-medium">Đơn bán</th>
                <th className="px-3 py-3 text-right font-medium">Follower</th>
                <th className="px-3 py-3 text-right font-medium">Follower mới</th>
                <th className="px-3 py-3 font-medium">Xu hướng doanh thu</th>
                <th className="px-3 py-3 text-right font-medium">Lượt xem</th>
                <th className="px-3 py-3 font-medium">Xu hướng lượt xem</th>
                <th className="px-3 py-3 text-right font-medium">Giá TB/đơn</th>
                <th className="px-3 py-3 text-right font-medium">Tương tác</th>
                <th className="px-3 py-3 font-medium">Khán giả</th>
                <th className={`${STICKY} bg-white py-3 pl-3 pr-6 text-center font-medium`}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const rank = (page - 1) * PAGE_SIZE + i + 1;
                // solid backgrounds so pinned cells hide what scrolls beneath them
                const bg = `${rank <= 3 ? "bg-[#fbfbfa]" : "bg-white"} group-hover:bg-[#f4f9f6]`;
                return (
                  <tr key={r.id} className={`group border-b border-line/70 transition last:border-0 hover:bg-[#f4f9f6] ${rank <= 3 ? "bg-[#fbfbfa]" : "bg-white"}`}>
                    <td className={`${PIN_RANK} ${bg} num py-3.5 pl-6 pr-2 text-[14px] font-semibold ${rank <= 3 ? "text-brand" : "text-ink-muted"}`}>{rank}</td>
                    <td className={`${PIN_CREATOR} ${bg} px-3 py-3.5`}>
                      <Link href={`/kocs/${r.id}`} className="flex items-center gap-3">
                        <Avatar id={r.id} name={r.handle} size={36} />
                        <span className="min-w-0">
                          <span className="block text-[14px] font-medium text-ink group-hover:text-brand">{r.nickname || r.handle}</span>
                          <span className="block max-w-56 truncate text-[12px] text-ink-muted">
                            {r.handle}
                                                      </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3.5 text-right">
                      <div className="num text-[14px] font-semibold">{vnd(r.revenue)}</div>
                      <ShareBar ratio={(r.revenue ?? 0) / maxRevenue} />
                    </td>
                    <td className="num px-3 py-3.5 text-right">{compact(r.sales)}</td>
                    <td className="num px-3 py-3.5 text-right">{compact(r.followers)}</td>
                    <td className="px-3 py-3.5 text-right">
                      <Delta value={r.new_followers} text={compact(Math.abs(r.new_followers ?? 0))} />
                    </td>
                    <td className="px-3 py-3.5">
                      <Sparkline values={r.revenue_trend} unit="vnd" label="Doanh thu" />
                    </td>
                    <td className="num px-3 py-3.5 text-right">{compact(r.views)}</td>
                    <td className="px-3 py-3.5">
                      <Sparkline values={r.views_trend} label="Lượt xem" />
                    </td>
                    <td className="num px-3 py-3.5 text-right">{vnd(r.unit_price)}</td>
                    <td className="num px-3 py-3.5 text-right">{pct(r.engagement)}</td>
                    <td className="px-3 py-3.5">
                      <Pill tone="pink" icon={Venus}>
                        Nữ · {r.age_majority ?? r.age_buckets.join(", ")}
                      </Pill>
                    </td>
                    {/* Solid backgrounds: a sticky cell must hide what scrolls beneath it */}
                    <td className={`${STICKY} ${bg} py-3.5 pl-3 pr-6`}>
                      <KocActions id={r.id} handle={r.handle} favorite={r.favorite} />
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={13} className="px-3 py-20 text-center text-ink-muted">
                    Không có nhà sáng tạo phù hợp bộ lọc.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollShadows>
          </>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-4 text-[13px] sm:px-6">
          <span className="text-ink-muted">Khán giả = nhóm người theo dõi chiếm đa số</span>
          <div className="flex items-center gap-1.5">
            <PageLink href={qs({ page: page - 1 })} disabled={page <= 1}>
              ‹ Trước
            </PageLink>
            <span className="num rounded-lg bg-brand px-3 py-1.5 font-semibold text-white">{page}</span>
            <span className="num px-1 text-ink-muted">/ {pages.toLocaleString("vi-VN")}</span>
            <PageLink href={qs({ page: page + 1 })} disabled={page >= pages}>
              Sau ›
            </PageLink>
          </div>
        </div>
      </section>

      <TolaAskBar placeholder="Hỏi Tola: KOC nào bán kem chống nắng tốt nhất, ai đang tăng trưởng mạnh…" />
    </main>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: React.ReactNode }) {
  if (disabled) return <span className="rounded-lg border border-line px-3 py-1.5 text-zinc-300">{children}</span>;
  return (
    <Link href={href} className="rounded-lg border border-line bg-white px-3 py-1.5 font-medium hover:border-brand hover:text-brand">
      {children}
    </Link>
  );
}

/**
 * Một dòng trong danh sách KOC trên **mobile** (chế độ Bảng). Gọn hơn hẳn `KocCard`: ảnh tròn,
 * @handle là dòng chính, tên hiển thị là dòng phụ, rồi đúng hai số liệu quan trọng nhất theo cột.
 * Bỏ biểu đồ xu hướng và nút thao tác — trên màn hẹp chúng chiếm chỗ mà hiếm khi được dùng;
 * cả hai vẫn có đủ ở trang chi tiết (bấm vào dòng là tới).
 */
function KocRow({ r, rank }: { r: KocRow; rank: number }) {
  const top = rank <= 3;
  return (
    <Link href={`/kocs/${r.id}`} className="flex gap-3 px-4 py-3.5 transition active:bg-zinc-50">
      <span
        className={`num mt-1 grid h-5 min-w-5 shrink-0 place-items-center rounded-md px-1 text-[11px] font-bold ${
          top ? "bg-brand-soft text-brand-strong" : "bg-zinc-100 text-zinc-600"
        }`}
      >
        {rank}
      </span>
      <Avatar id={r.id} name={r.handle} size={52} round />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold">{r.handle}</div>
        <div className="truncate text-[12.5px] text-ink-muted">{r.nickname || r.handle}</div>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <div className="min-w-0">
            <div className="num truncate text-[15px] font-bold text-brand">{vnd(r.revenue)}</div>
            <div className="text-[11.5px] text-ink-muted">Doanh thu</div>
          </div>
          <div className="min-w-0">
            <div className="num truncate text-[15px] font-bold">{compact(r.followers)}</div>
            <div className="text-[11.5px] text-ink-muted">Người theo dõi</div>
          </div>
        </div>
      </div>
    </Link>
  );
}

function KocCard({ r, rank }: { r: KocRow; rank: number }) {
  const top = rank <= 3;
  return (
    <article className={`flex flex-col rounded-2xl border bg-white p-4 transition hover:shadow-md ${top ? "border-brand/30" : "border-line"}`}>
      <div className="flex items-start gap-3">
        <div className="relative">
          <Avatar id={r.id} name={r.handle} size={56} />
          <span
            className={`num absolute -left-1.5 -top-1.5 grid h-6 min-w-6 place-items-center rounded-full px-1 text-[11px] font-bold text-white ring-2 ring-white ${top ? "bg-brand" : "bg-zinc-800"}`}
          >
            {rank}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <Link href={`/kocs/${r.id}`} className="block truncate text-[15px] font-semibold hover:text-brand">
            {r.nickname || r.handle}
          </Link>
          <div className="truncate text-[12px] text-ink-muted">{r.handle}</div>
          <div className="mt-1.5">
            <Pill tone="pink" icon={Venus}>
              Nữ · {r.age_majority ?? r.age_buckets.join(", ")}
            </Pill>
          </div>
        </div>
        <KocActions id={r.id} handle={r.handle} favorite={r.favorite} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Metric label="Doanh thu" value={vnd(r.revenue)} strong />
        <Metric label="Đơn bán" value={compact(r.sales)} />
        <Metric label="Follower" value={compact(r.followers)} />
        <Metric label="Tương tác" value={pct(r.engagement)} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-zinc-50 px-3 py-2">
        <div>
          <div className="text-[11px] text-ink-muted">Xu hướng doanh thu 30 ngày</div>
          <div className="mt-0.5 text-[12px]">
            <Delta value={r.new_followers} text={`${compact(Math.abs(r.new_followers ?? 0))} follower`} />
          </div>
        </div>
        <Sparkline values={r.revenue_trend} unit="vnd" label="Doanh thu" width={110} />
      </div>

      <div className="mt-3 flex items-center justify-between text-[12px] text-ink-muted">
        <span>
          Giá TB/đơn <b className="num text-zinc-700">{vnd(r.unit_price)}</b>
        </span>
        <Link href={`/kocs/${r.id}`} className="font-medium text-brand hover:underline">
          Xem chi tiết →
        </Link>
      </div>
    </article>
  );
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-line px-3 py-2">
      <div className="text-[11px] text-ink-muted">{label}</div>
      <div className={`num mt-0.5 ${strong ? "text-[16px] font-bold" : "text-[14px] font-semibold"}`}>{value}</div>
    </div>
  );
}
