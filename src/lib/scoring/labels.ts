/** S2 exclusion reason codes → user-facing labels. "no_detail" is internal and never shown to users. */
export const EXCLUSION_LABELS: Record<string, string> = {
  no_detail: "Chưa đủ dữ liệu",
  followers_low: "Ít follower hơn yêu cầu",
  followers_high: "Nhiều follower hơn yêu cầu",
  gender: "Khán giả khác giới tính mục tiêu",
  mcn_signed: "Đã ký MCN",
  mcn_unsigned: "Chưa ký MCN",
  over_budget: "Chi phí vượt ngân sách/KOC",
  few_videos: "Ít hơn 3 video trong 30 ngày",
};
