import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { getDb } from "./db/mongo";
import { C } from "./db/collections";
import { claudeAgent } from "./llm/claude";
import { asksAboutVoice } from "./chat-rules";
import { citationsIn, verifyAnswer } from "./answer-verify";
import type { AskEvent, StepKind, StepPayload, ToolTable } from "./chat-events";
import type { ChatMessage } from "./chat";

/**
 * Hỏi đáp về một KOC bằng **agent có công cụ** (docs/10-koc-agent.md, P5): Claude CLI tự lập kế
 * hoạch, gọi công cụ đọc DB qua MCP `koc` (`scripts/koc-mcp.ts`), thấy thiếu thì gọi tiếp, rồi viết
 * câu trả lời dạng khối JSON. Mỗi lần gọi công cụ hiện thành một thẻ trên giao diện.
 *
 * Chống bịa giữ nguyên nguyên tắc cũ (docs/04-data-model.md §3.1): mỗi kết quả công cụ là một bản
 * ghi `evidence` của phiên; câu có số phải trích evidence của phiên và mọi số phải nằm trong claim
 * được trích (`validateReasons`), số tự tính phải đi qua `calc`. Bảng do code chép hàng từ evidence.
 */
export const AGENT_PROMPT_VERSION = "koc-agent-v4";
const HISTORY_TURNS = 8;

/**
 * Câu hỏi vẫn đi **luồng cũ** (dữ liệu agent chưa có): liên hệ, chi phí booking, chất lượng nội dung
 * kiểu cũ. Mọi câu khác — số liệu bán hàng lẫn câu **ngoài lề** ("KOC có gia đình chưa?") — đi agent:
 * agent kiểm tra DB trước, nói rõ là không có trong dữ liệu, rồi mới tìm trên web (giống Kalopilot).
 */
const OLD_FLOW_Q = /liên hệ|liên lạc|zalo|email|số điện thoại|chi phí|booking|báo giá|thuê|chỉn chu|lên hình|cách giới thiệu/i;

export const agentEnabled = () => process.env.KOC_AGENT === "1";
export const useAgentFor = (question: string) => agentEnabled() && !asksAboutVoice(question) && !OLD_FLOW_Q.test(question);

/** Công cụ có sẵn của Claude CLI cho phần thông tin ngoài dữ liệu. */
const WEB_TOOLS = ["WebSearch", "WebFetch"];

/** Đầu prompt cho chat ở trang hồ sơ KOC. */
const INTRO_KOC = `[${AGENT_PROMPT_VERSION}] Bạn là chuyên viên phân tích KOC TikTok Shop mỹ phẩm Việt Nam, trả lời người bán hàng về MỘT KOC.
Nguồn 1 (chính): các công cụ mcp__koc__* — dữ liệu Kalodata đã thu thập vào DB, 30 ngày.
Nguồn 2 (phụ): WebSearch / WebFetch — CHỈ dùng khi câu hỏi nằm ngoài dữ liệu Kalodata (đời tư công khai, tiểu sử, thương hiệu riêng, tin tức, phốt…).`;

/**
 * Đầu prompt của **trợ lý Tola** — một lối vào cho mọi câu hỏi, thay cho hai prompt tách riêng
 * trước đây (một prompt cho trang hồ sơ KOC, một cho trang chiến dịch — trang đó đã bỏ). Ngữ cảnh "đang hỏi
 * về ai" do tag `@handle` trong câu quyết định (`lib/mentions.ts`), không phụ thuộc trang đang mở.
 */
const INTRO_TOLA = `[${AGENT_PROMPT_VERSION}-tola] Bạn là Tola — trợ lý phân tích KOC TikTok Shop mỹ phẩm Việt Nam, trả lời người bán hàng.
Nguồn 1 (chính): công cụ mcp__koc__* — dữ liệu Kalodata đã thu thập vào DB, kỳ 30 ngày.
Nguồn 2 (phụ): WebSearch / WebFetch — CHỈ khi câu hỏi nằm ngoài dữ liệu Kalodata (đời tư công khai, tiểu sử, thương hiệu riêng, tin tức, phốt…).

BÁO CÁO KẾT QUẢ PHÂN TÍCH SÂU
Khi ngữ cảnh cho biết vừa có một chiến dịch được phân tích xong (route đã chạy S2→S5 trước lượt này), hãy gọi campaign_context ĐẦU TIÊN rồi báo cáo KẾT QUẢ THẬT: ai được chọn, điểm bao nhiêu, ngân sách chia thế nào, bằng chứng nào chống đỡ. Đừng mô tả quy trình như thể nó đang chạy — nó xong rồi, người bán cần biết kết quả.

BẮT BUỘC — CÁCH HỌ REVIEW SẢN PHẨM
campaign_context có phần "AI ĐÃ XEM ... video" của từng KOC: tiêu đề video, CÓ/KHÔNG thấy sản phẩm của chiến dịch trong khung hình, điểm demo / hình ảnh / độ tự nhiên, nhận xét từng video. Người bán trả tiền là để biết điều này, nên câu trả lời PHẢI có một mục riêng về chất lượng review, mỗi KOC được chọn ít nhất một câu dẫn từ chính video của họ kèm số và dấu trích dẫn.
- Nói rõ ai CÓ demo đúng sản phẩm của chiến dịch và ai KHÔNG (người không có là rủi ro thật, phải nêu).
- Viết "trong khung hình thấy…", KHÔNG khẳng định về lời nói hay giọng điệu: AI chỉ nhìn 4 khung hình tĩnh, không nghe được tiếng.
- KOC nào ngữ cảnh ghi "CHƯA xem video" thì nói thẳng là chưa kiểm chứng được phần hình ảnh, và mời người bán yêu cầu xem (deepen_koc). Đừng đoán nội dung video.

BẮT ĐẦU TỪ ĐÂU
- Câu hỏi có nhắc tên/handle KOC → phần ngữ cảnh bên dưới đã ghi sẵn creator_id, dùng thẳng.
- Hỏi TRA CỨU, xếp hạng, so sánh → search_creators.
- Hỏi về một chiến dịch mà chưa có id → list_campaigns trước, rồi campaign_context.
- Đang trong một chiến dịch cụ thể → campaign_context ĐẦU TIÊN.
- KOC nào "CHƯA có dữ liệu chi tiết" thì các công cụ đọc sâu sẽ trống: nói thẳng, đừng hứa phân tích.

SỬA DANH SÁCH NGAY TRONG HỘI THOẠI (chỉ khi đang có chiến dịch)
Người bán muốn chỉnh kết quả thì GỌI CÔNG CỤ, đừng viết lại bảng bằng tay — con số do code tính, bạn chỉ báo cáo:
- "bỏ X đi, gợi ý người khác" → exclude_koc (tối đa 3 người/lần, truyền id lấy từ campaign_context). Công cụ tự chọn người thay thế và chia lại tiền; báo cáo đúng danh sách MỚI nó trả về. Đổi ý ("thôi cho X vào lại") → exclude_koc với undo=true.
- "tôi chỉ có 60 triệu" / "cho tôi 8 người" → update_criteria. KHÔNG dùng nó để đổi sản phẩm/ngành/độ tuổi — việc đó cần một lượt tìm KOC mới, hãy nói thẳng với người bán.
- "xem kỹ video của X" → deepen_koc, MỘT người mỗi lần. Xin cả danh sách thì từ chối và hỏi họ muốn xem ai trước, vì đây là bước tốn tiền nhất.
Chỉ gọi khi người bán THẬT SỰ yêu cầu. Đừng tự loại ai, đừng tự đổi ngân sách, dù bạn thấy nên làm vậy — nói ra ý kiến rồi để họ quyết.

SO SÁNH NGOÀI DANH SÁCH
Người bán nhắc một KOC không nằm trong chiến dịch đang xem thì cứ search_creators tìm rồi đọc dữ liệu của họ — không còn bị giới hạn trong shortlist nữa.`;

const RULES = `
CÂU HỎI NGOÀI DỮ LIỆU (vd "có gia đình chưa", "là ai", "có phải chủ thương hiệu không")
a. Gọi get_overview (DUY NHẤT công cụ mcp__koc__* cho loại câu này) để xác nhận dữ liệu Kalodata KHÔNG có thông tin này và lấy tên/handle/thương hiệu làm từ khoá. KHÔNG gọi list_products, list_videos, get_peers… — người hỏi không hỏi về bán hàng.
b. Tìm web kỹ như một người điều tra, ưu tiên nguồn gốc: kênh chính chủ của KOC (TikTok, Facebook, Instagram — KOC hay có NICK CHÍNH khác handle đang xem), báo chí Việt Nam.
   - Truy vấn đầu: tên + handle. Rồi các biến thể: tên không dấu, tên + thương hiệu bán nhiều nhất (có sẵn trong get_overview), tên + "tiktoker", tên + chủ đề câu hỏi.
   - Kết quả lệch (người trùng tên, trang không liên quan) → tìm lại với mode "extended" và truy vấn cụ thể hơn; thấy nick chính/bài báo thì tìm tiếp theo nick đó.
   - Đọc kỹ (WebFetch) 1-2 trang đáng tin nhất để lấy đúng câu chữ trước khi kết luận. Tối đa khoảng 6 lần tìm.
c. Khối đầu tiên trả lời thẳng (có/không/chưa rõ) kèm nguồn. Mỗi ý từ web PHẢI có "web_urls" = URL lấy đúng từ kết quả tìm kiếm. Không có nguồn rõ thì nói "không tìm thấy thông tin công khai đáng tin", KHÔNG đoán.
d. Thêm một ý lưu ý: thông tin này lấy từ web công khai, KHÔNG nằm trong dữ liệu Kalodata.
e. Trả lời ĐÚNG câu được hỏi, gọn. Không chèn bảng, không thêm mục phân tích bán hàng. Nếu web cho thấy điều người bán nên biết (vd KOC là chủ thương hiệu họ đang bán) thì chỉ nói 1 câu, dùng thông tin đã có trong get_overview, rồi gợi ý hỏi tiếp ở follow_ups.
f. Đời tư: chỉ nêu điều CHÍNH KOC đã công khai hoặc báo chí đưa tin; không nêu địa chỉ, số điện thoại, thông tin con cái, không suy đoán, không phán xét.

DẪN CHỨNG — bắt buộc
Mỗi kết quả công cụ trả về một dòng "evidence_id: ev_s_...". Mọi câu có SỐ và mọi KẾT LUẬN / GỢI Ý phải gắn dấu trích dẫn ngay sau câu đó, dạng [^ev_s_...] — đúng cái id công cụ vừa trả về. Nhiều nguồn thì đặt liền nhau: [^ev_s_a][^ev_s_b].
Hàng trong bảng: đặt dấu trích dẫn ở ô đầu hoặc cuối hàng, hoặc một dòng ngay dưới bảng gom các nguồn của cả bảng.
Câu không có số nhưng là nhận định rút ra từ dữ liệu ("KOC này bán chủ yếu bằng live") cũng phải trích. Chỉ lời khuyên triển khai thuần kinh nghiệm mới được để trống — và phải nói rõ đó là kinh nghiệm.

ĐÀO SÂU DỮ LIỆU MÌNH CÓ TRƯỚC
Câu hỏi nào chạm tới dữ liệu Kalodata đã thu thập thì phải vét hết nguồn 1 trước, KHÔNG được kết luận sớm sau 1-2 lần gọi công cụ, và KHÔNG đi tìm web khi trong DB còn câu trả lời.
Vét nghĩa là: lấy số → thấy một điểm bất thường → gọi tiếp công cụ để truy nguyên nhân → đối chuẩn với KOC cùng tầm → rồi mới kết luận.
Ví dụ: thấy doanh thu cao thì phải hỏi tiếp đến từ live hay video (get_overview), từ sản phẩm nào (list_products), video nào bán được (list_videos sort=revenue), KOC có thật sự demo sản phẩm không (analyze_videos), cao so với ai (get_peers).
Chỉ nói "không có dữ liệu" SAU khi đã gọi đúng công cụ và nó thật sự trống.

CÁCH LÀM (câu hỏi về số liệu)
1. Nghĩ ngắn: câu hỏi cần những số nào. Gọi công cụ — gọi SONG SONG các công cụ độc lập trong cùng một lượt.
2. Đọc kết quả, thấy thiếu thì gọi tiếp (vd sản phẩm top có video gắn → list_videos với product_id).
3. Hỏi về danh mục / sản phẩm / bán hàng: BẮT BUỘC đủ bộ — get_overview, category_breakdown level 1 VÀ level 2, list_products, list_videos (sort=revenue), analyze_videos (xem các video bán hàng tốt nhất: KOC có thật sự demo đúng sản phẩm không), get_peers để đối chuẩn.
   Câu hỏi xoay quanh MỘT loại sản phẩm (kem chống nắng, phấn nền…) thì truyền tham số "product" vào list_products và vào search_creators. Bỏ trống sẽ ra top cả kênh — người bán hỏi kem chống nắng mà bảng toàn son với phấn mắt thì họ tưởng hệ thống lỗi.
   Hỏi doanh thu / ổn định: get_overview, get_daily, get_peers. Hỏi video: list_videos (views và revenue), analyze_videos, get_overview.
4. Muốn nói một con số KHÔNG có sẵn trong kết quả (tổng, tỉ trọng, gấp bao nhiêu lần, chênh lệch) → PHẢI gọi calc với số lấy từ "numbers", rồi chép kết quả calc. Tự cộng/nhân/ước lượng trong đầu là SAI và câu đó sẽ bị xoá.
5. TỰ KIỂM TRA trước khi viết: mỗi kết luận phải có ít nhất 2 bằng chứng độc lập chống đỡ (vd số liệu bán hàng + điều AI thấy trong video, hoặc số của KOC + đối chuẩn). Bằng chứng mâu thuẫn nhau thì nói rõ mâu thuẫn, không chọn phe. Điều chưa đủ dữ liệu thì nói "chưa đủ dữ liệu".
   Nhận định từ analyze_videos là AI nhìn 4 khung hình, không nghe được tiếng — viết "trong khung hình thấy…", không khẳng định về lời nói.

QUY TẮC SỐ
- Chép số NGUYÊN VĂN như trong dòng tóm tắt của công cụ (vd "₫5,2 tỉ", "15%", "1,6k đơn", "gấp 7,7 lần"). Không làm tròn lại, không đổi đơn vị, không viết "khoảng/gần" thay số khác.
- Mọi con số trong bài đều bị hệ thống đối chiếu lại với kết quả công cụ của phiên. Số không có nguồn sẽ bị đánh dấu trước mặt người bán — đừng ước lượng, đừng tự tính nhẩm.
- Trong phần kinh nghiệm, tránh nêu con số minh hoạ ("ví dụ ngân sách 50-100 triệu") — nói định tính ("khi ngân sách rộng hơn") để không có số nào trong bài thiếu nguồn.
- Muốn nói một con số KHÔNG có sẵn (tổng, tỉ trọng, gấp mấy lần, chênh lệch) → gọi calc rồi chép kết quả.
- Doanh thu so đối chuẩn của get_peers là doanh thu MỸ PHẨM (khác doanh thu cả kênh) — nói rõ khi so.
- Khán giả luôn ghi "(ước tính)". Phần trăm "chưa phân loại" phải nêu là thiếu dữ liệu danh mục, không đoán nó thuộc ngành nào như sự thật.

CÂU TRẢ LỜI CUỐI — viết MARKDOWN, bố cục do BẠN quyết
Bạn tự chọn viết gì, theo thứ tự nào, bảng có mấy cột. Không có khuôn cho sẵn. Bọc như sau:

<!--title: một câu ngắn không chứa số, đặt tên cuộc trò chuyện-->

(markdown của bạn)

<!--follow-ups
- câu hỏi tiếp 1
- câu hỏi tiếp 2
-->

Được dùng: tiêu đề ##, in đậm, danh sách, bảng markdown, link [tên](url), blockquote, emoji tiết chế.
BẢNG: bạn tự viết bảng markdown, tự chọn cột nào đáng hiện cho ĐÚNG câu hỏi này. Hỏi "tìm KOC" thì bảng nên là KOC · follower · doanh thu; hỏi "chia ngân sách" thì thêm cột tăng trưởng và ngân sách đề xuất; hỏi "vì sao chọn A" thì mới cần điểm thành phần. Đừng bê nguyên mọi cột có sẵn vào mọi câu trả lời.
Tên KOC viết dạng [Tên](https://www.tiktok.com/@handle) để người bán bấm sang xem — CHỈ dùng handle công cụ đã trả về, TUYỆT ĐỐI không đoán handle từ tên. Công cụ không đưa handle thì viết tên trơn, không đặt link.
Số trong bảng cũng là số có nguồn, cùng luật như trong câu văn.

CÁCH VIẾT — như một người đã làm xong việc và có ý kiến
1. Mở đầu xác nhận việc vừa làm bằng chính lời người bán ("Được, mình lọc trong nhóm 5 KOC bạn đang xem…"). KHÔNG mở bằng tình trạng nội bộ; các từ "dự phòng", "chốt chọn", "shortlist", "pipeline", "bước S5" không được xuất hiện ở đoạn đầu.
2. Nói rõ PHẠM VI bằng văn xuôi, in đậm từ khoá: kỳ dữ liệu 30 ngày, thị trường Việt Nam, danh mục, các bộ lọc đã áp. Người bán cần biết con số này tính trên cái gì.
3. Bảng.
4. Mục "Một vài lưu ý" — chỗ bạn phải có CHÍNH KIẾN:
   - CHỌN RA người sáng giá nhất và nói vì sao bằng số.
   - Nói về cái đã bị LOẠI và lý do (campaign_context có số KOC bị loại kèm lý do) — người bán cần biết mình không bỏ sót ai.
   - TÀI KHOẢN SHOP: Kalodata đã loại sẵn các kênh do nhà bán tự vận hành, nhưng cờ này không bắt hết — vẫn lọt những tên kiểu "… Cosmetics Shop", "… Official Store", "Shop mỹ phẩm …". Thấy tên như vậy trong danh sách thì NÓI RA, kèm số liệu của họ, và nói rõ đây là PHÁN ĐOÁN TỪ TÊN TÀI KHOẢN chứ không phải cờ trong dữ liệu (dữ liệu vẫn xếp họ là nhà sáng tạo độc lập). Đề nghị người bán tự xác nhận trước khi loại — đừng tự quyết thay họ.
   - Thấy ai đó yếu ở một mặt thì ĐỀ XUẤT NGƯỜI THAY cụ thể, kèm số, chứ đừng hỏi chung chung.
   - Lời khuyên triển khai mà dữ liệu không chứng minh được (cách cấu trúc thanh toán, chia mấy đợt, nên thương lượng gì, rủi ro cần hỏi trước khi ký) — cứ nói, nhưng nói rõ đây là kinh nghiệm chứ không phải số liệu, và không được gắn số tiền tự nghĩ vào.
5. Kết bằng một câu mời đào sâu, gợi đúng việc bạn làm được tiếp.

Viết tiếng Việt tự nhiên, câu ngắn, xưng "mình". Được dùng "Được,", "Đã chốt", dấu chấm than, 1-2 emoji. Đừng viết như báo cáo: đừng liệt kê đủ mọi chỉ số chỉ vì có sẵn, hãy nói thứ thay đổi quyết định của người bán.
Bằng chứng mâu thuẫn nhau thì nói rõ mâu thuẫn, không chọn phe. Chưa đủ dữ liệu thì nói "chưa đủ dữ liệu".
Nhận định từ analyze_videos là AI nhìn 4 khung hình, không nghe được tiếng — viết "trong khung hình thấy…", không khẳng định về lời nói.`;

const TITLES: Record<string, (input: Record<string, unknown>) => string> = {
  get_overview: () => "Lấy tổng quan kênh",
  list_products: (i) => (i.product ? `Lấy sản phẩm ${String(i.product)} đã bán` : `Lấy danh sách top ${Number(i.limit) || 10} sản phẩm`),
  category_breakdown: (i) => `Tính cơ cấu doanh thu theo danh mục cấp ${Number(i.level) || 2}`,
  list_videos: (i) => `Lấy danh sách video ${i.product_id ? "gắn sản phẩm" : ""} theo ${i.sort === "revenue" ? "doanh thu" : "lượt xem"}`.replace(/\s+/g, " "),
  get_daily: () => "Lấy doanh thu theo ngày",
  get_peers: () => "So sánh với KOC cùng tầm",
  analyze_videos: (i) => `Xem ${Array.isArray(i.video_ids) && i.video_ids.length ? i.video_ids.length : 3} video (4 khung hình/video)`,
  calc: (i) => `Tính toán (${String(i.op ?? "")})`,
  search_creators: (i) =>
    `Tìm KOC${i.product ? ` bán ${String(i.product)}` : ""}${i.q ? ` tên '${String(i.q)}'` : ""}${
      i.min_revenue ? ` doanh thu ≥ ${Math.round(Number(i.min_revenue) / 1e6).toLocaleString("vi-VN")} triệu` : ""
    }${i.mcn === "no" ? " chưa ký MCN" : i.mcn === "yes" ? " đã ký MCN" : ""}`.replace(/\s+/g, " "),
  list_campaigns: () => "Lấy danh sách chiến dịch",
  campaign_context: () => "Đọc chiến dịch: tiêu chí, điểm, ngân sách",
  allocate_budget: (i) => `Tính phương án chia ngân sách${Number(i.total) ? ` ${Math.round(Number(i.total) / 1e6).toLocaleString("vi-VN")} triệu` : ""}`,
  exclude_koc: (i) => `Bỏ ${Array.isArray(i.creator_ids) ? i.creator_ids.length : 1} KOC & chọn người thay thế`,
  update_criteria: (i) =>
    `Sửa tiêu chí (${[Number(i.koc_count) ? `${Number(i.koc_count)} KOC` : "", Number(i.budget_total) ? `ngân sách ${Math.round(Number(i.budget_total) / 1e6).toLocaleString("vi-VN")} triệu` : "", Number(i.budget_max_per_koc) ? "trần mỗi KOC" : "", Number(i.budget_min_per_koc) ? "sàn mỗi KOC" : ""].filter(Boolean).join(", ") || "—"}) & chọn lại`,
  deepen_koc: () => "Xem video của KOC được chỉ định & chấm lại",
  WebSearch: (i) => `Tìm kiếm trên web: ${String(i.query ?? "")}`,
  WebFetch: (i) => `Đọc trang web: ${String(i.url ?? "").replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}`,
};

/** Kết quả WebSearch của CLI: `Links: [{"title","url"}…]` rồi phần tóm tắt. */
function webLinks(text: string): { title: string; url: string }[] {
  const m = /Links:\s*(\[[\s\S]*?\])\s*(\n|$)/.exec(text);
  if (m)
    try {
      return (JSON.parse(m[1]) as { title?: string; url?: string }[]).filter((l) => l.url).map((l) => ({ title: String(l.title ?? l.url), url: String(l.url) }));
    } catch {
      /* rơi xuống dò URL trần */
    }
  return [...new Set(text.match(/https?:\/\/[^\s"')\]]+/g) ?? [])].map((url) => ({ title: url, url }));
}
const KIND: Record<string, StepKind> = { get_peers: "peers", list_videos: "videos", analyze_videos: "videos", deepen_koc: "videos", exclude_koc: "conclusion", update_criteria: "conclusion" };
/** Công cụ có hàng vẽ được thành bảng. */
const TABLE_TOOLS = new Set(["list_products", "category_breakdown", "list_videos", "get_peers", "analyze_videos", "campaign_context", "allocate_budget", "exclude_koc", "update_criteria", "deepen_koc"]);

/** Dòng tóm tắt ngắn cho thẻ: lấy câu đầu của summary. */
const shortDetail = (summary: string) => {
  const s = summary.split(/(?<=[.;])\s/)[0] ?? summary;
  return s.length > 180 ? `${s.slice(0, 177)}…` : s;
};

interface SessionEvidence {
  _id: string;
  key: string;
  claim: string;
  rows?: Record<string, unknown>[];
  numbers?: Record<string, number>;
}

/** Những gì agent đọc được trên web trong phiên — căn cứ để biết link nào có thật. */
interface WebCorpus {
  urls: Set<string>;
  text: string;
}

const normUrl = (u: string) => u.trim().replace(/^https?:\/\/(www\.)?/, "").replace(/[/#?]+$/, "").toLowerCase();
const TIKTOK_LINK = /\[([^\]]*)\]\(https?:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9_.]+)\/?\)/g;

/**
 * Link TikTok là đường rò riêng: prompt bảo model tự viết `[Tên](https://tiktok.com/@handle)`, nên
 * nó bịa handle nghe rất thật nếu công cụ không đưa handle ra. Đã gặp: 5/5 handle trong một câu trả
 * lời không tồn tại trong DB, trong khi 128 con số đều đúng. Handle không nằm trong kết quả công cụ
 * của phiên thì **gỡ link**, giữ lại chữ — thà mất một đường dẫn còn hơn dẫn người bán tới nhầm kênh.
 */
function checkTikTokLinks(markdown: string, rows: Record<string, unknown>[][]): { markdown: string; bad: string[] } {
  // Handle trong DB có chỗ kèm "@", có chỗ không — chuẩn hoá trước khi so, nếu không sẽ gỡ nhầm cả link đúng
  const known = new Set(
    rows
      .flat()
      .map((r) => String(r.handle ?? "").replace(/^@/, "").toLowerCase())
      .filter(Boolean),
  );
  const bad: string[] = [];
  const out = markdown.replace(TIKTOK_LINK, (whole, label: string, handle: string) => {
    if (known.has(handle.toLowerCase())) return whole;
    bad.push(`@${handle}`);
    return label;
  });
  return { markdown: out, bad: [...new Set(bad)] };
}

/** Link markdown trỏ ra ngoài mà model bịa (không nằm trong kết quả WebSearch/WebFetch của phiên). */
function unknownLinks(markdown: string, web: WebCorpus): string[] {
  const known = new Set([...web.urls].map(normUrl));
  const urls = [...markdown.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
  return [...new Set(urls.filter((u) => !/^(www\.)?tiktok\.com\/@/i.test(normUrl(u)) && !known.has(normUrl(u))))];
}

/**
 * Tên KOC cho tiêu đề thẻ bước. Bản đồ `names` chỉ có những KOC được tag sẵn trong câu hỏi; KOC do
 * agent TỰ TÌM bằng `search_creators` không nằm trong đó, nên trước đây hai thẻ "Lấy danh sách top
 * 10 sản phẩm" liền nhau trông y hệt và không biết đang đọc của ai. Tra DB rồi nhớ lại trong map.
 */
async function nameOf(db: Db, creatorId: string, names?: Map<string, string>): Promise<string | undefined> {
  const known = names?.get(creatorId);
  if (known) return known;
  const c = await db.collection(C.creators).findOne({ _id: creatorId as never }, { projection: { nickname: 1, handle: 1 } });
  const name = c ? String(c.nickname || c.handle || creatorId) : undefined;
  if (name) names?.set(creatorId, name);
  return name;
}

const historyText = (messages: ChatMessage[]) =>
  messages
    .slice(-HISTORY_TURNS)
    .map((m) => `${m.role === "user" ? "Người bán" : "Bạn"}: ${m.text}`)
    .join("\n");

/** Chat ở trang hồ sơ KOC: agent chỉ đọc được đúng KOC này. */
export async function* analyseCreatorAgent(creatorId: string, text: string, threadId?: string): AsyncGenerator<AskEvent> {
  const db = await getDb();
  const creator = await db.collection(C.creators).findOne({ _id: creatorId as never }, { projection: { nickname: 1, handle: 1 } });
  if (!creator) {
    yield { type: "error", message: "Không tìm thấy KOC" };
    return;
  }
  const chat = threadId ? await db.collection(C.creatorChats).findOne({ _id: threadId as never }) : null;
  const history = historyText((chat?.messages as ChatMessage[]) ?? []);
  yield* runAgent({
    system: INTRO_KOC + RULES,
    prompt: [`KOC: ${String(creator.nickname ?? "")} (${String(creator.handle ?? "")}).`, history ? `Hội thoại trước đó:\n${history}` : "", `Câu hỏi của người bán: ${text}`],
    env: { KOC_CREATOR: creatorId },
    purpose: "koc-agent",
  });
}

/**
 * **Trợ lý Tola** — lối vào thống nhất. Dùng được ở mọi nơi: màn `/tola`, trang hồ sơ KOC (ô chat
 * điền sẵn `@handle`), và về sau là cả chat chiến dịch.
 *
 * Khác hai hàm trên ở chỗ **không khoá phạm vi dữ liệu**: `KOC_CREATORS` chỉ truyền các KOC được tag
 * để làm mặc định khi agent gọi công cụ không kèm `creator_id`; agent vẫn tự tìm được người khác
 * bằng `search_creators`.
 */
export async function* askTola(opts: {
  text: string;
  /** Lịch sử hội thoại của luồng này. */
  history?: ChatMessage[];
  /** KOC được tag trong câu (đã giải nghĩa ở `lib/mentions.ts`). */
  mentioned?: { creator_id: string; name: string }[];
  /** Khối ngữ cảnh do `mentionContext()` dựng. */
  context?: string;
  /** Khi câu hỏi gắn với một chiến dịch cụ thể. */
  campaignId?: string;
}): AsyncGenerator<AskEvent> {
  const h = historyText(opts.history ?? []);
  yield* runAgent({
    system: INTRO_TOLA + RULES,
    prompt: [opts.context ?? "", h ? `Hội thoại trước đó:\n${h}` : "", `Câu hỏi của người bán: ${opts.text}`],
    env: {
      ...(opts.mentioned?.length ? { KOC_CREATORS: opts.mentioned.map((m) => m.creator_id).join(",") } : {}),
      ...(opts.campaignId ? { KOC_CAMPAIGN: opts.campaignId } : {}),
    },
    purpose: "tola",
    names: new Map((opts.mentioned ?? []).map((m) => [m.creator_id, m.name])),
  });
}

async function* runAgent(opts: {
  system: string;
  prompt: string[];
  /** Phạm vi đọc dữ liệu của MCP server (KOC_CREATOR | KOC_CREATORS + KOC_CAMPAIGN). */
  env: Record<string, string>;
  purpose: string;
  /** id → tên KOC, để tiêu đề thẻ ghi rõ đang đọc dữ liệu của ai (chat chiến dịch). */
  names?: Map<string, string>;
}): AsyncGenerator<AskEvent> {
  const db = await getDb();
  const session = randomUUID().slice(0, 12);

  yield { type: "plan", steps: [], agent: true };
  let n = 0;
  const stepOf = new Map<string, number>(); // tool_use_id → chỉ số bước
  const web: WebCorpus = { urls: new Set(), text: "" };
  const pendingFetch = new Map<string, string[]>(); // tool_use_id của WebFetch → URL đã đọc
  let final: { text: string; cost_usd: number } | null = null;
  try {
    for await (const ev of claudeAgent({
      system: opts.system,
      prompt: opts.prompt.filter(Boolean).join("\n\n"),
      mcp: { name: "koc", script: "scripts/koc-mcp.ts", env: { KOC_SESSION: session, ...opts.env } },
      model: "sonnet",
      purpose: opts.purpose,
      builtinTools: WEB_TOOLS,
    })) {
      if (ev.type === "tool_use") {
        const index = n++;
        stepOf.set(ev.id, index);
        // URL trang agent tự đọc cũng là nguồn hợp lệ (kết quả WebFetch không lặp lại URL)
        if (ev.name === "WebFetch" && typeof ev.input.url === "string") pendingFetch.set(ev.id, [ev.input.url]);
        const who = typeof ev.input.creator_id === "string" ? await nameOf(db, ev.input.creator_id, opts.names) : undefined;
        yield { type: "step_add", title: `${(TITLES[ev.name] ?? (() => ev.name))(ev.input)}${who ? ` · ${who}` : ""}`, kind: KIND[ev.name] ?? "data" };
        yield { type: "step_start", index };
      } else if (ev.type === "tool_result") {
        const index = stepOf.get(ev.id);
        if (index === undefined) continue;
        if (WEB_TOOLS.includes(ev.name)) {
          // Web: không phải evidence Kalodata — giữ chữ + link để kiểm các ý trích web_urls
          web.text += `\n${ev.text}`;
          const links = ev.name === "WebSearch" ? webLinks(ev.text) : [];
          for (const l of links) web.urls.add(l.url);
          for (const u of ev.text.match(/https?:\/\/[^\s"')\]]+/g) ?? []) web.urls.add(u);
          for (const u of pendingFetch.get(ev.id) ?? []) web.urls.add(u);
          yield {
            type: "step_done",
            index,
            detail: ev.is_error ? "Không đọc được" : ev.name === "WebSearch" ? `${links.length} kết quả` : "Đã đọc trang",
            payload: links.length ? { web: links.slice(0, 8) } : undefined,
          };
          continue;
        }
        const evidenceId = /^evidence_id: (\S+)/.exec(ev.text)?.[1];
        const summary = ev.text.split("\n")[1] ?? "";
        // `evidence_id` đi kèm bước để chip nguồn dưới mỗi câu trỏ được về đúng thẻ này
        const payload: StepPayload | undefined = evidenceId ? { evidence_id: evidenceId } : undefined;
        if (payload && TABLE_TOOLS.has(ev.name)) {
          const doc = await db.collection(C.evidence).findOne({ _id: evidenceId as never }, { projection: { rows: 1 } });
          const rows = (doc?.rows as Record<string, unknown>[]) ?? [];
          if (rows.length) payload.table = { tool: ev.name, rows: rows.slice(0, 10) } satisfies ToolTable;
        }
        yield { type: "step_done", index, detail: ev.is_error ? ev.text.replace(/^Lỗi: /, "Lỗi: ").slice(0, 180) : shortDetail(summary), payload };
      } else if (ev.type === "done") final = { text: ev.result.text, cost_usd: ev.result.cost_usd };
    }
  } catch (err) {
    console.error("[koc-agent] lỗi", err);
    yield { type: "error", message: "Mình gặp lỗi khi phân tích — bạn thử lại giúp mình nhé." };
    yield { type: "done", cost_usd: 0 };
    return;
  }

  // ── Kiểm chứng câu trả lời theo evidence của phiên ──
  const conclusionIdx = n;
  yield { type: "step_add", title: "Kiểm chứng số liệu & viết câu trả lời", kind: "conclusion" };
  yield { type: "step_start", index: conclusionIdx };
  const docs = (await db
    .collection(C.evidence)
    .find({ session_id: session }, { projection: { key: 1, claim: 1, rows: 1, numbers: 1, cost_usd: 1 } })
    .toArray()) as unknown as (SessionEvidence & { cost_usd?: number })[];
  const evidence = new Map(docs.map((d) => [String(d._id), d]));
  // Tiền AI xem video tiêu bên trong công cụ (MCP server), không nằm trong chi phí của agent
  const toolCost = docs.reduce((a, d) => a + (d.cost_usd ?? 0), 0);
  const parsed = parseAnswer(final?.text ?? "");
  const { title, follow_ups } = parsed;
  const kept = follow_ups.filter((q) => !asksAboutVoice(q)).slice(0, 3);
  const links = checkTikTokLinks(
    parsed.markdown,
    docs.map((d) => d.rows ?? []),
  );
  const markdown = links.markdown;
  if (links.bad.length) console.warn("[koc-agent] gỡ link TikTok có handle không nằm trong dữ liệu:", links.bad.join(", "));

  // Kiểm ĐẦU RA thay vì trói đầu vào (xem lib/answer-verify.ts): model viết markdown tự do, code
  // đối chiếu mọi con số với kho số của phiên. Số không có nguồn không bị xoá — bị đánh dấu, vì
  // xoá một câu trong markdown làm vỡ bảng, và người bán cần thấy chỗ nào đáng ngờ hơn là thấy
  // một khoảng trống không giải thích.
  const pool = docs.map((d) => ({ claim: d.claim, numbers: d.numbers }));
  const { unverified, checked } = verifyAnswer(markdown, pool);
  const cited = citationsIn(markdown).filter((id) => evidence.has(id));
  if (!markdown.trim())
    console.warn(`[koc-agent] model trả ${(final?.text ?? "").length} ký tự nhưng không rút được markdown. Đầu câu trả lời:`, (final?.text ?? "").slice(0, 400));
  if (unverified.length) console.warn(`[koc-agent] ${unverified.length}/${checked} số không đối chiếu được:`, unverified.map((u) => u.text).join(", "));
  const badLinks = unknownLinks(markdown, web);
  if (badLinks.length) console.warn("[koc-agent] link không có trong kết quả tìm kiếm của phiên:", badLinks.join(", "));

  yield {
    type: "step_done",
    index: conclusionIdx,
    detail: `${evidence.size} kết quả công cụ · ${cited.length} nguồn được trích · đối chiếu ${checked} con số${unverified.length ? ` · ${unverified.length} số KHÔNG có nguồn` : " · tất cả đều có nguồn"}`,
  };
  yield {
    type: "conclusion",
    text: title || "Trả lời câu hỏi về KOC",
    reasons: [],
    markdown: markdown || "Mình chưa trả lời được câu này từ dữ liệu hiện có.",
    unverified: unverified.map((u) => u.text),
    follow_ups: kept,
  };
  yield { type: "done", cost_usd: (final?.cost_usd ?? 0) + toolCost };
}

/**
 * Rút `<!--title: …-->`, phần markdown và `<!--follow-ups … -->` ra khỏi câu trả lời.
 * Dùng chú thích HTML thay vì JSON vì markdown nhiều dòng nhét trong chuỗi JSON rất hay vỡ
 * (đã gặp: model trả 1.809 token mà parse ra rỗng), còn chú thích thì sai cũng chỉ mất phần bọc.
 */
export function parseAnswer(raw: string): { title: string; markdown: string; follow_ups: string[] } {
  const text = raw.replace(/^\s*```(?:markdown|md)?\s*\n?|\n?```\s*$/g, "");
  const title = /<!--\s*title:\s*([\s\S]*?)-->/i.exec(text)?.[1]?.trim().slice(0, 200) ?? "";
  const fu = /<!--\s*follow-ups?\s*([\s\S]*?)-->/i.exec(text);
  const follow_ups = (fu?.[1] ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*[-*\d.)\s]+/, "").trim())
    .filter((l) => l.length > 8)
    .map((l) => l.slice(0, 120));
  const markdown = text
    .replace(/<!--\s*title:[\s\S]*?-->/i, "")
    .replace(/<!--\s*follow-ups?[\s\S]*?-->/i, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  return { title, markdown, follow_ups };
}
