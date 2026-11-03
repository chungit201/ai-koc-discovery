import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/mongo";
import { C } from "@/lib/db/collections";
import { askTola } from "@/lib/chat-creator-agent";
import { mentionById, mentionContext, resolveMentions } from "@/lib/mentions";
import { runDeepSearch } from "@/lib/tola-deep";
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
  const body = (await req.json().catch(() => ({}))) as { text?: string; threadId?: string; campaignId?: string; creatorId?: string };
  /** Hỏi từ popup ở trang hồ sơ KOC: KOC đang xem coi như đã được tag dù câu hỏi không có `@handle`. */
  const creatorId = String(body.creatorId ?? "").trim() || undefined;
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
        let subject = creatorId ? (mentions.found.find((m) => m.creator_id === creatorId) ?? null) : null;
        if (creatorId && !subject) {
          subject = await mentionById(creatorId);
          if (subject) mentions.found.unshift(subject);
        }
        send({ type: "plan", steps: [], agent: true });

        /**
         * Phát một luồng sự kiện ra chat. Mỗi nguồn (agent, pipeline) tự đánh số bước từ 0, nên dời
         * chỉ số theo số bước đã phát trước nó. Trả về brief nếu agent giao lại để phân tích sâu.
         * `done` của từng chặng không gửi xuống: client coi `done` là hết lượt.
         */
        let cost = 0;
        const pipe = async (gen: AsyncGenerator<AskEvent, unknown>): Promise<{ brief: string | null; ret: unknown }> => {
          const offset = steps.length;
          let brief: string | null = null;
          for (;;) {
            const r = await gen.next();
            if (r.done) return { brief, ret: r.value };
            const e = r.value;
            if (e.type === "deep_request") {
              brief = e.brief;
              continue;
            }
            const shifted = e.type === "step_done" || e.type === "step_start" ? { ...e, index: e.index + offset } : e;
            if (e.type === "done") cost += e.cost_usd ?? 0;
            else send(shifted);
            if (e.type === "step_add") steps.push({ title: e.title, detail: "", kind: e.kind });
            // Giữ cả `payload`: bước xem video mang theo dẫn chứng từng video, mất nó là thẻ trống
            else if (e.type === "step_done" && steps[e.index + offset]) Object.assign(steps[e.index + offset], { detail: e.detail, ...(e.payload ? { payload: e.payload } : {}) });
            else if (e.type === "conclusion") {
              reply = e.text;
              markdown = e.markdown ?? "";
              unverified = e.unverified ?? [];
              followUps = e.follow_ups ?? [];
            }
          }
        };

        const subjectNote = subject
          ? `Người bán đang hỏi từ trang hồ sơ của KOC ${subject.name} (@${subject.handle}, creator_id ${subject.creator_id}). Câu hỏi không nói rõ là ai ("KOC này", "bạn này", hoặc không nhắc tên) thì hiểu là hỏi RIÊNG về KOC này — trả lời về đúng người này, không tìm/so sánh KOC khác trừ khi được yêu cầu.`
          : "";
        const ask = (campaign: string | undefined, extra: string, allowDeep: boolean) =>
          askTola({
            text,
            history,
            mentioned: mentions.found,
            context: [subjectNote, mentionContext(mentions), extra].filter(Boolean).join("\n\n"),
            campaignId: campaign,
            // Có chiến dịch → câu trả lời nằm trong DB; không cho agent lan man ra web
            allowWeb: !campaign,
            allowDeep,
          });

        /**
         * Chặng 1 — agent đọc câu hỏi và TỰ quyết: tra cứu thì trả lời luôn; brief tuyển KOC thì gọi
         * `start_campaign_analysis` và dừng. Trước đây một bước phân loại riêng (regex + Haiku) quyết
         * thay agent và bắt nhầm câu xếp hạng ("tìm 20 nhà sáng tạo doanh thu cao nhất") thành brief.
         * Không mở phân tích sâu khi đã có chiến dịch hoặc đang hỏi về một KOC cụ thể từ trang hồ sơ.
         */
        activeCampaignId = campaignId ?? prevCampaign;
        const first = await pipe(ask(activeCampaignId, "", !activeCampaignId && !subject));

        if (first.brief) {
          // Chặng 2 — phân tích sâu S2→S5 ngay trong lượt, phát tiến độ từng bước ra chat
          const deep = await pipe(runDeepSearch(first.brief));
          const deepCampaign = (deep.ret as string | null) ?? null;
          if (deepCampaign) activeCampaignId = deepCampaign;
          // Chặng 3 — agent đọc kết quả thật và báo cáo (không mở phân tích lần nữa)
          await pipe(
            ask(
              activeCampaignId,
              deepCampaign
                ? `Yêu cầu này VỪA được phân tích sâu xong (S2→S5 đã chạy, chiến dịch ${deepCampaign}). Gọi campaign_context trước rồi BÁO CÁO KẾT QUẢ THẬT — ai được chọn, điểm, ngân sách đã chia, bằng chứng. Đừng nói "đang chạy".`
                : "Phân tích sâu không chạy được (không hiểu được yêu cầu). Nói rõ điều đó và hỏi người bán thêm thông tin: sản phẩm, số KOC, ngân sách.",
              false,
            ),
          );
        }
        send({ type: "done", cost_usd: cost });
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
