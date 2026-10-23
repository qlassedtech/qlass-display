// Google Business Profile reviews: read the ones still unanswered, and post a reply.
//
// NOT YET LIVE. The Business Profile APIs are access-gated — Google requires a separate
// application per Cloud project before the endpoints respond at all — and this project has no
// Google credentials yet. Everything below is written against the documented v4 shape so the
// daily digest can pick it up the moment access lands; until then isConfigured() is false and the
// digest reports the section as unavailable rather than quietly showing an empty list.
//
// docs/api-access-requests.md has the application text and the console steps.
//
// Posting a reply is deliberately kept as an explicit call that nothing schedules. A reply goes
// out publicly under the school's name, and the worst case — a generated answer to an angry
// parent — is exactly the case where a human has to have read it first.

const ACCOUNT_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const REVIEW_API = "https://mybusiness.googleapis.com/v4";

const env = (k) => process.env[k] || "";

export function isConfigured() {
  return Boolean(env("GBP_CLIENT_ID") && env("GBP_CLIENT_SECRET") && env("GBP_REFRESH_TOKEN") && env("GBP_LOCATION"));
}

export function whyNotConfigured() {
  const missing = ["GBP_CLIENT_ID", "GBP_CLIENT_SECRET", "GBP_REFRESH_TOKEN", "GBP_LOCATION"].filter((k) => !env(k));
  if (!missing.length) return "";
  return `Google Business Profile not connected (missing ${missing.join(", ")}). ` +
         `The Business Profile APIs also need access approval from Google before they respond.`;
}

// Access tokens last an hour; the refresh token is the long-lived half and is the thing the OAuth
// consent flow produces once.
let cached = { token: "", expires: 0 };
async function accessToken() {
  if (cached.token && cached.expires > Date.now() + 60_000) return cached.token;
  const body = new URLSearchParams({
    client_id: env("GBP_CLIENT_ID"),
    client_secret: env("GBP_CLIENT_SECRET"),
    refresh_token: env("GBP_REFRESH_TOKEN"),
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Google token refresh failed: ${j.error_description || j.error || r.status}`);
  cached = { token: j.access_token, expires: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return cached.token;
}

async function api(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    // 403 here usually means the APIs are enabled on the project but access was never granted,
    // which is a different fix from a bad token — worth saying so rather than "forbidden".
    const hint = r.status === 403
      ? " (the Business Profile APIs may be enabled but not yet approved for this project)" : "";
    throw new Error(`Google API ${r.status}: ${(j.error && j.error.message) || "request failed"}${hint}`);
  }
  return j;
}

/** Locations the authenticated account can manage — used to find GBP_LOCATION the first time. */
export async function locations() {
  const accounts = await api(`${ACCOUNT_API}/accounts`);
  const out = [];
  for (const a of accounts.accounts || []) {
    const locs = await api(`${ACCOUNT_API}/${a.name}/locations?readMask=name,title,storefrontAddress`);
    for (const l of locs.locations || []) out.push({ account: a.name, name: l.name, title: l.title });
  }
  return out;
}

/** Reviews with no owner reply yet, newest first. */
export async function unansweredReviews({ limit = 20 } = {}) {
  const loc = env("GBP_LOCATION");            // expects "accounts/{id}/locations/{id}"
  const j = await api(`${REVIEW_API}/${loc}/reviews?orderBy=updateTime desc&pageSize=${limit}`);
  const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return (j.reviews || [])
    .filter((r) => !r.reviewReply)
    .map((r) => ({
      id: r.reviewId,
      name: r.name,
      author: (r.reviewer && r.reviewer.displayName) || "A customer",
      rating: STARS[r.starRating] || 0,
      text: r.comment || "",
      at: r.createTime,
    }));
}

/** Posts a reply. Nothing calls this on a schedule — a person sends it. */
export async function reply(reviewName, text) {
  if (!text || !text.trim()) throw new Error("reply text is empty");
  const r = await fetch(`${REVIEW_API}/${reviewName}/reply`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ comment: text.trim() }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google reply failed ${r.status}: ${(j.error && j.error.message) || ""}`);
  return j;
}
