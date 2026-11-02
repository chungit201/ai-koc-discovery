// Response shapes from docs/kalodata/openapi.json (only fields we rely on; the rest is stored as-is)

export interface CreatorRankRow {
  creator_id: string;
  creator_nickname: string;
  creator_handle: string;
  revenue: number;
  revenue_growth_rate: number;
  content_views: string;
  creator_followers: string;
  sales_volumn: number;
  video_revenue: number;
  live_revenue: number;
  category_list?: string[];
  category_id_list?: string[];
  ter_category_list?: string[];
  ter_category_id_list?: string[];
}

export interface CreatorDetail {
  creator_id: string;
  creator_nickname: string;
  creator_handle: string;
  creator_region: string;
  creator_status: "BELONGED_TO_SELLER" | "INDEPENDENT";
  creator_bio?: string;
  creator_followers: string;
  revenue: number;
  sales_volumn: number;
  unit_price: number;
  video_revenue: number;
  live_revenue: number;
  video_views: number;
  live_views: number;
  video_gpm: number;
  live_gpm: number;
  new_followers: number;
  video_number: number;
  live_number: number;
  shop_number: number;
  product_number: number;
  revenue_trend?: number[];
  top3_product_ids?: string[];
  [extra: string]: unknown;
}

export interface ProductRankRow {
  product_id: string;
  product_name: string;
  revenue: number;
  commission_rate: number;
  sales_volumn: number;
  unit_price: number;
  live_revenue: number;
  video_revenue: number;
  showcase_revenue: number;
  launch_date: string;
  seller_id: string;
  seller_name: string;
  pri_category?: { category_id: string; category_name: string };
  sec_category?: { category_id: string; category_name: string };
  ter_category?: { category_id: string; category_name: string };
  [extra: string]: unknown;
}

export interface VideoRankRow {
  video_id: string;
  video_title: string;
  belonged_creator_id: string;
  belonged_creator_handle: string;
  revenue: number;
  views: number;
  revenue_growth_rate: number;
  ads_roas: number;
  digg_count: number;
  share_count: number;
  comment_count: number;
  ad_revenue_ratio: number;
  ad_view_ratio: number;
  ad: number;
  ai_video: number;
  publish_date: string;
  [extra: string]: unknown;
}

export const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
