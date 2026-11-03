"use client";

import { Package, Store } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ProductThumb } from "@/components/product-thumb";
import { compact, vnd } from "@/lib/format";
import type { VideoProductInfo } from "@/lib/data/queries";

const cover = (id: string) => `https://img.kalocdn.com/tiktok.product/${id}/cover.png`;

/**
 * Ảnh sản phẩm nhỏ; rê chuột (hoặc focus bằng bàn phím) hiện thẻ thông tin như Kalodata: ảnh lớn, tên,
 * giá, doanh thu KOC bán được, shop.
 *
 * Thẻ render qua PORTAL với vị trí `fixed` tính từ ô ảnh: bảng nằm trong khung `overflow-x-auto`,
 * đặt thẻ bên trong thì bị cắt mất phần tràn ra ngoài.
 */
export function ProductHover({ id, info, more = 0 }: { id: string; info?: VideoProductInfo; more?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [broken, setBroken] = useState(false);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const W = 240;
    const H = 330;
    // Ưu tiên mở phía trên ô ảnh; sát mép trên màn hình thì mở xuống dưới. Không tràn khỏi mép phải.
    const top = r.top - H - 8 > 8 ? r.top - H - 8 : r.bottom + 8;
    setPos({ left: Math.max(8, Math.min(r.left + r.width / 2 - W / 2, window.innerWidth - W - 8)), top });
  };

  return (
    <span ref={ref} className="relative inline-flex items-center gap-1.5" onMouseEnter={show} onMouseLeave={() => setPos(null)} onFocus={show} onBlur={() => setPos(null)} tabIndex={0}>
      <ProductThumb id={id} name={info?.name ?? ""} />
      {more > 0 && <span className="num text-[11px] text-ink-muted">+{more}</span>}
      {pos &&
        createPortal(
          <div role="tooltip" className="animate-fade pointer-events-none fixed z-[60] w-60 overflow-hidden rounded-xl border border-line bg-white shadow-2xl" style={{ left: pos.left, top: pos.top }}>
            <div className="grid aspect-square w-full place-items-center bg-slate-50">
              {broken ? (
                <Package size={40} className="text-slate-400" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- ảnh CDN ngoài
                <img src={cover(id)} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-full w-full object-contain" />
              )}
            </div>
            <div className="space-y-1.5 p-3">
              <p className="line-clamp-2 text-[13px] leading-snug">{info?.name || <span className="text-ink-muted">Chưa có tên sản phẩm trong dữ liệu</span>}</p>
              {info?.unit_price != null && <p className="num text-[16px] font-semibold">{vnd(info.unit_price)}</p>}
              {info?.revenue != null && (
                <p className="text-[12px] text-ink-muted">
                  KOC này bán được <span className="num font-semibold text-brand">{vnd(info.revenue)}</span>
                  {info.sales != null && <> · {compact(info.sales)} đơn</>} (30 ngày)
                </p>
              )}
              {info?.seller_name && (
                <p className="flex items-center gap-1 text-[12px] text-ink-muted">
                  <Store size={12} /> <span className="line-clamp-1">{info.seller_name}</span>
                </p>
              )}
              {more > 0 && <p className="text-[11.5px] text-ink-muted">Video gắn thêm {more} sản phẩm khác</p>}
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
