"use client";

import { useRouter } from "next/navigation";
import { Composer } from "@/components/ask-bar";

/**
 * Ô hỏi Tola nổi ở đáy trang danh sách KOC (chỉ desktop — mobile đã có nút Tola ở thanh dưới).
 * Câu hỏi ở đây là về cả tập KOC nên không mở popup như trang hồ sơ: chuyển sang `/tola?q=` và màn
 * chat tự gửi câu đó. Nút phóng to mở `/tola` trống.
 */
export function TolaAskBar({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 hidden justify-center px-4 pb-5 lg:flex lg:pl-64">
      <div className="pointer-events-auto w-full max-w-[760px]">
        <Composer
          placeholder={placeholder}
          rounded
          onSend={async (t) => {
            const q = t.trim();
            if (q) router.push(`/tola?q=${encodeURIComponent(q)}`);
          }}
          onExpand={() => router.push("/tola")}
        />
      </div>
    </div>
  );
}
