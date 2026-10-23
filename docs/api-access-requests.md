# API access needed for automated review replies

The daily digest (`jobs/daily-digest.mjs`) already drafts replies for anything it can reach.
Instagram comments work today. Google reviews and Facebook reviews do not, and neither can be
fixed from this repo — both need an approval that only an account owner can request.

This file is the shortest path through both.

---

## Where the reviews actually are

Checked 23 Oct 2026:

| Channel | Volume | Status |
|---|---|---|
| **Google Business Profile** | **55 reviews, 4.8★** | 54 replied, 1 unreplied. The real channel. |
| Instagram | 579 followers, ~10 comments on recent posts | Reachable now via the existing Meta token. |
| Facebook Page | 14 followers | Effectively dormant. Not worth an App Review submission. |

**Read this before starting.** Google is where the reviews are, but the profile is already
answered to within one review, and new ones arrive every few days — not daily. The honest
question is whether API access is worth the approval effort when replying by hand in the Business
Profile UI takes about a minute per review. The digest's value is making sure a new review is
noticed the next morning; posting it automatically saves very little beyond that.

If you want the automation anyway, the steps follow.

---

## 1. Google Business Profile API

Needed for: reading reviews and posting replies from `gbp/reviews.js`.

The Business Profile APIs are **access-gated**. Enabling them in a Cloud project is not enough —
Google must approve the project first, and until it does the endpoints return 403 no matter how
correct the OAuth setup is.

### Step 1 — Cloud project

1. <https://console.cloud.google.com/> → create a project (e.g. `qlass-display`).
2. APIs & Services → Library → enable:
   - Google My Business Account Management API
   - Google My Business Business Information API
   - My Business Q&A API *(optional)*

The reviews endpoint itself (`mybusiness.googleapis.com/v4`) has no Library entry; it becomes
available once the access request below is granted.

### Step 2 — Request access

Form: <https://developers.google.com/my-business/content/prereqs> → "Request access to the API".

You need the Cloud project number, the Google account that manages the listing, and a description
of use. Suggested wording:

> Qlass Learning is a coaching institute in Khagaul, Patna, managing a single Business Profile
> with 55 reviews. We are building an internal tool that collects new reviews each morning and
> prepares a draft reply for a staff member to review and send. The tool reads reviews and posts
> replies only after a person has approved the text; it does not post automatically, does not
> manage listings for third parties, and is used solely for our own single location.

Turnaround is typically a few days to a few weeks.

### Step 3 — OAuth credentials

1. APIs & Services → OAuth consent screen → External, add the managing Google account as a test user.
2. Credentials → Create credentials → OAuth client ID → **Desktop app**.
3. Note the client ID and secret.

### Step 4 — Refresh token

Scope: `https://www.googleapis.com/auth/business.manage`

Sign in as the account that manages the listing, approve, exchange the code for a refresh token.
This is a browser step and has to be done by the owner — it cannot be automated.

### Step 5 — Configure

Add to `~/qlass-display/.env` on the server, then restart:

```
GBP_CLIENT_ID=...
GBP_CLIENT_SECRET=...
GBP_REFRESH_TOKEN=...
GBP_LOCATION=accounts/<account-id>/locations/<location-id>
```

`gbp/reviews.js` exports `locations()` to find that last value once the first three are set.
Nothing else needs changing: the digest picks the section up automatically.

---

## 2. Meta permissions (Facebook Page reviews)

Needed only if you want Facebook recommendations as well. **With 14 followers, probably skip this.**

Current token grants:

```
pages_show_list, pages_read_engagement, ads_management, ads_read,
business_management, instagram_basic, instagram_manage_comments,
instagram_manage_insights, instagram_content_publish, leads_retrieval
```

Missing for reviews:

| Permission | Needed for |
|---|---|
| `pages_read_user_content` | reading Page reviews/recommendations |
| `pages_manage_engagement` | replying to them |

Both require **App Review** submission at
<https://developers.facebook.com/apps/> → your app → App Review → Permissions and Features,
with a screencast showing the use and a written justification. Expect one to three weeks, and
expect to resubmit at least once.

---

## What works without any of the above

- **Instagram comments** — read and drafted now; `instagram_manage_comments` is already granted.
- **Google reviews** — the owner is signed in to the Business Profile in Chrome. Replying there
  takes a minute, and the digest tells you when there is something to reply to.
- **The daily digest itself** — runs at 07:00 Asia/Kolkata, writes to `data/digests/`, and can be
  triggered on demand with `POST /api/jobs/digest`.

---

## A note on posting automatically

`gbp/reviews.js` can post a reply, but nothing schedules it, and that is deliberate. Replies go
out publicly under the school's name in front of parents. A generated answer to an angry review is
the single place where a wrong word does lasting damage, and no model is reliable enough there to
run unattended. Draft automatically, send deliberately.
