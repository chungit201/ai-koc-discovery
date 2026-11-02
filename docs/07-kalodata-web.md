# Kalodata Web Crawl (logged-in session)

Second data source next to the Open API ([03-kalodata.md](03-kalodata.md)): the same endpoints the Kalodata web app uses, called from inside a logged-in browser page with the DETOLA account (plan **Premium**, valid until 2027-08-04).

## Why

| | Open API (`npm run crawl`) | Web (`npm run crawl:web`) |
|---|---|---|
| Cost | Credits (~0.1 USD / 10 calls) | Included in the subscription |
| **Follower gender / age** | ❌ not available | ✅ `followerSex`, `followerAgeMax` per KOC, and **list filters** by audience |
| Engagement rate | Only a LOW/MEDIUM/HIGH filter | ✅ `video_engagement_rate` value |
| MCN, debut date | ❌ | ✅ `mcn_name`, `creatorDebut` |
| Numbers | Exact | **Display-rounded** ("₫1,75tỉ" ≈ 3 sig. digits); exact per-day values in `history/total` |
| Stability | Documented, versioned | Undocumented, may change without notice |
| Quota | Credits | `DETAIL.ACCESS_TIMES` = **1,999 detail views / day** |

## Rules of use

- Real login with the DETOLA account; captcha/OTP (if any) is completed by a person, never bypassed.
- One request at a time, ≥ 1.2 s apart (~50/min) — normal interactive pace.
- Everything is cached in `raw_responses` (`endpoint: "web:<path>"`) → re-runs do not hit Kalodata again.
- Session cookies live in `.auth/kalodata.json` (gitignored). Expired → `npm run kalo:login`.
- Risk: Kalodata ToS may disallow automation; the account could be restricted. Keep volume moderate.

## ⚠ Incident 2026-11-01 — account locked

During the full cosmetics list crawl (run `96985620`, ~85 list pages after ~500 requests earlier that day, 1 request / 1.2 s), Kalodata returned:

> "We have detected that your account had highly suspected behaviors. For your account safety, we have locked your account."

- Crawl stopped by hand; the old client kept sending requests after the first lock message (~10 more). **Fixed:** a lock message now halts the client and aborts the run (`kind: "locked"`, never retried).
- Data kept: 4,300 cosmetics list rows + earlier sunscreen runs (60 KOC fully detailed).
- **Do not resume web crawling** until DETOLA/Kalodata support restores the account and confirms what usage is acceptable. Use the Open API (API key, credits) for further crawling.

### Changes after the incident

- **Dedicated crawler account** (`KALODATA_WEB_USERNAME/PASSWORD`, session `.auth/kalodata-crawler.json`), so the main account can be used in a browser without logging the crawler out (Kalodata allows one session per account). One crawler account only — no account rotation; if it gets a lock warning the crawl stops for good.
- **Pace:** ≥ 5 s between requests (≤ 12/min), max 300/hour, max 1,200/day — counted from `api_calls`, so caps hold across runs. Daily cap → run stops cleanly and resumes next day with `--resume`.
- Lock / session / daily-cap errors abort the run immediately instead of continuing with the next item.

## Commands

```bash
npm run kalo:login                      # opens a browser, logs in, saves .auth/kalodata.json
npm run crawl:web -- --pages 1 --top 30 # new run
npm run crawl:web -- --resume <runId>   # continue an interrupted run
npm run kalo:discover -- <url> ...      # record the JSON calls a page makes → .auth/network/calls.json
npm run kalo:call -- <path> '<json>'    # call one endpoint, print JSON
```

## Endpoints used (all `POST`, JSON, session cookie)

| Stage | Path | Key fields |
|---|---|---|
| list | `/creator/queryList` · `/creator/count` | `id, handle, nickname, signature, followers, revenue, sale, unit_price, views, new_followers, video_engagement_rate, revenue_trend[30], views_trend[30], creatorDebut, main_category` |
| detail | `/creator/detail/access` → `/creator/detail` | `followerSex, followerAgeMax, creator_type, mcn_name, has_mcn, shop_name, product_count, contacts (email/zalo/…)` — counts toward ACCESS_TIMES |
| totals | `/creator/detail/total` | `revenue, sale, unit_price, video_revenue, live_revenue, shop_revenue, video_views, live_views` (range totals, display-rounded) |
| totals | `/creator/detail/history/total` | per-day `revenue, sale, video_revenue, live_revenue, shop_revenue` (exact floats) |
| products | `/creator/detail/searchProducts` | `id, product_title, revenue, sale, unit_price, seller_id` |
| videos | `/creator/detail/video/queryList` | `id, description, create_time, duration, original_duration, product_ids, views, revenue, sale, gpm, ad, ai_video, ad_cpa, ad2Cost, ad2Roas` |

Common body: `{ id, startDate, endDate, cateIds, sellerId: "", authority: true }`, list adds `pageNo, pageSize, sort`.

### List filters (body keys)

| Key | Values |
|---|---|
| `creator.filter.follower_gender` | `"1"` Majority Male (50%+) · `"2"` Majority Female (50%+) |
| `creator.filter.follower_age` | `"18-24"`, `"25-34"`, `"35-44"`, … (age group with the highest share) |
| `creator.filter.creator_type` | `INDEPENDENT` · `BELONGED_TO_SELLER` |
| `creator.filter.followers` | `"<50000"`, `"50000-500000"`, custom `"10000-1000000"` |
| `creator.filter.video_engagement_rate` | `"0-8"`, `"8-20"`, `">20"` |
| `creator.filter.mcn_status` | `SIGNED` · `NOT_SIGNED` |
| `creator.filter.unit_price`, `creator.filter.revenue` | ranges |
| `creator.filter.creator_content` | `ZALO`, `EMAIL`, `WHATSAPP`, … (has contact) |

Measured on 2026-11-01 (VN, sunscreen face `601602`, last 30 days): 15,360 creators → female-majority 2,843 → + age 18–24 + independent **666**.

## Impact on the anti-hallucination rules

`audience.gender_majority` / `audience.age_majority` now come from **Kalodata data**, not AI. They are still only the *majority bucket* (no distribution), so the report shows them as "Kalodata: đa số nữ, nhóm tuổi lớn nhất 25–34" and cites the raw response as evidence. AI estimation is only needed for finer detail (e.g. share within 18–30).
