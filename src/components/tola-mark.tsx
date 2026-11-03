import Image from "next/image";

/**
 * Logo của trợ lý **Tola** — rô-bốt mặt cười (ảnh `public/tola-logo.png`, nền trong suốt).
 *
 * Ảnh đã có màu riêng (xanh lá → xanh dương) nên khung bọc bên ngoài để nền trắng/sáng; đặt trên nền
 * tối vẫn rõ. Ảnh gốc 280×265 → giữ đúng tỉ lệ bằng `object-contain` trong ô vuông `size`.
 */
export function TolaMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  // Các chỗ gọi chọn `size` theo hình chong chóng cũ (đặc, kín ô) — rô-bốt thoáng hơn nên phóng ~35% cho cân trong khung
  const px = Math.round(size * 1.35);
  return <Image src="/tola-logo.png" alt="" aria-hidden width={px} height={px} className={`object-contain ${className}`} />;
}

/**
 * Huy hiệu Tola "đang sống": viền gradient cùng màu rô-bốt xoay chậm, vòng sáng lan như nhịp thở,
 * rô-bốt nhún nhẹ + vệt sáng lướt qua. Dùng ở MỌI chỗ hiện logo Tola cho đồng bộ (keyframes ở
 * `globals.css`, tự tắt khi máy bật giảm chuyển động).
 *
 * `size` = đường kính ngoài (px). Ô nhỏ (< 36px) bỏ vòng sáng lan — ở cỡ đó nó thành nhòe chứ không đẹp.
 */
export function TolaOrb({ size = 56, active = false, className = "" }: { size?: number; active?: boolean; className?: string }) {
  const border = Math.max(2, Math.round(size * 0.07));
  return (
    <span className={`relative grid shrink-0 place-items-center ${className}`} style={{ width: size, height: size }}>
      {size >= 36 && <span aria-hidden className="animate-halo absolute inset-0 rounded-full bg-gradient-to-br from-emerald-400 to-sky-500" />}
      <span
        aria-hidden
        className="animate-spin-slow absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,#34d399,#38bdf8,#6366f1,#38bdf8,#34d399)] shadow-[0_6px_18px_-8px_rgb(14_116_144_/_0.6)]"
      />
      <span className={`absolute grid place-items-center overflow-hidden rounded-full ${active ? "bg-brand-soft" : "bg-white"}`} style={{ inset: border }}>
        <TolaMark size={Math.round(size * 0.37)} className="animate-bob relative z-10" />
        <span aria-hidden className="animate-shine pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-sky-100/70 to-transparent" />
      </span>
    </span>
  );
}
