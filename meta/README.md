# Meta integration (Instagram + ad account)

Talks to the **Instagram Graph API** and **Marketing API** directly over `fetch` — no SDK. Three pieces:

- [`graph.js`](graph.js) — tiny Graph API client (`get`, `post`, `getAll` for pagination).
- [`ads.js`](ads.js) — ad account status, per-campaign spend, pause/resume, leads from lead forms.
- [`instagram.js`](instagram.js) — profile, posts/reels with likes & comments, per-post insights (views, reach, saves, shares), publishing.
- [`snapshot.js`](snapshot.js) — takes a daily snapshot of the above and stores it under `data/meta/snapshots/YYYY-MM-DD.json`, so day-over-day and week-over-week change (views, likes, comments, followers) can be reported. The server takes one automatically each evening; `/admin → Instagram & Ads` shows the report and lets you pause ad spend in one click.

All three are plain Node scripts — run them directly (`node meta/ads.js status`) or import their functions elsewhere.

## 1. Set up a Meta app (one-time)

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create App** → type **Business**.
2. Add the **Instagram Graph API** and **Marketing API** products from the left sidebar.
3. The Instagram account must be a **Professional (Business or Creator) account** linked to a **Facebook Page** you admin. Qlass's Page is "Qlass Learning" — check Instagram → Settings → Account type, and Settings → Linked accounts.
4. Note the ad account ID from [Billing & payments](https://business.facebook.com/billing_hub) or Ads Manager's URL (`act=...`). Qlass's is `4362790727384695`.

## 2. Get a token with the right permissions

Easiest path — **Graph API Explorer**:

1. Open [developers.facebook.com/tools/explorer](https://developers.facebook.com/tools/explorer), pick your app.
2. Click **Generate Access Token**, and check these permissions:
   - `ads_management` and `ads_read` — campaign status, spend, pause/resume
   - `instagram_basic`, `instagram_manage_insights` — profile, posts, view/like/comment counts, follower trend
   - `pages_show_list`, `pages_read_engagement` — find the Page → Instagram account link
   - `leads_retrieval` — only if you want `meta/ads.js leads` (lead-form submissions)
   - `instagram_content_publish` — only if you want `meta/instagram.js publish-image` / `publish-reel`
3. Copy the token into `.env` as `META_ACCESS_TOKEN`.

This token is a **short-lived user token (≈1 hour)**. For anything beyond quick testing, exchange it for a 60-day token:

```bash
node meta/ads.js token-exchange "<paste short-lived token>"
# prints META_ACCESS_TOKEN=... — put that in .env
```

(Needs `META_APP_ID` and `META_APP_SECRET` in `.env` — Settings → Basic in the Meta App dashboard.) A 60-day token still expires, so for the server's automatic daily snapshot, plan to refresh it roughly every two months (`node meta/ads.js token` shows the expiry), or set it up as a **System User token** in Business Settings, which doesn't expire.

## 3. Find your IDs

```bash
node meta/instagram.js discover
```

Lists every Page the token can manage and the Instagram account linked to it. Copy the suggested `META_PAGE_ID` and `META_IG_USER_ID` lines into `.env`. Add `META_AD_ACCOUNT_ID` yourself (the numeric ID, with or without the `act_` prefix — both work).

## 4. Try it

```bash
node meta/ads.js status              # account balance + every campaign's status, budget, spend
node meta/ads.js spend 7             # day-by-day spend per campaign, last 7 days
node meta/ads.js pause-all           # pause every ACTIVE campaign
node meta/ads.js pause <campaign id> # pause just one
node meta/ads.js leads 30            # leads from lead-form ads, last 30 days

node meta/instagram.js profile       # followers, following, post count
node meta/instagram.js media 20      # latest 20 posts/reels with likes & comments
node meta/instagram.js insights <media id>   # views, reach, saves, shares for one post
node meta/instagram.js followers 30  # daily follower count, last 30 days

node meta/snapshot.js take           # record today's numbers now (the server also does this nightly)
node meta/snapshot.js report 7       # followers + per-video Δ over the last 7 days, as text
```

Once `META_ACCESS_TOKEN` (+ IDs) are in `.env` and the server is restarted, the same data is in `/admin → Instagram & Ads`: a table of every post/reel with its day-over-day and week-over-week change in views/likes/comments, the follower trend, and every ad campaign with one-click pause/resume. `GET /api/meta/report?days=7` and `GET /api/meta/ads` return the same data as JSON if you want to pull it into something else (a spreadsheet, a Slack bot, etc).

## Notes

- **Spend here is what Meta billed**, which includes 18% GST — matches what you see in Billing & payments, not just the ad budget.
- **Insight metric names change between API versions** (`impressions` was replaced by `views` for most placements in 2024–25). `instagram.js` tries a few metric sets per media type and falls back gracefully; if Meta changes them again, `mediaInsights()` is the one place to update.
- **Rate limits**: the snapshot script makes one insights call per post, so a very large media library could be throttled. `snapshot.take({ mediaLimit })` caps how many recent posts it checks (default 60).
- **Nothing here auto-creates or auto-boosts ads.** `pause-all` / `pause` / `resume` only change `status` on existing campaigns — see [server.js](../server.js)'s `/api/meta/ads/*` routes and the admin tab's "Pause all campaigns" button.
