import "server-only";
import { getDb } from "./db/mongo";
import { C } from "./db/collections";

/**
 * NGÀNH HÀNG — một chỗ khai báo duy nhất. DB sẽ có nhiều ngành (không riêng mỹ phẩm): code và prompt
 * KHÔNG được viết cứng "mỹ phẩm" / mã 848776, mà đọc từ đây hoặc từ `industriesInDb()`.
 *
 * Mã ngành = category id của Kalodata (cấp 1/2/3). "Phạm vi" (scope) = chuỗi các mã nối bằng dấu phẩy,
 * đúng như `creator_metrics.category_scope` mà crawler ghi (vd "848776,848648").
 * Thêm ngành mới: thêm tên mã vào `CATEGORY_NAMES` — phần còn lại tự nhận từ dữ liệu đã crawl.
 */
export const CATEGORY_NAMES: Record<string, string> = {
  "601450": "Làm đẹp",
  "848776": "Chăm sóc da",
  "848648": "Trang điểm",
  "601602": "Kem chống nắng da mặt",
  "848776,848648": "Mỹ phẩm (Chăm sóc da + Trang điểm)",
  all: "Tất cả ngành",
};

/** Tên hiển thị của một phạm vi ("848776,848648" → "Chăm sóc da + Trang điểm"); mã lạ giữ nguyên số. */
export function scopeName(scope: string): string {
  if (CATEGORY_NAMES[scope]) return CATEGORY_NAMES[scope];
  return scope
    .split(",")
    .map((id) => CATEGORY_NAMES[id.trim()] ?? `ngành ${id.trim()}`)
    .join(" + ");
}

export interface Industry {
  scope: string;
  name: string;
  /** Số KOC có số liệu trong phạm vi này */
  kocs: number;
}

let cache: { at: number; list: Industry[] } | null = null;

/** Các ngành THỰC SỰ có dữ liệu (crawl danh sách KOC theo ngành), nhiều KOC trước. Cache 10 phút. */
export async function industriesInDb(): Promise<Industry[]> {
  if (cache && Date.now() - cache.at < 600_000) return cache.list;
  const db = await getDb();
  const rows = await db
    .collection(C.creatorMetrics)
    .aggregate<{ _id: string; kocs: number }>([
      { $match: { source: "web:creator/queryList", category_scope: { $nin: [null, "", "all"] } } },
      { $group: { _id: "$category_scope", ids: { $addToSet: "$creator_id" } } },
      { $project: { kocs: { $size: "$ids" } } },
      { $sort: { kocs: -1 } },
    ])
    .toArray();
  const list = rows.map((r) => ({ scope: String(r._id), name: scopeName(String(r._id)), kocs: r.kocs }));
  cache = { at: Date.now(), list };
  return list;
}

/** Khối ngữ cảnh cho prompt Tola: dữ liệu đang có những ngành nào — thay cho câu viết cứng "chỉ có mỹ phẩm". */
export async function industryContext(): Promise<string> {
  const list = await industriesInDb().catch(() => []);
  if (!list.length) return "";
  return `Dữ liệu Kalodata hiện có các ngành: ${list.map((i) => `${i.name} (${i.kocs.toLocaleString("vi-VN")} KOC)`).join("; ")}. Câu hỏi về ngành KHÔNG nằm trong danh sách này → nói rõ chưa có số liệu ngành đó, rồi tìm web trả lời phần làm được.`;
}
