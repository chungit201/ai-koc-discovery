import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Loader2 } from "lucide-react";
import { TolaChat } from "@/components/tola-chat";
import { getTolaThread } from "@/lib/data/queries";

/** Mở lại một hội thoại cũ với trợ lý — hỏi tiếp vẫn nối vào đúng luồng đó. */
export default function TolaThreadPage({ params }: PageProps<"/tola/[id]">) {
  return (
    <main className="flex flex-1 flex-col">
      {/* `params` + Mongo là dữ liệu theo request → phải nằm trong Suspense, nếu không `next build` dừng
          với lỗi "uncached data during prerendering" (dev chỉ cảnh báo) */}
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-ink-muted">
            <Loader2 size={20} className="animate-spin text-brand" />
          </div>
        }
      >
        <Thread params={params} />
      </Suspense>
    </main>
  );
}

async function Thread({ params }: { params: PageProps<"/tola/[id]">["params"] }) {
  const { id } = await params;
  const t = await getTolaThread(id);
  if (!t) notFound();
  return <TolaChat key={t.id} threadId={t.id} initialMessages={t.messages} />;
}
