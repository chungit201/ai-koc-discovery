"use client";

import { useState } from "react";

const TONES = ["bg-violet-100 text-violet-700", "bg-sky-100 text-sky-700", "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-700", "bg-rose-100 text-rose-700"];

/**
 * Logo shop từ CDN công khai của Kalodata (`tiktok.seller/<seller_id>/logo.png`, cùng kiểu với ảnh bìa
 * video) — không cần crawl. Shop không có logo (404) → ô chữ cái đầu, màu cố định theo tên.
 */
export function ShopLogo({ sellerId, name }: { sellerId: string; name: string }) {
  const [broken, setBroken] = useState(false);
  const box = "grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg ring-1 ring-line";
  if (broken || !sellerId) {
    const tone = TONES[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % TONES.length];
    return <span className={`${box} text-[15px] font-bold ${tone}`}>{(name.trim()[0] ?? "?").toUpperCase()}</span>;
  }
  return (
    <span className={`${box} bg-white`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- ảnh CDN ngoài, lazy, không cần tối ưu */}
      <img
        src={`https://img.kalocdn.com/tiktok.seller/${sellerId}/logo.png`}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer" // CDN từ chối request mang Referer bên thứ ba
        onError={() => setBroken(true)}
        className="h-full w-full object-contain"
      />
    </span>
  );
}
