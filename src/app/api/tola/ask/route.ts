import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/mongo";
import { C } from "@/lib/db/collections";
import { askTola } from "@/lib/chat-creator-agent";
import { mentionContext, resolveMentions } from "@/lib/mentions";
import { classifyAsk, runDeepSearch } from "@/lib/tola-deep";
import type { ChatMessage } from "@/lib/chat";
import type { AskEvent, StepKind, StepPayload } from "@/lib/chat-events";

/**
 * Hỏi trợ lý **Tola**, trả về theo luồng NDJSON (mỗi dòng một sự kiện) để giao diện hiện dần từng
 * thẻ công cụ thay vì quay vòng chờ cả phút — Server Action không stream được nên phải là route.
 *
 * Ngữ cảnh "đang hỏi về ai" lấy từ tag `@handle` trong chính câu hỏi (`lib/mentions.ts`), không
 * phụ thuộc trang nào đang mở. Cả lượt hỏi–đáp lưu vào `tola_chats` để mở lại vẫn còn.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { text?: string; threadId?: string; campaignId?: string };
  const text = String(body.text ?? "").trim().slice(0, 1000);
  const threadId = String(body.threadId ?? "").trim() || randomUUID();
  const campaignId = String(body.campaignId ?? "").trim() || undefined;
  if (!text) return new Response("Thiếu nội dung câu hỏi", { status: 400 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (e: AskEvent) => controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`));

      const steps: { title: string; detail: string; kind?: StepKind; payload?: StepPayload }[] = [];
      let reply = "";
      let markdown = "";
      let unverified: string[] = [];
      let followUps: string[] = [];
      /** Chiến dịch gắn với hội thoại — khai báo ngoài try để khối lưu ở dưới còn thấy. */
      let activeCampaignId: string | undefined = campaignId;

      try {
        const db = await getDb();
        const thread = await db.collection(C.tolaChats).findOne({ _id: threadId as never }, { projection: { messages: 1, campaign_id: 1 } });
        const history = ((thread?.messages as ChatMessage[]) ?? []).slice(-8);
        /**
         * Chiến dịch của hội thoại này. Phải lấy lại từ `tola_chats`: phân tích sâu chạy ở MỘT lượt,
         * nhưng các lượt sau ("bỏ người này đi") mới là lúc cần sửa nó — không nhớ lại thì agent mất
         * hẳn `campaign_context` và các công cụ ghi.
         */
        const prevCampaign = (thread?.campaign_id as string) || undefined;

        const mentions = await resolveMentions(text);
        send({ type: "plan", steps: [], agent: true });

        /**
         * Brief tuyển KOC → chạy phân tích sâu S2→S5 NGAY TRONG LƯỢT NÀY, phát tiến độ ra chat, rồi
         * mới để agent viết nhận định từ `campaign_context`. Trước đây Tola chỉ tạo chiến dịch rồi
         * đẩy người dùng sang trang khác — mất hẳn mạch hội thoại.
         *
         * Đếm bước phải cộng dồn: agent tự đánh số từ 0, nhưng ở đây các bước pipeline đã chiếm chỗ.
         */
        let deepCampaign: string | null = null;
        if (!campaignId && (await classifyAsk(text)) === "deep") {
          const deep = runDeepSearch(text);
          for (;;) {
            const n = await deep.next();
            if (n.done) {
              deepCampaign = n.value;
              break;
            }
            const e = n.value;
            send(e);
            if (e.type === "step_add") steps.push({ title: e.title, detail: "", kind: e.kind });
            // Giữ cả `payload`: bước xem video mang theo dẫn chứng từng video, mất nó là thẻ trống
            else if (e.type === "step_done" && steps[e.index]) Object.assign(steps[e.index], { detail: e.detail, ...(e.payload ? { payload: e.payload } : {}) });
          }
        }
        const offset = steps.length;
        activeCampaignId = campaignId ?? deepCampaign ?? prevCampaign;

        const ctx = [
          mentionContext(mentions),
          deepCampaign
            ? `Yêu cầu này VỪA được phân tích sâu xong (S2→S5 đã chạy, chiến dịch ${deepCampaign}). Gọi campaign_context trước rồi BÁO CÁO KẾT QUẢ THẬT — ai được chọn, điểm, ngân sách đã chia, bằng chứng. Đừng nói "đang chạy".`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n");

        for await (const e of askTola({
          text,
          history,
          mentioned: mentions.found,
          context: ctx,
          campaignId: activeCampaignId,
        })) {
          // Dời chỉ số bước của agent xuống sau các bước pipeline đã phát ở trên
          const shifted = e.type === "step_done" || e.type === "step_start" ? { ...e, index: e.index + offset } : e;
          send(shifted);
          if (e.type === "step_add") steps.push({ title: e.title, detail: "", kind: e.kind });
          else if (e.type === "step_done" && steps[e.index + offset]) Object.assign(steps[e.index + offset], { detail: e.detail, ...(e.payload ? { payload: e.payload } : {}) });
          else if (e.type === "conclusion") {
            reply = e.text;
            markdown = e.markdown ?? "";
            unverified = e.unverified ?? [];
            followUps = e.follow_ups ?? [];
          }
        }
      } catch (err) {
        console.error("[tola] luồng hỏi đáp lỗi", err);
        send({ type: "error", message: "Mình gặp lỗi khi tra dữ liệu — bạn thử lại giúp mình nhé." });
      }

      // Lưu cả khi lỗi giữa chừng: phần bước đã chạy vẫn giữ được để xem lại
      try {
        const db = await getDb();
        const now = new Date();
        const chats = db.collection(C.tolaChats);
        const existing = await chats.findOne({ _id: threadId as never }, { projection: { title: 1 } });
        await chats.updateOne(
          { _id: threadId as never },
          {
            $push: {
              messages: {
                $each: [
                  { id: randomUUID(), role: "user", text, created_at: now },
                  { id: randomUUID(), role: "assistant", agent: true, text: reply, markdown, unverified, steps, follow_ups: followUps, created_at: now },
                ],
              },
            } as never,
            $set: { updated_at: now, ...(activeCampaignId ? { campaign_id: activeCampaignId } : {}), ...(existing?.title ? {} : { title: text.slice(0, 80) }) },
            $setOnInsert: { created_at: now },
          },
          { upsert: true },
        );
      } catch (err) {
        console.error("[tola] lưu hội thoại lỗi", err);
      }

      controller.close();
    },
  });

  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
