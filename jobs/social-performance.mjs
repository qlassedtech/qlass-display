// Yesterday's Instagram performance, with enough history to say whether it is going up or down.
//
// A single day's numbers mean very little on an account this size — reach swings between 28 and
// 265 on consecutive days with nothing having changed. So every run appends a snapshot to
// data/social-history.json and the report is written against the trailing week, not the day.
//
// Views are broken down by surface because the split is the story here: paid delivery has at
// times been 95% of everything this account reaches. A day where the AD line disappears is not a
// quiet day, it is the ads having stopped, and those two look identical in a single total.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const HISTORY = path.join(ROOT, "data", "social-history.json");
const V = "v21.0";

export function readEnv() {
  const out = { ...process.env };
  try {
    for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
      if (!line.includes("=") || line.trim().startsWith("#")) continue;
      const i = line.indexOf("=");
      const k = line.slice(0, i).trim();
      if (!out[k]) out[k] = line.slice(i + 1).trim();
    }
  } catch {}
  return out;
}

const call = async (url) => {
  const r = await fetch(url);
  const b = await r.json();
  if (b.error) throw new Error(b.error.message || `graph ${r.status}`);
  return b;
};
const unix = (daysAgo) => Math.floor(Date.now() / 1000) - daysAgo * 86400;
const breakdownOf = (metric) => {
  const bd = metric && metric.total_value && metric.total_value.breakdowns;
  const out = {};
  for (const r of (bd && bd[0] && bd[0].results) || []) out[r.dimension_values[0]] = r.value;
  return out;
};

export async function collect(env) {
  const T = env.META_ACCESS_TOKEN, IG = env.META_IG_USER_ID;
  if (!T || !IG) return { available: false, why: "META_ACCESS_TOKEN / META_IG_USER_ID not set" };

  // Yesterday, by surface.
  const bySurface = await call(
    `https://graph.facebook.com/${V}/${IG}/insights?metric=views,reach&metric_type=total_value` +
    `&breakdown=media_product_type&since=${unix(2)}&until=${unix(1)}&period=day&access_token=${T}`);
  const views = breakdownOf((bySurface.data || []).find((m) => m.name === "views"));
  const reach = breakdownOf((bySurface.data || []).find((m) => m.name === "reach"));

  const eng = await call(
    `https://graph.facebook.com/${V}/${IG}/insights?metric=accounts_engaged,total_interactions` +
    `&metric_type=total_value&since=${unix(2)}&until=${unix(1)}&period=day&access_token=${T}`);
  const engaged = (eng.data || []).find((m) => m.name === "accounts_engaged")?.total_value?.value || 0;
  const interactions = (eng.data || []).find((m) => m.name === "total_interactions")?.total_value?.value || 0;

  const series = await call(
    `https://graph.facebook.com/${V}/${IG}/insights?metric=reach&period=day` +
    `&since=${unix(9)}&until=${unix(1)}&access_token=${T}`);
  const daily = ((series.data || [])[0]?.values || []).map((v) => ({ d: v.end_time.slice(0, 10), reach: v.value }));

  const profile = await call(`https://graph.facebook.com/${V}/${IG}?fields=followers_count,media_count&access_token=${T}`);

  // Posts published in the last 24h, with how each did so far.
  const media = await call(
    `https://graph.facebook.com/${V}/${IG}/media?fields=id,caption,media_type,timestamp,permalink&limit=25&access_token=${T}`);
  const since = Date.now() - 36 * 3600 * 1000;
  const fresh = [];
  for (const m of (media.data || []).filter((x) => Date.parse(x.timestamp) >= since)) {
    try {
      const i = await call(`https://graph.facebook.com/${V}/${m.id}/insights?metric=views,reach,total_interactions&access_token=${T}`);
      const pick = (n) => (i.data || []).find((d) => d.name === n)?.values?.[0]?.value || 0;
      fresh.push({ caption: String(m.caption || "").replace(/\s+/g, " ").slice(0, 60), type: m.media_type,
                   views: pick("views"), reach: pick("reach"), interactions: pick("total_interactions"), url: m.permalink });
    } catch {}
  }

  return {
    available: true,
    date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    views, reach, engaged, interactions, daily,
    followers: profile.followers_count, mediaCount: profile.media_count,
    published: fresh,
    totals: {
      views: Object.values(views).reduce((a, b) => a + b, 0),
      reach: Object.values(reach).reduce((a, b) => a + b, 0),
    },
  };
}

/** Appends today's snapshot and returns the trailing history. */
export async function remember(snap) {
  let hist = [];
  try { hist = JSON.parse(await fsp.readFile(HISTORY, "utf8")); } catch {}
  hist = hist.filter((h) => h.date !== snap.date);
  hist.push({ date: snap.date, followers: snap.followers, views: snap.totals.views,
              reach: snap.totals.reach, engaged: snap.engaged, bySurface: snap.views });
  hist.sort((a, b) => a.date.localeCompare(b.date));
  hist = hist.slice(-120);
  await fsp.writeFile(HISTORY, JSON.stringify(hist, null, 2));
  return hist;
}

export function toMarkdown(s, hist) {
  if (!s.available) return [`## Social performance`, `_Unavailable: ${s.why}_`].join("\n");
  const L = [`## Social performance — ${s.date}`, ""];

  const prev = hist.filter((h) => h.date < s.date).slice(-1)[0];
  const week = hist.filter((h) => h.date < s.date).slice(-7);
  const avg = week.length ? Math.round(week.reduce((n, h) => n + h.reach, 0) / week.length) : null;
  const delta = (now, then) => (then == null ? "" : ` (${now - then >= 0 ? "+" : ""}${now - then} vs previous day)`);

  L.push(`**${s.totals.views.toLocaleString()} views · ${s.totals.reach.toLocaleString()} reach · ` +
         `${s.engaged} accounts engaged · ${s.interactions} interactions**`);
  if (avg != null) {
    const dir = s.totals.reach > avg * 1.2 ? "well above" : s.totals.reach < avg * 0.8 ? "below" : "in line with";
    L.push(`Reach is ${dir} the trailing week average of ${avg.toLocaleString()}.`);
  }
  L.push("");

  const SURFACES = ["AD", "REEL", "POST", "STORY", "CAROUSEL_CONTAINER"];
  const label = { AD: "Ads", REEL: "Reels", POST: "Posts", STORY: "Stories", CAROUSEL_CONTAINER: "Carousels" };
  L.push("| Surface | Views | Reach |", "|---|---|---|");
  for (const k of SURFACES) {
    if (!s.views[k] && !s.reach[k]) continue;
    L.push(`| ${label[k]} | ${(s.views[k] || 0).toLocaleString()} | ${(s.reach[k] || 0).toLocaleString()} |`);
  }
  L.push("");

  // The single most consequential thing this report can notice.
  const adYesterday = s.views.AD || 0;
  const adBefore = prev && prev.bySurface ? (prev.bySurface.AD || 0) : null;
  if (!adYesterday && adBefore) {
    L.push(`> **Ads delivered nothing yesterday** (${adBefore.toLocaleString()} views the day before).`,
           `> Paid has been the large majority of this account's reach, so this is worth checking`,
           `> before reading anything else into the numbers.`, "");
  } else if (!adYesterday) {
    L.push(`> No paid delivery yesterday — everything below is organic.`, "");
  }

  if (prev) {
    const fd = s.followers - prev.followers;
    L.push(`Followers: **${s.followers}**${fd ? ` (${fd > 0 ? "+" : ""}${fd} since ${prev.date})` : " (no change)"}`);
  } else {
    L.push(`Followers: **${s.followers}**`);
  }
  L.push("");

  if (s.daily.length) {
    L.push("Reach, last 7 days:", "");
    const max = Math.max(...s.daily.map((d) => d.reach), 1);
    for (const d of s.daily.slice(-7)) {
      const bar = "█".repeat(Math.max(1, Math.round((d.reach / max) * 28)));
      L.push(`    ${d.d.slice(5)}  ${String(d.reach).padStart(5)}  ${bar}`);
    }
    L.push("");
  }

  if (s.published.length) {
    L.push(`**Published in the last 24h — ${s.published.length}**`, "");
    s.published.forEach((p) => L.push(
      `- ${p.type} · ${p.views.toLocaleString()} views · ${p.reach.toLocaleString()} reach · ${p.interactions} interactions`,
      `  ${p.caption}`, `  ${p.url}`));
  } else {
    L.push("_Nothing published in the last 24h._");
  }
  return L.join("\n");
}
