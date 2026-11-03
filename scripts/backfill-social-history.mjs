// Backfills data/social-history.json day by day from the Instagram API.
//
// The daily digest only started recording at the beginning of November, so everything before that
// existed only inside Meta's reporting window — which runs out at roughly 120 days and then
// returns zeros forever. Once a day falls off that edge the numbers are gone for good, so this
// pulls what is still reachable into a file we keep.
//
// Worth having because the paid side is otherwise invisible: the ad account that delivered it
// (4362790727384695) is not in any business portfolio this token can reach, so its spend, CPC and
// per-creative results cannot be read at all. What the Instagram API will still say is how many
// views and how much reach the ads produced, broken down by surface, and that is the only durable
// record of roughly a million ad-driven views this account received between July and November.
//
// Usage:  node scripts/backfill-social-history.mjs [days]        (default 120)

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const HISTORY = path.join(ROOT, "data", "social-history.json");
const V = "v21.0";

function readEnv() {
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

const breakdown = (metric) => {
  const out = {};
  for (const r of (metric?.total_value?.breakdowns?.[0]?.results) || []) out[r.dimension_values[0]] = r.value;
  return out;
};

async function main() {
  const env = readEnv();
  const T = env.META_ACCESS_TOKEN, IG = env.META_IG_USER_ID;
  if (!T || !IG) throw new Error("META_ACCESS_TOKEN / META_IG_USER_ID not set");
  const days = Math.min(Math.max(parseInt(process.argv[2] || "120", 10), 1), 400);

  let hist = [];
  try { hist = JSON.parse(await fsp.readFile(HISTORY, "utf8")); } catch {}
  const byDate = new Map(hist.map((h) => [h.date, h]));

  const dayMs = 86400000;
  let written = 0, empty = 0, failed = 0;

  for (let back = days; back >= 1; back--) {
    const end = Math.floor((Date.now() - (back - 1) * dayMs) / 1000);
    const start = Math.floor((Date.now() - back * dayMs) / 1000);
    const date = new Date((end - 86400) * 1000).toISOString().slice(0, 10);
    // Days already recorded by the nightly job are authoritative — it also captures followers and
    // engagement, which this backfill cannot reconstruct after the fact.
    if (byDate.get(date)?.followers != null) continue;
    try {
      const res = await call(
        `https://graph.facebook.com/${V}/${IG}/insights?metric=views,reach&metric_type=total_value` +
        `&breakdown=media_product_type&since=${start}&until=${end}&period=day&access_token=${T}`);
      const views = breakdown((res.data || []).find((m) => m.name === "views"));
      const reach = breakdown((res.data || []).find((m) => m.name === "reach"));
      const total = Object.values(views).reduce((a, b) => a + b, 0);
      if (!total) { empty++; continue; }          // before the account had delivery, or past the window
      byDate.set(date, {
        ...(byDate.get(date) || {}),
        date,
        views: total,
        reach: Object.values(reach).reduce((a, b) => a + b, 0),
        bySurface: views,
        bySurfaceReach: reach,
        backfilled: true,
      });
      written++;
    } catch (e) {
      failed++;
      if (failed <= 3) console.warn(`  ${date}: ${e.message}`);
    }
  }

  const out = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  await fsp.writeFile(HISTORY, JSON.stringify(out, null, 2));

  const ad = out.reduce((n, h) => n + (h.bySurface?.AD || 0), 0);
  const org = out.reduce((n, h) => n + (Object.values(h.bySurface || {}).reduce((a, b) => a + b, 0) - (h.bySurface?.AD || 0)), 0);
  console.log(`backfill: ${written} days written, ${empty} with no delivery, ${failed} failed`);
  console.log(`history now spans ${out.length} days${out.length ? ` (${out[0].date} → ${out[out.length - 1].date})` : ""}`);
  console.log(`recorded: ${ad.toLocaleString()} ad views, ${org.toLocaleString()} organic views`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
