import {
  BadgeCheck,
  BarChart3,
  Building2,
  CalendarCheck,
  Clapperboard,
  Coins,
  Eye,
  ExternalLink,
  HeartHandshake,
  Mail,
  Package,
  Radio,
  ShoppingBag,
  Sparkles,
  Store,
  Tag,
  Users,
  Venus,
  Video,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Avatar } from "@/components/avatar";
import { LineChart } from "@/components/charts/line-chart";
import { VideoThumb } from "@/components/video-thumb";
import { ProductThumb } from "@/components/product-thumb";
import { KpiCard, Pill, SectionCard } from "@/components/kit";
import { CATEGORY_NAMES, getKoc, type VideoProductInfo } from "@/lib/data/queries";
import { ProductHover } from "@/components/product-hover";
import { compact, pct, tiktokProfile, tiktokVideo, vnd } from "@/lib/format";
import { contactItems, type ContactItem } from "@/lib/contact";
import { AskBar, type ChatThreadView } from "@/components/ask-bar";
import { PagedTable } from "@/components/paged-table";
import { ShopLogo } from "@/components/shop-logo";

/* eslint-disable @typescript-eslint/no-explicit-any -- Mongo docs are schemaless here */

export default async function KocDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getKoc(id);
  if (!data) notFound();
  const { creator: c, metrics, products, videos, shops, threads, videoProducts } = data as {
    creator: any;
    metrics: any[];
    products: any[];
    videos: any[];
    shops: any[];
    threads: ChatThreadView[];
    videoProducts: Record<string, VideoProductInfo>;
  };

  const pick = (scope: string, source: string) => metrics.find((m) => m.category_scope === scope && m.source === source);
  const all = pick("all", "web:creator/detail/total");
  const cosmetics = pick("848776,848648", "web:creator/queryList") ?? metrics.find((m) => m.source === "web:creator/queryList");

  // Exact per-day values from history/total — computed by code, never by AI
  const daily: { day: string; revenue: number | null }[] = all?.daily ?? [];
  const dailyRev = daily.map((d) => d.revenue ?? 0);
  const activeDays = dailyRev.filter((v) => v > 0).length;
  const sumRev = dailyRev.reduce((a, b) => a + b, 0);
  const topDayShare = sumRev ? Math.max(...dailyRev) / sumRev : null;
  const cosmeticsShare = all?.revenue && cosmetics?.revenue ? Math.min(1, cosmetics.revenue / all.revenue) : null;
  const share = (part?: number | null) => (all?.revenue ? pct((part ?? 0) / all.revenue, 0) : "–");
  const contacts = contactItems(c.contact);
  // Tỉ trọng mỗi shop trên tổng doanh thu các shop (code tính, cùng khoảng ngày)
  const shopTotal = shops.reduce((a, s) => a + (s.revenue ?? 0), 0);

  return (
    // pb-24: chừa chỗ cho thanh hỏi Tola nổi ở đáy, không thì che mất nội dung cuối trang
    <div className="mx-auto w-full max-w-[1440px] space-y-4 px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-24 lg:pt-6 xl:px-10">
      <div className="text-xs text-ink-muted">
        <Link href="/kocs" className="hover:text-brand">
          Nhà sáng tạo
        </Link>
        <span className="mx-1.5">/</span>
        <span className="font-medium text-ink">{c.handle}</span>
      </div>

      {/* ── Profile hero ── */}
      <section className="card overflow-hidden">
        <div className="grid grid-cols-1 gap-5 p-4 sm:p-6 lg:grid-cols-[1fr_300px]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Avatar id={id} name={c.handle} size={92} />
            <div className="min-w-0 pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[22px] font-semibold tracking-tight">{c.nickname}</h1>
                {c.status === "INDEPENDENT" ? <Pill tone="green" icon={BadgeCheck}>KOC độc lập</Pill> : <Pill tone="amber">{c.status ?? "–"}</Pill>}
                {c.mcn ? <Pill tone="blue" icon={Building2}>{c.mcn}</Pill> : <Pill>Chưa ký MCN</Pill>}
              </div>
              <a href={tiktokProfile(c.handle)} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-brand hover:underline">
                {c.handle} <ExternalLink size={12} />
              </a>
              <p className="mt-1.5 line-clamp-2 max-w-2xl whitespace-pre-line text-xs text-ink-muted">{c.bio || "Không có bio"}</p>
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-line">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
              <Mail size={13} className="text-brand" /> Liên hệ hợp tác
            </div>
            {contacts.length ? (
              contacts.map((it) => (
                <div key={it.key} className="flex justify-between gap-2 py-0.5 text-xs">
                  <span className="text-ink-muted">{it.label}</span>
                  <ContactValue it={it} />
                </div>
              ))
            ) : (
              <div className="text-xs text-ink-muted">Không có liên hệ công khai — nhắn qua TikTok.</div>
            )}
            <a
              href={tiktokProfile(c.handle)}
              target="_blank"
              rel="noreferrer"
              className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-brand py-2 text-xs font-semibold text-white shadow-[var(--shadow-pop)] hover:bg-brand-strong"
            >
              Mở kênh TikTok <ExternalLink size={12} />
            </a>
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-line sm:grid-cols-5">
          <HeroStat icon={Users} label="Người theo dõi" value={compact(c.followers)} />
          <HeroStat icon={Venus} label="Khán giả chiếm đa số" value={`${c.audience?.gender_majority === "female" ? "Nữ" : c.audience?.gender_majority ?? "–"} · ${c.audience?.age_majority ?? c.audience?.age_buckets_matched?.join(", ") ?? "–"}`} />
          <HeroStat icon={Package} label="Sản phẩm 30 ngày" value={compact(c.product_count ?? products.length)} />
          <HeroStat icon={Video} label="Video 30 ngày" value={compact(videos.length)} />
          <HeroStat icon={CalendarCheck} label="Bắt đầu bán hàng" value={c.debut_date ?? "–"} />
        </div>
      </section>

      <div>

        <div className="min-w-0 flex-1 space-y-4">
          {/* ── Core metrics + daily revenue ── */}
          <SectionCard id="core" title="Chỉ số cốt lõi" icon={BarChart3} note={`Tất cả ngành · ${all?.date_range?.replace("~", " → ") ?? "30 ngày"}`}>
            {all ? (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                  <KpiCard highlight icon={Coins} label="Doanh thu" value={vnd(all.revenue)} hint={`TB ${vnd(sumRev / (daily.length || 30))}/ngày`} />
                  <KpiCard icon={Radio} tone="pink" label="Doanh thu LIVE" value={vnd(all.live_revenue)} hint={`${share(all.live_revenue)} tổng`} />
                  <KpiCard icon={Video} tone="violet" label="Doanh thu video" value={vnd(all.video_revenue)} hint={`${share(all.video_revenue)} tổng`} />
                  <KpiCard icon={Sparkles} tone="green" label="Doanh thu mỹ phẩm" value={vnd(cosmetics?.revenue)} hint={cosmeticsShare !== null ? `${pct(cosmeticsShare, 0)} tổng doanh thu` : CATEGORY_NAMES[cosmetics?.category_scope] ?? ""} />
                  <KpiCard icon={Store} tone="slate" label="Doanh thu khác" value={vnd(all.shop_revenue)} hint="gian hàng / showcase" />
                  <KpiCard icon={Tag} tone="amber" label="Đơn giá bình quân" value={vnd(all.unit_price)} />
                  <KpiCard icon={ShoppingBag} tone="blue" label="Đơn bán ra" value={compact(all.sales_volume)} />
                  <KpiCard icon={Eye} tone="violet" label="Lượt xem video" value={compact(all.video_views)} />
                  <KpiCard icon={HeartHandshake} tone="pink" label="Tỷ lệ tương tác" value={pct(cosmetics?.video_engagement_rate)} />
                  <KpiCard icon={CalendarCheck} tone="green" label="Ngày có doanh thu" value={daily.length ? `${activeDays}/${daily.length}` : "–"} hint={topDayShare !== null ? `ngày cao nhất = ${pct(topDayShare, 0)} tổng` : undefined} />
                </div>
                <div className="rounded-xl bg-slate-50/60 p-4 ring-1 ring-line">
                  <div className="mb-2 flex flex-wrap items-center gap-x-6 gap-y-1">
                    <span className="text-xs font-semibold">Doanh thu theo ngày</span>
                    <span className="num text-xs text-ink-muted">
                      Tổng <b className="text-ink">{vnd(sumRev)}</b> · TB/ngày <b className="text-ink">{vnd(sumRev / (daily.length || 1))}</b> · Cao nhất{" "}
                      <b className="text-ink">{vnd(Math.max(0, ...dailyRev))}</b>
                    </span>
                  </div>
                  <LineChart points={daily.map((d) => ({ x: d.day, y: d.revenue }))} unit="vnd" label="Doanh thu theo ngày" />
                </div>
              </div>
            ) : (
              <Empty>Chưa có số liệu chi tiết cho nhà sáng tạo này.</Empty>
            )}
          </SectionCard>

          {/* ── Cửa hàng: shop KOC hợp tác bán hàng (Kalodata searchCooperativeShops) ── */}
          <SectionCard
            id="shops"
            title="Cửa hàng"
            icon={Store}
            note={shops.length ? `${shops.length} cửa hàng · ${shops[0].date_range.replace("~", " → ")}` : undefined}
            bodyClass="p-0"
          >
            {shops.length ? (
              <PagedTable
                minWidth={640}
                head={
                  <thead className="bg-slate-50/80 text-left text-[12px] font-medium text-ink-muted">
                    <tr>
                      <th className="w-12 px-4 py-2.5" />
                      <th className="py-2.5">Thông tin cửa hàng</th>
                      <th className="py-2.5">Doanh thu</th>
                      <th className="py-2.5">Số lượng sản phẩm</th>
                      <th className="px-4 py-2.5">Lượt bán</th>
                    </tr>
                  </thead>
                }
                rows={shops.map((s, i) => (
                  <tr key={s.seller_id} className="transition hover:bg-brand-soft/50">
                    <td className="num px-4 py-3.5 text-ink-muted">{i + 1}</td>
                    <td className="py-3.5 pr-4">
                      <div className="flex items-center gap-3">
                        <ShopLogo sellerId={s.seller_id} name={s.shop_name || s.seller_id} />
                        <div className="min-w-0">
                          <div className="line-clamp-1 font-semibold">{s.shop_name || `Người bán ${s.seller_id}`}</div>
                          <div className="mt-0.5 text-[11px] uppercase tracking-wide text-ink-muted">
                            {s.seller_type === "BRAND" ? "Thương hiệu" : s.seller_type === "RETAILER" ? "Nhà bán lẻ" : "—"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="num py-3.5 font-semibold text-brand">
                      {vnd(s.revenue)}
                      {shopTotal > 0 && <span className="ml-1.5 text-[11px] font-normal text-ink-muted">{pct((s.revenue ?? 0) / shopTotal, 1)}</span>}
                    </td>
                    <td className="num py-3.5">{compact(s.product_count)}</td>
                    <td className="num px-4 py-3.5">{compact(s.sales)}</td>
                  </tr>
                ))}
              />
            ) : (
              <Empty>Chưa thu thập dữ liệu cửa hàng cho KOC này.</Empty>
            )}
          </SectionCard>

          {/* ── Videos ── */}
          <SectionCard id="videos" title="Video & Quảng cáo" icon={Clapperboard} note={`${videos.length} video`} bodyClass="p-0">
            {videos.length ? (
              <PagedTable
                minWidth={860}
                head={
                  <thead className="bg-slate-50/80 text-left text-[12px] font-medium text-ink-muted">
                    <tr>
                      <th className="w-12 px-4 py-2.5" />
                      <th className="py-2.5">Video</th>
                      <th className="py-2.5">Sản phẩm</th>
                      <th className="py-2.5 text-right">Doanh thu</th>
                      <th className="py-2.5 text-right">Lượt xem</th>
                      <th className="py-2.5 text-right">Đơn</th>
                      <th className="py-2.5 text-right" title="Tỉ lệ lượt xem đến từ quảng cáo">Lượt xem QC</th>
                      <th className="py-2.5 text-right" title="Tỉ lệ doanh thu đến từ quảng cáo">Doanh thu QC</th>
                      <th className="px-4 py-2.5 text-right">GPM</th>
                    </tr>
                  </thead>
                }
                rows={videos.map((v, i) => (
                  <tr key={v._id} className="transition hover:bg-brand-soft/50">
                    <td className="num px-4 py-3 text-ink-muted">{i + 1}</td>
                    <td className="py-3 pr-4">
                      <div className="flex items-start gap-3">
                        <VideoThumb id={v._id} title={v.title || "Video TikTok"} tiktokUrl={tiktokVideo(c.handle, v._id)} durationSec={v.duration_sec} />
                        <div className="min-w-0 max-w-[260px]">
                          <a href={tiktokVideo(c.handle, v._id)} target="_blank" rel="noreferrer" className="line-clamp-2 font-medium hover:text-brand">
                            {v.title || "(không có mô tả)"}
                          </a>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                            {v.is_ad && <Pill tone="blue">AD</Pill>}
                            {v.is_ai_video && <Pill tone="red">AI video</Pill>}
                            <span>{v.publish_date}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3">
                      {v.product_ids?.[0] ? (
                        <ProductHover id={v.product_ids[0]} info={videoProducts[v.product_ids[0]]} more={v.product_ids.length - 1} />
                      ) : (
                        <span className="text-ink-muted">–</span>
                      )}
                    </td>
                    <td className="num py-3 text-right font-semibold text-brand">{vnd(v.revenue)}</td>
                    <td className="num py-3 text-right">{compact(v.views)}</td>
                    <td className="num py-3 text-right">{compact(v.sales)}</td>
                    <td className="num py-3 text-right">{v.is_ad && v.ad_view_ratio != null ? pct(v.ad_view_ratio, 2) : "–"}</td>
                    <td className="num py-3 text-right">{v.is_ad && v.ad_revenue_ratio != null ? pct(v.ad_revenue_ratio, 2) : "–"}</td>
                    <td className="num px-4 py-3 text-right">{vnd(v.gpm)}</td>
                  </tr>
                ))}
              />
            ) : (
              <Empty>Không có video trong kỳ (KOC có thể chủ yếu bán qua livestream).</Empty>
            )}
          </SectionCard>

          {/* ── Products ── */}
          <SectionCard id="products" title="Sản phẩm đã bán" icon={Package} note={`${products.length} sản phẩm · top theo doanh thu`} bodyClass="p-0">
            {products.length ? (
              <PagedTable
                minWidth={760}
                head={
                  <thead className="bg-slate-50/80 text-left text-[12px] font-medium text-ink-muted">
                    <tr>
                      <th className="w-12 px-4 py-2.5" />
                      <th className="py-2.5">Sản phẩm</th>
                      <th className="py-2.5">Cửa hàng</th>
                      <th className="py-2.5 text-right">Doanh thu</th>
                      <th className="py-2.5 text-right">Lượt bán</th>
                      <th className="px-4 py-2.5 text-right">Đơn giá TB</th>
                    </tr>
                  </thead>
                }
                rows={products.map((p, i) => (
                  <tr key={p.product_id} className="transition hover:bg-brand-soft/50">
                    <td className="num px-4 py-3 text-ink-muted">{i + 1}</td>
                    <td className="max-w-md py-3 pr-4">
                      <div className="flex items-center gap-3">
                        <ProductThumb id={p.product_id} name={p.p?.name ?? ""} />
                        <span className="line-clamp-2">{p.p?.name ?? p.product_id}</span>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      {p.p?.seller_id ? (
                        <div className="flex items-center gap-2">
                          <ShopLogo sellerId={p.p.seller_id} name={p.p.seller_name || p.p.seller_id} />
                          <span className="line-clamp-1 max-w-[180px] text-[13px]">{p.p.seller_name || <span className="text-ink-muted">Chưa rõ tên</span>}</span>
                        </div>
                      ) : (
                        <span className="text-ink-muted">–</span>
                      )}
                    </td>
                    <td className="num py-3 text-right font-semibold text-brand">{vnd(p.revenue)}</td>
                    <td className="num py-3 text-right">{compact(p.sales_volume)}</td>
                    <td className="num px-4 py-3 text-right">{vnd(p.unit_price)}</td>
                  </tr>
                ))}
              />
            ) : (
              <Empty>Chưa có dữ liệu sản phẩm.</Empty>
            )}
          </SectionCard>

          {/* ── Audience ── */}
          <SectionCard id="audience" title="Người theo dõi" icon={Users} note="nhóm chiếm đa số">
            <div className="grid gap-3 sm:grid-cols-2">
              <AudienceTile
                label="Giới tính"
                value={c.audience?.gender_majority === "female" ? "Đa số Nữ (50%+)" : c.audience?.gender_majority === "male" ? "Đa số Nam (50%+)" : "–"}
                tone="from-pink-50 to-white text-pink-700"
              />
              <AudienceTile label="Độ tuổi chiếm tỷ lệ cao nhất" value={c.audience?.age_majority ?? c.audience?.age_buckets_matched?.join(", ") ?? "–"} tone="from-violet-50 to-white text-violet-700" />
            </div>
          </SectionCard>

          {/* ── Contact ── */}
          <SectionCard id="contact" title="Liên hệ" icon={Mail}>
            {contacts.length ? (
              <dl className="grid grid-cols-[160px_1fr] gap-y-2">
                {contacts.map((it) => (
                  <div key={it.key} className="contents">
                    <dt className="text-ink-muted">{it.label}</dt>
                    <dd>
                      <ContactValue it={it} />
                    </dd>
                  </div>
                ))}
                <dt className="text-ink-muted">TikTok</dt>
                <dd>
                  <a href={tiktokProfile(c.handle)} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">
                    {c.handle}
                  </a>
                </dd>
              </dl>
            ) : (
              <p className="text-ink-muted">
                Chưa có liên hệ công khai — liên hệ qua TikTok{" "}
                <a href={tiktokProfile(c.handle)} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">
                  {c.handle}
                </a>
                .
              </p>
            )}
          </SectionCard>
        </div>
      </div>

      {/* Thanh hỏi AI nổi ở đáy màn hình — trả lời từ dữ liệu đã thu thập, kèm bằng chứng */}
      <AskBar
        subjectId={id}
        subjectName={c.nickname || c.handle}
        subjectHandle={c.handle}
        threads={threads}
        placeholder={`Hỏi về ${c.nickname || c.handle}: bán danh mục nào, doanh thu có ổn định…`}
        suggestions={[
          "Đánh giá khả năng bán hàng, so với creator cùng tầm thế nào?",
          "Chủ yếu bán danh mục và sản phẩm nào?",
          "Chất lượng nội dung và cách review sản phẩm ra sao?",
          "Doanh thu có ổn định trong 30 ngày không?",
          "Chi phí hợp tác ước tính bao nhiêu một video?",
        ]}
      />
    </div>
  );
}

function HeroStat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 border-line px-4 py-3 sm:gap-3 sm:px-6 sm:py-4 [&:not(:last-child)]:border-r">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand">
        <Icon size={16} strokeWidth={2.2} />
      </span>
      <div>
        <div className="text-[11px] text-ink-muted">{label}</div>
        <div className="num font-semibold">{value}</div>
      </div>
    </div>
  );
}

function AudienceTile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`rounded-xl bg-gradient-to-br p-5 ring-1 ring-line ${tone}`}>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-ink-muted">{children}</p>;
}

function ContactValue({ it }: { it: ContactItem }) {
  return it.href ? (
    <a href={it.href} target="_blank" rel="noreferrer" className="truncate font-medium text-brand hover:underline">
      {it.value}
    </a>
  ) : (
    <span className="truncate font-medium">{it.value}</span>
  );
}
