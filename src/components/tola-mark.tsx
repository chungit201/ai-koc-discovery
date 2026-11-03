/**
 * Logomark của trợ lý **Tola** — chong chóng 4 cánh nhọn.
 *
 * Là *logomark* chứ không phải icon: khối đặc, góc cạnh, khe âm bản giữa các cánh — cùng thể loại
 * với mark của Kalopilot. Bản trước vẽ bằng nét mảnh 1.3–1.8px nên ở 18px trên thanh tab trông yếu
 * và lẫn với các icon lucide xung quanh; khối đặc thì giữ được hình ở mọi cỡ.
 *
 * Bốn cánh toả từ tâm theo chiều kim đồng hồ, độ mờ giảm dần tạo cảm giác đang xoay mà không cần
 * thêm nét nào. Vẽ bằng `currentColor` nên đổi màu theo nơi đặt.
 */
export function TolaMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true" className={className}>
      <g fill="currentColor">
        <path d="M12 12 L11.1 2.4 L20.6 6.1 Z" />
        <path d="M12 12 L21.6 11.1 L17.9 20.6 Z" opacity="0.86" />
        <path d="M12 12 L12.9 21.6 L3.4 17.9 Z" opacity="0.72" />
        <path d="M12 12 L2.4 12.9 L6.1 3.4 Z" opacity="0.58" />
      </g>
    </svg>
  );
}
