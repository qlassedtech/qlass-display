// Minimal Meta Graph API client (Facebook Marketing API + Instagram Graph API).
// No dependencies: uses global fetch (Node 18+).

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const GRAPH_BASE = process.env.META_GRAPH_BASE || `https://graph.facebook.com/${GRAPH_VERSION}`;

export const config = {
  token: process.env.META_ACCESS_TOKEN || "",
  pageToken: process.env.META_PAGE_TOKEN || process.env.META_ACCESS_TOKEN || "",
  adAccountId: normalizeAct(process.env.META_AD_ACCOUNT_ID || ""),
  igUserId: process.env.META_IG_USER_ID || "",
  pageId: process.env.META_PAGE_ID || "",
  appId: process.env.META_APP_ID || "",
  appSecret: process.env.META_APP_SECRET || "",
  timezone: process.env.META_TIMEZONE || "Asia/Kolkata",
};

export function normalizeAct(id) {
  id = String(id || "").trim();
  if (!id) return "";
  return id.startsWith("act_") ? id : `act_${id}`;
}

export function isConfigured() {
  return Boolean(config.token);
}

export class GraphError extends Error {
  constructor(message, { status, code, subcode, type, fbtrace, path } = {}) {
    super(message);
    this.name = "GraphError";
    Object.assign(this, { status, code, subcode, type, fbtrace, path });
  }
}

/**
 * Call the Graph API.
 * graph("GET", "/me", { fields: "id,name" })
 * graph("POST", "/123", { status: "PAUSED" })
 */
export async function graph(method, path, params = {}, { token = config.token, raw = false } = {}) {
  if (!token) throw new GraphError("META_ACCESS_TOKEN is not set. See meta/README.md.", { code: "NO_TOKEN", path });
  const url = new URL(GRAPH_BASE + (path.startsWith("/") ? path : `/${path}`));
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const val = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (method === "GET") url.searchParams.set(k, val); else body.set(k, val);
  }
  if (method === "GET") url.searchParams.set("access_token", token); else body.set("access_token", token);

  const res = await fetch(url, method === "GET" ? { method } : {
    method, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok || json.error) {
    const e = json.error || {};
    throw new GraphError(e.message || `Graph API ${res.status} on ${path}`, {
      status: res.status, code: e.code, subcode: e.error_subcode, type: e.type, fbtrace: e.fbtrace_id, path,
    });
  }
  return raw ? { json, res } : json;
}

export const get = (path, params, opts) => graph("GET", path, params, opts);
export const post = (path, params, opts) => graph("POST", path, params, opts);

/** Follow `paging.next` until done (or `limit` items). */
export async function getAll(path, params = {}, { limit = Infinity, ...opts } = {}) {
  const out = [];
  let page = await get(path, { limit: Math.min(100, limit), ...params }, opts);
  for (;;) {
    out.push(...(page.data || []));
    if (out.length >= limit || !page.paging?.next) break;
    const res = await fetch(page.paging.next);
    page = await res.json();
    if (page.error) throw new GraphError(page.error.message, { code: page.error.code, path });
  }
  return out.slice(0, limit);
}

/** Today's date (YYYY-MM-DD) in the configured timezone. */
export function todayKey(d = new Date(), tz = config.timezone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function money(n, currency = "INR") {
  const v = Number(n || 0);
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
}
