import { notFound } from "next/navigation";
import { TolaChat } from "@/components/tola-chat";
import { getTolaThread } from "@/lib/data/queries";

/** Mở lại một hội thoại cũ với trợ lý — hỏi tiếp vẫn nối vào đúng luồng đó. */
export default async function TolaThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTolaThread(id);
  if (!t) notFound();
  return (
    <main className="flex flex-1 flex-col">
      <TolaChat threadId={t.id} initialMessages={t.messages} />
    </main>
  );
}
