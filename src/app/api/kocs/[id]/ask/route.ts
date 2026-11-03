import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/mongo";
import { C } from "@/lib/db/collections";
import { analyseCreatorStream } from "@/lib/chat-creator";
import type { AnswerBlock, AskEvent, StepKind, StepPayload } from "@/lib/chat-events";
import type { Reason } from "@/lib/evidence/validate";

/**
 * Hỏi đáp về một KOC, **trả về theo luồng NDJSON** (mỗi dòng một sự kiện) để giao diện hiện dần
 * từng bước thay vì quay vòng chờ cả phút. Server Action không stream được nên phải dùng route
 * handler. Khi luồng kết thúc, cả lượt hỏi–đáp được lưu vào `creator_chats` để mở lại vẫn còn.
 */
// Không đặt `export const dynamic` — cấu hình này không dùng được chung với `cacheComponents`
// đang bật trong next.config.ts; POST vốn đã luôn chạy động.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: creatorId } = await params;
  const body = (await req.json().catch(() => ({}))) as { text?: string; threadId?: string };
  const text = String(body.text ?? "").trim().slice(0, 1000);
  const threadId = String(body.threadId ?? "").trim() || randomUUID();
  if (!text) return new Response("Thiếu nội dung câu hỏi", { status: 400 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (e: AskEvent) => controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`));

      // Gom dữ liệu để lưu lại sau khi luồng xong
      // `kind` lấy thẳng từ sự kiện `plan` — kế hoạch là động nên suy theo chỉ số sẽ sai
      const steps: { title: string; detail: string; kind?: StepKind; payload?: StepPayload }[] = [];
      const payload: StepPayload = {};
      let agent = false;
      let reply = "";
      let reasons: Reason[] = [];
      let followUps: string[] = [];
      let blocks: AnswerBlock[] = [];

      try {
        for await (const e of analyseCreatorStream(creatorId, text, threadId)) {
          send(e);
          if (e.type === "plan") {
            agent = Boolean(e.agent);
            for (const s of e.steps) steps.push({ title: s.title, detail: "", kind: s.kind });
          } else if (e.type === "step_add") steps.push({ title: e.title, detail: "", kind: e.kind });
          else if (e.type === "step_done") {
            if (steps[e.index]) steps[e.index].detail = e.detail;
            // Agent: mỗi bước một bảng riêng → lưu theo bước; luồng cũ vẫn gộp như trước
            if (agent) {
              if (steps[e.index] && e.payload) steps[e.index].payload = e.payload;
            } else Object.assign(payload, e.payload ?? {});
          } else if (e.type === "conclusion") {
            reply = e.text;
            reasons = e.reasons;
            followUps = e.follow_ups ?? [];
            blocks = e.blocks ?? [];
          }
        }
      } catch (err) {
        console.error("koc ask stream failed", creatorId, err);
        send({ type: "error", message: "Mình gặp lỗi khi tra dữ liệu KOC này — bạn thử lại giúp mình nhé." });
      }

      // Lưu lượt hỏi–đáp (kể cả khi lỗi giữa chừng, phần đã có vẫn giữ được)
      try {
        const db = await getDb();
        const now = new Date();
        const chats = db.collection(C.creatorChats);
        const existing = await chats.findOne({ _id: threadId as never }, { projection: { title: 1 } });
        await chats.updateOne(
          { _id: threadId as never },
          {
            $push: {
              messages: {
                $each: [
                  { id: randomUUID(), role: "user", text, created_at: now },
                  { id: randomUUID(), role: "assistant", text: reply, reasons, steps, blocks, follow_ups: followUps, ...payload, ...(agent ? { agent: true } : {}), created_at: now },
                ],
              },
            } as never,
            $set: { creator_id: creatorId, updated_at: now, ...(existing?.title ? {} : { title: text.slice(0, 80) }) },
            $setOnInsert: { created_at: now },
          },
          { upsert: true },
        );
      } catch (err) {
        console.error("koc ask save failed", creatorId, err);
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
