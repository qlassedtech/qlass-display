#!/usr/bin/env node
// Daily Instagram + ads snapshot, stored on disk so we can see trends.
//   node meta/snapshot.js take          record today's numbers (safe to re-run; overwrites today's file)
//   node meta/snapshot.js report [days] followers + per-video changes over the last N days (default 7)
//
// Files: data/meta/snapshots/YYYY-MM-DD.json
import "./env.js";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, isConfigured, todayKey } from "./graph.js";
import * as ig from "./instagram.js";
import * as ads from "./ads.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SNAP_DIR = path.join(ROOT, "data", "meta", "snapshots");

export async function take({ mediaLimit = 60, withAds = true } = {}) {
  if (!isConfigured()) throw new Error("META_ACCESS_TOKEN is not set.");
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  const date = todayKey();
  const snap = { date, takenAt: new Date().toISOString(), account: null, media: [], ads: null, errors: [] };

  if (config.igUserId) {
    try {
      const p = await ig.profile();
      snap.account = { username: p.username, followers: p.followers_count, following: p.follows_count, mediaCount: p.media_count };
    } catch (e) { snap.errors.push(`profile: ${e.message}`); }
    try {
      const list = await ig.media(mediaLimit);
      for (const m of list) {
        const type = m.media_product_type || (m.media_type === "VIDEO" ? "REELS" : "FEED");
        const ins = await ig.mediaInsights(m.id, type).catch((e) => ({ error: e.message }));
        snap.media.push({
          id: m.id, type, permalink: m.permalink, posted: m.timestamp, thumb: m.thumbnail_url || m.media_url || "",
          caption: (m.caption || "").replace(/\s+/g, " ").slice(0, 120),
          likes: m.like_count ?? ins.likes ?? 0, comments: m.comments_count ?? ins.comments ?? 0,
          views: ins.views ?? ins.plays ?? ins.impressions ?? 0, reach: ins.reach ?? 0, saved: ins.saved ?? 0, shares: ins.shares ?? 0,
          ...(ins.error ? { insightsError: ins.error } : {}),
        });
      }
    } catch (e) { snap.errors.push(`media: ${e.message}`); }
  } else {
    snap.errors.push("META_IG_USER_ID not set; skipped Instagram.");
  }

  if (withAds && config.adAccountId) {
    try {
      const s = await ads.status();
      const today = await ads.spendByDay(1).catch(() => []);
      snap.ads = {
        account: s.account,
        spendToday: today.reduce((a, r) => a + Number(r.spend || 0), 0),
        active: s.campaigns.filter((c) => c.status === "ACTIVE").map((c) => ({ id: c.id, name: c.name, budget: c.budget })),
        campaigns: s.campaigns,
      };
    } catch (e) { snap.errors.push(`ads: ${e.message}`); }
  }

  if (config.pageId) {
    try {
      const rows = await ads.leads(1); // leads created in the last 24h
      snap.leadsToday = rows.length;
    } catch (e) { snap.errors.push(`leads: ${e.message}`); }
  }

  await fsp.writeFile(path.join(SNAP_DIR, `${date}.json`), JSON.stringify(snap, null, 2));
  return snap;
}

export async function listSnapshots() {
  try { return (await fsp.readdir(SNAP_DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort(); }
  catch { return []; }
}

export async function load(date) {
  return JSON.parse(await fsp.readFile(path.join(SNAP_DIR, `${date}.json`), "utf8"));
}

/**
 * Compare the latest snapshot with the ones N days back.
 * Returns followers trend + per-video rows with deltas (views/likes/comments) since yesterday and since N days ago.
 */
export async function report(days = 7) {
  const dates = await listSnapshots();
  if (!dates.length) return { dates: [], latest: null, today: null, media: [], followers: [] };
  const latest = await load(dates.at(-1));
  const prev = dates.length > 1 ? await load(dates.at(-2)) : null;
  const windowDates = dates.slice(-(days + 1));
  const first = await load(windowDates[0]);
  const byId = (s) => Object.fromEntries((s?.media || []).map((m) => [m.id, m]));
  const p1 = byId(prev), pN = byId(first);
  const d = (a, b, k) => (a?.[k] ?? 0) - (b?.[k] ?? a?.[k] ?? 0);

  const followers = [];
  for (const dt of windowDates) {
    const s = dt === latest.date ? latest : dt === prev?.date ? prev : dt === first.date ? first : await load(dt);
    followers.push({ date: dt, followers: s.account?.followers ?? null, spend: s.ads?.spendToday ?? null });
  }
  for (let i = 1; i < followers.length; i++) followers[i].delta = (followers[i].followers ?? 0) - (followers[i - 1].followers ?? followers[i].followers ?? 0);

  const media = (latest.media || []).map((m) => ({
    ...m,
    dViews: d(m, p1[m.id], "views"), dLikes: d(m, p1[m.id], "likes"), dComments: d(m, p1[m.id], "comments"), dReach: d(m, p1[m.id], "reach"),
    wViews: d(m, pN[m.id], "views"), wLikes: d(m, pN[m.id], "likes"), wComments: d(m, pN[m.id], "comments"),
    isNew: !pN[m.id],
  })).sort((a, b) => b.dViews - a.dViews || b.views - a.views);

  // Today-at-a-glance: summed across every video/post, not just the top one.
  const today = {
    views: media.reduce((a, m) => a + Math.max(m.dViews, 0), 0),
    likes: media.reduce((a, m) => a + Math.max(m.dLikes, 0), 0),
    comments: media.reduce((a, m) => a + Math.max(m.dComments, 0), 0),
    newFollowers: followers.at(-1)?.delta ?? null,
    leads: latest.leadsToday ?? null,
    spend: latest.ads?.spendToday ?? null,
  };

  return { dates: windowDates, latest: { date: latest.date, takenAt: latest.takenAt, account: latest.account, ads: latest.ads, errors: latest.errors }, today, followers, media };
}

// ---------------- CLI ----------------
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const [cmd = "take", a] = process.argv.slice(2);
  const pad = (s, n) => String(s ?? "").padStart(n);
  try {
    if (cmd === "take") {
      const s = await take();
      console.log(`Snapshot ${s.date}: @${s.account?.username ?? "-"} ${s.account?.followers ?? "-"} followers, ${s.media.length} media, ads ${s.ads ? `${s.ads.active.length} active, spent today ₹${s.ads.spendToday.toFixed(2)}` : "skipped"}`);
      for (const e of s.errors) console.error("  warning:", e);
    } else if (cmd === "report") {
      const r = await report(Number(a) || 7);
      if (!r.latest) { console.log("No snapshots yet. Run: node meta/snapshot.js take"); process.exit(0); }
      console.log(`Latest snapshot: ${r.latest.date}  @${r.latest.account?.username}  followers ${r.latest.account?.followers}`);
      const t = r.today;
      console.log(`Today: +${t.views} views, +${t.likes} likes, +${t.comments} comments, ${t.newFollowers != null ? (t.newFollowers >= 0 ? "+" : "") + t.newFollowers : "?"} followers, ${t.leads != null ? t.leads : "?"} leads${t.spend != null ? `, ₹${t.spend.toFixed(0)} ad spend` : ""}`);
      console.log("\nFollowers by day:");
      for (const f of r.followers) console.log(`  ${f.date}  ${pad(f.followers, 6)}  ${f.delta != null ? (f.delta >= 0 ? "+" : "") + f.delta : ""}${f.spend != null ? `   ad spend ₹${f.spend.toFixed(0)}` : ""}`);
      console.log(`\nVideos & posts (Δ = since previous snapshot, ${r.dates.length - 1}d = over the window):`);
      console.log(`${pad("views", 8)} ${pad("Δ", 6)} ${pad(`${r.dates.length - 1}d`, 6)} ${pad("likes", 6)} ${pad("Δ", 4)} ${pad("cmts", 5)} ${pad("Δ", 4)}  type   posted      caption`);
      for (const m of r.media) console.log(`${pad(m.views, 8)} ${pad(m.dViews, 6)} ${pad(m.wViews, 6)} ${pad(m.likes, 6)} ${pad(m.dLikes, 4)} ${pad(m.comments, 5)} ${pad(m.dComments, 4)}  ${(m.type || "").padEnd(6)} ${m.posted.slice(0, 10)}  ${m.caption.slice(0, 50)}`);
    } else {
      console.log("commands: take | report [days]");
    }
  } catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
}
