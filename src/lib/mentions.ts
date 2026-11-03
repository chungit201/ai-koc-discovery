import "server-only";
import { getDb } from "./db/mongo";
import { C } from "./db/collections";

/**
 * Giải nghĩa tag `@handle` trong câu hỏi gửi cho trợ lý Tola.
 *
 * Đây là cách **duy nhất** xác định "đang hỏi về ai": không phụ thuộc trang đang mở, nên cùng một ô
 * chat dùng được ở mọi nơi. Trang hồ sơ KOC chỉ việc điền sẵn `@handle ` vào ô nhập — cùng một
 * đường code, không có nhánh riêng.
 *
 * Giải nghĩa ở phía CODE chứ không để agent tự tra: nhanh hơn (đỡ một lượt gọi công cụ) và không
 * nhầm người trùng tên. Handle không tồn tại thì nói thẳng trong ngữ cảnh để agent không bịa ra ai.
 */

/** TikTok handle: chữ, số, gạch dưới, chấm. Không ăn dấu chấm cuối câu ("hỏi @abc." → "abc"). */
const MENTION = /@([A-Za-z0-9_](?:[A-Za-z0-9_.]*[A-Za-z0-9_])?)/g;

export interface Mentioned {
  creator_id: string;
  handle: string;
  name: string;
  followers: number | null;
  /** Chưa crawl chi tiết → các công cụ đọc sâu sẽ trả rỗng; agent cần biết trước để không hứa suông. */
  has_detail: boolean;
}

export interface MentionResult {
  found: Mentioned[];
  /** Handle người dùng gõ nhưng không có trong dữ liệu. */
  missing: string[];
}

export const handlesIn = (text: string): string[] => [...new Set([...text.matchAll(MENTION)].map((m) => m[1].toLowerCase()))];

const PROJECTION = { handle: 1, nickname: 1, followers: 1, detail_updated_at: 1 };

const toMentioned = (d: Record<string, unknown>): Mentioned => ({
  creator_id: String(d._id),
  handle: String(d.handle ?? "").replace(/^@/, ""),
  name: String(d.nickname || d.handle || d._id),
  followers: typeof d.followers === "number" ? d.followers : null,
  has_detail: Boolean(d.detail_updated_at),
});

/** KOC theo id — popup ở trang hồ sơ KOC gửi kèm id của trang thay cho tag `@handle`. */
export async function mentionById(creatorId: string): Promise<Mentioned | null> {
  const db = await getDb();
  const d = await db.collection(C.creators).findOne({ _id: creatorId as never }, { projection: PROJECTION });
  return d ? toMentioned(d) : null;
}

export async function resolveMentions(text: string): Promise<MentionResult> {
  const handles = handlesIn(text);
  if (!handles.length) return { found: [], missing: [] };

  const db = await getDb();
  // `creators.handle` lưu kèm "@" — tìm cả hai dạng cho chắc
  const docs = await db
    .collection(C.creators)
    .find({ handle: { $in: handles.flatMap((h) => [h, `@${h}`]) } }, { projection: PROJECTION })
    .toArray();

  const found: Mentioned[] = docs.map(toMentioned);
  const got = new Set(found.map((f) => f.handle.toLowerCase()));
  return { found, missing: handles.filter((h) => !got.has(h)) };
}

/** Khối ngữ cảnh đưa vào prompt — rỗng khi câu hỏi không tag ai. */
export function mentionContext({ found, missing }: MentionResult): string {
  const lines: string[] = [];
  if (found.length)
    lines.push(
      `Người bán đang hỏi về ${found.length === 1 ? "KOC này" : "các KOC này"} (dùng đúng creator_id dưới đây, KHÔNG gọi search_creators để tìm lại):\n` +
        found
          .map((f) => `- ${f.name} — creator_id ${f.creator_id}, handle @${f.handle}${f.has_detail ? "" : " (CHƯA có dữ liệu chi tiết: các công cụ đọc sâu sẽ trống)"}`)
          .join("\n"),
    );
  if (missing.length)
    lines.push(`Handle không có trong dữ liệu: ${missing.map((h) => `@${h}`).join(", ")} — nói thẳng là chưa thu thập được KOC này, có thể dùng search_creators tìm tên gần đúng.`);
  return lines.join("\n\n");
}
