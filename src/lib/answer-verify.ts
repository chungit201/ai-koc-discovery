/**
 * Kiểm chứng câu trả lời dạng **markdown tự do** của agent.
 *
 * Thiết kế trước đây trói ĐẦU VÀO: model chỉ được trả về các khối cho sẵn (`para`/`bullets`/`table`)
 * và không được viết số nào trong bảng — code chép hàng từ `evidence`. Nó chặn được bịa số, nhưng
 * đổi lại câu trả lời luôn mang hình hài do giao diện quy định: cùng một bảng `campaign_context`
 * hiện ra dù người dùng hỏi về ngân sách hay hỏi vì sao chọn A.
 *
 * Giờ đổi sang kiểm ĐẦU RA: model viết markdown tự do (bảng, in đậm, giọng của nó), rồi code quét
 * mọi con số trong bài và đối chiếu với kho số của phiên. Tự do bố cục trả lại cho AI, còn bảo đảm
 * "không con số nào không có nguồn" vẫn giữ nguyên — chỉ chuyển từ cấm sang kiểm.
 *
 * File này KHÔNG import "server-only": giao diện cũng dùng để tô những con số chưa kiểm chứng được.
 */

/**
 * Số trong bài, kèm hậu tố đơn vị nếu có — "81,1k", "736 triệu", "+121%", "2,1 tỷ", "24 tr".
 *
 * Hai hàng rào ở hai đầu, thiếu cái nào cũng sinh cảnh báo sai trước mặt người bán:
 *  - Lookbehind: dấu `-` ngay sau một chữ số là dấu NỐI KHOẢNG, không phải dấu âm. Thiếu nó thì
 *    "₫8-20 tr/video" đọc ra thành −20 triệu và bị báo là số bịa.
 *  - Lookahead: đơn vị không được dính chữ cái. Thiếu nó thì "15 KOC" thành 15 nghìn,
 *    "5 trong số" thành 5 triệu.
 */
const TOKEN = /(?<![\d.,])([+-]?\d[\d.,]*)\s*(nghìn|triệu|tr|tỷ|tỉ|k|%)?(?![\p{L}\d])/giu;

const UNIT: Record<string, number> = { nghìn: 1e3, k: 1e3, triệu: 1e6, tr: 1e6, tỷ: 1e9, tỉ: 1e9 };

/** "1.234,5" (vi-VN) và "1,234.5" (en) đều về cùng một số. */
function toNumber(raw: string): number | null {
  const s = raw.replace(/\s/g, "");
  // Dấu nào xuất hiện SAU cùng và chỉ 1 lần với ≤2 chữ số theo sau thì là dấu thập phân
  const dec = /[.,](\d{1,2})$/.exec(s);
  const body = dec ? s.slice(0, -dec[0].length) : s;
  const n = Number(`${body.replace(/[.,]/g, "")}${dec ? `.${dec[1]}` : ""}`);
  return Number.isFinite(n) ? n : null;
}

export interface NumberToken {
  /** Nguyên văn trong bài, để giao diện đánh dấu đúng chỗ. */
  text: string;
  value: number;
  /**
   * Giá trị thay thế cũng được chấp nhận. Dữ liệu Kalodata lẫn hai quy ước: tỉ lệ lưu dạng thập
   * phân (0,0788 = 7,88%) nhưng ĐIỂM thành phần lưu dạng 9,8 — nên "9,8%" trong bài có thể là 0,098
   * hoặc 9,8. Verifier kiểm NGUỒN của con số, không kiểm nhãn đơn vị, nên nhận cả hai.
   */
  alt?: number;
  index: number;
}

/** Mọi con số trong markdown, đã quy về giá trị tuyệt đối (có nhân đơn vị). */
export function numbersIn(md: string): NumberToken[] {
  const out: NumberToken[] = [];
  // Dấu trừ Unicode (U+2212) → "-" để "−24,3%" được đọc như số âm
  for (const m of md.replace(/−/g, "-").matchAll(TOKEN)) {
    const n = toNumber(m[1]);
    if (n === null) continue;
    const unit = m[2]?.toLowerCase();
    const isPct = unit === "%";
    out.push({ text: m[0].trim(), value: isPct ? n / 100 : n * (unit ? (UNIT[unit] ?? 1) : 1), ...(isPct ? { alt: n } : {}), index: m.index ?? 0 });
  }
  return out;
}

/**
 * Kho số hợp lệ của phiên: `numbers` thô của từng kết quả công cụ, CỘNG mọi số đọc được trong câu
 * `summary` đã định dạng. Phải có cả hai vì model chép lại con số theo đúng dạng người đọc
 * ("₫24 tr" chứ không phải 24000000), và vì summary chứa những số dẫn xuất (tỉ lệ %, "3/38 video")
 * mà `numbers` không liệt kê hết.
 */
export function allowedNumbers(evidence: Evidence[]): number[] {
  const pool: number[] = [];
  for (const e of evidence) {
    for (const v of Object.values(e.numbers ?? {})) if (Number.isFinite(v)) pool.push(v);
    for (const t of numbersIn(e.claim)) pool.push(t.value);
    // Hàng của bảng kết quả cũng là nguồn: model chép số từ bảng (tương tác 2,82% của từng KOC đối chuẩn)
    // mà dòng tóm tắt không liệt kê. Thiếu cái này thì số đúng 100% vẫn bị gạch chân "chưa kiểm chứng".
    for (const row of e.rows ?? []) for (const v of Object.values(row ?? {})) if (typeof v === "number" && Number.isFinite(v)) pool.push(v);
  }
  return pool;
}

/** Một nguồn số của phiên: kết quả công cụ (tóm tắt + số thô + hàng bảng), hoặc chữ đọc được từ web. */
export interface Evidence {
  claim: string;
  numbers?: Record<string, number>;
  rows?: Record<string, unknown>[];
}

/** Năm (2024, "2025.") không phải số liệu cần nguồn — model nhắc năm để nói rõ kỳ dữ liệu / ngày tin. */
const isYear = (t: NumberToken) => /^\d{4}[.,]?$/.test(t.text) && t.value >= 1900 && t.value <= 2100;

/** Sai số cho phép: số đã làm tròn khi hiển thị ("₫19,3 tr" ↔ 19.300.000) nên không thể so bằng. */
const TOLERANCE = 0.02;
/** Số đếm nhỏ (1-2 chữ số) không cần nguồn: "chia 2 đợt", "5 KOC", "top 3", ngày tháng. */
const SMALL = 100;

export function isKnown(v: number, pool: number[]): boolean {
  if (Math.abs(v) < SMALL && Number.isInteger(v)) return true;
  // So theo trị tuyệt đối: dữ liệu -24,3% nhưng bài viết "giảm 24,3%" là cùng một con số
  return pool.some((k) => (k === 0 ? v === 0 : Math.abs(Math.abs(v) - Math.abs(k)) / Math.abs(k) <= TOLERANCE));
}

export interface VerifyResult {
  /** Con số không tìm được nguồn — giao diện gạch chân, log cảnh báo. */
  unverified: NumberToken[];
  checked: number;
}

/** Quét markdown, trả về những con số không khớp kho số của phiên. */
export function verifyAnswer(markdown: string, evidence: Evidence[]): VerifyResult {
  const pool = allowedNumbers(evidence);
  const tokens = numbersIn(stripCode(markdown)).filter((t) => !isYear(t));
  return { unverified: tokens.filter((t) => !isKnown(t.value, pool) && !(t.alt !== undefined && isKnown(t.alt, pool))), checked: tokens.length };
}

/**
 * Dấu trích dẫn inline do model đặt: `[^ev_s_abc123_get_overview_1f2e]`. Giao diện đổi thành chip
 * bấm được trỏ về thẻ công cụ đã sinh ra con số đó — markdown tự do vẫn giữ được đường dẫn chứng.
 */
/** Dấu gạch ngang là bắt buộc trong lớp ký tự: session id cắt từ UUID nên có dạng "ded88756-e85". */
export const CITE = /\[\^(ev_s_[A-Za-z0-9_-]+)\]/g;

export const citationsIn = (md: string) => [...new Set([...md.matchAll(CITE)].map((m) => m[1]))];

/**
 * Bỏ những chỗ chứa chữ số nhưng không phải số liệu trước khi quét: khối code, URL, và **dấu trích
 * dẫn** (evidence_id có hex trong tên — không loại thì mọi id đều thành "số bịa").
 */
const stripCode = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(CITE, "")
    .replace(/\((https?:[^)]*)\)/g, "()");
