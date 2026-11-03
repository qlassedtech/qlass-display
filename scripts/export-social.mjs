// Pulls everything the Meta token can currently reach for the Instagram account and Facebook
// Page, and writes it to data/social-export-<date>.json plus a readable summary.
//
// Written as one sweep rather than a set of one-off queries because the useful numbers are spread
// across endpoints that each need slightly different parameters, and several of them — follower
// demographics especially — have never been looked at. Anything the token cannot reach is
// recorded as an error against that section instead of failing the run, so a missing permission
// costs one section rather than the whole export.
//
// Usage:  node scripts/export-social.mjs

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
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

const unix = (d) => Math.floor(d / 1000);
let calls = 0;

async function get(url) {
  calls++;
  const r = await fetch(url);
  const b = await r.json();
  if (b.error) throw new Error(b.error.message || `graph ${r.status}`);
  return b;
}
// Sections report their own failure rather than taking the export down with them.
const attempt = async (label, fn) => {
  try { return await fn(); }
  catch (e) { console.warn(`  ! ${label}: ${e.message.slice(0, 90)}`); return { error: e.message }; }
};

async function instagram(env) {
  const T = env.META_ACCESS_TOKEN, IG = env.META_IG_USER_ID;
  const out = {};

  out.profile = await attempt("profile", () => get(
    `https://graph.facebook.com/${V}/${IG}?fields=username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url&access_token=${T}`));

  // Every post, with whatever metrics that media type supports.
  out.media = await attempt("media", async () => {
    let url = `https://graph.facebook.com/${V}/${IG}/media?fields=id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,thumbnail_url&limit=100&access_token=${T}`;
    const all = [];
    while (url && all.length < 400) {
      const page = await get(url);
      all.push(...(page.data || []));
      url = page.paging && page.paging.next;
    }
    for (const m of all) {
      try {
        const metrics = m.media_product_type === "REELS"
          ? "views,reach,total_interactions,saved,shares,comments,likes"
          : "views,reach,total_interactions,saved,shares";
        const i = await get(`https://graph.facebook.com/${V}/${m.id}/insights?metric=${metrics}&access_token=${T}`);
        for (const d of i.data || []) m[d.name] = d.values?.[0]?.value ?? d.total_value?.value ?? 0;
      } catch { /* older media drop out of the insights window */ }
    }
    return all;
  });

  // Account-level, across several windows, split by surface where the API allows it.
  out.accountInsights = {};
  for (const [label, days] of [["last7", 7], ["last30", 30], ["last90", 90]]) {
    out.accountInsights[label] = await attempt(`account ${label}`, async () => {
      const since = unix(Date.now() - days * 86400000), until = unix(Date.now());
      const plain = await get(`https://graph.facebook.com/${V}/${IG}/insights?metric=views,reach,accounts_engaged,total_interactions,profile_links_taps,follows_and_unfollows&metric_type=total_value&since=${since}&until=${until}&period=day&access_token=${T}`);
      const split = await get(`https://graph.facebook.com/${V}/${IG}/insights?metric=views,reach&metric_type=total_value&breakdown=media_product_type&since=${since}&until=${until}&period=day&access_token=${T}`);
      const res = {};
      for (const m of plain.data || []) res[m.name] = m.total_value?.value ?? 0;
      res.bySurface = {};
      for (const m of split.data || []) {
        const o = {};
        for (const r of m.total_value?.breakdowns?.[0]?.results || []) o[r.dimension_values[0]] = r.value;
        res.bySurface[m.name] = o;
      }
      return res;
    });
  }

  // Who the followers actually are. Never looked at before, and the one that matters most for a
  // business whose catchment is a few kilometres wide.
  out.audience = {};
  for (const dim of ["city", "country", "age", "gender"]) {
    out.audience[dim] = await attempt(`audience ${dim}`, async () => {
      const r = await get(`https://graph.facebook.com/${V}/${IG}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=${dim}&access_token=${T}`);
      const o = {};
      for (const res of r.data?.[0]?.total_value?.breakdowns?.[0]?.results || []) o[res.dimension_values[0]] = res.value;
      return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
    });
  }

  out.stories = await attempt("stories", () => get(
    `https://graph.facebook.com/${V}/${IG}/stories?fields=id,media_type,timestamp,permalink&access_token=${T}`));

  return out;
}

async function facebook(env) {
  const T = env.META_PAGE_TOKEN || env.META_ACCESS_TOKEN, PAGE = env.META_PAGE_ID;
  const out = {};

  out.page = await attempt("page", () => get(
    `https://graph.facebook.com/${V}/${PAGE}?fields=name,username,about,category,fan_count,followers_count,link,phone,location,were_here_count,rating_count&access_token=${T}`));

  out.posts = await attempt("posts", async () => {
    const page = await get(`https://graph.facebook.com/${V}/${PAGE}/posts?fields=id,message,created_time,permalink_url,shares,likes.summary(true),comments.summary(true)&limit=50&access_token=${T}`);
    return (page.data || []).map((p) => ({
      id: p.id, created: p.created_time, permalink: p.permalink_url,
      message: String(p.message || "").replace(/\s+/g, " ").slice(0, 120),
      likes: p.likes?.summary?.total_count ?? 0,
      comments: p.comments?.summary?.total_count ?? 0,
      shares: p.shares?.count ?? 0,
    }));
  });

  out.insights = await attempt("page insights", async () => {
    const since = unix(Date.now() - 30 * 86400000), until = unix(Date.now());
    const r = await get(`https://graph.facebook.com/${V}/${PAGE}/insights?metric=page_impressions,page_post_engagements,page_fans,page_views_total&period=day&since=${since}&until=${until}&access_token=${T}`);
    const o = {};
    for (const m of r.data || []) o[m.name] = (m.values || []).reduce((n, v) => n + (Number(v.value) || 0), 0);
    return o;
  });

  // Reviews need pages_read_user_content, which this token does not have — recorded so the gap is
  // visible in the export rather than silently absent.
  out.ratings = await attempt("ratings", () => get(
    `https://graph.facebook.com/${V}/${PAGE}/ratings?fields=rating,review_text,created_time&limit=25&access_token=${T}`));

  return out;
}

async function main() {
  const env = readEnv();
  if (!env.META_ACCESS_TOKEN) throw new Error("META_ACCESS_TOKEN is not set");
  console.log("pulling Instagram…");
  const ig = await instagram(env);
  console.log("pulling Facebook…");
  const fb = await facebook(env);

  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(ROOT, "data", `social-export-${stamp}.json`);
  await fsp.writeFile(file, JSON.stringify({ exportedAt: new Date().toISOString(), instagram: ig, facebook: fb }, null, 2));

  const media = Array.isArray(ig.media) ? ig.media : [];
  const sum = (k) => media.reduce((n, m) => n + (Number(m[k]) || 0), 0);
  console.log(`\nwritten: ${path.relative(ROOT, file)}  (${calls} API calls)`);
  console.log(`instagram: ${ig.profile?.followers_count ?? "?"} followers · ${media.length} posts pulled`);
  console.log(`  lifetime across those posts: ${sum("views").toLocaleString()} views · ${sum("reach").toLocaleString()} reach · ${sum("total_interactions").toLocaleString()} interactions · ${sum("saved").toLocaleString()} saves · ${sum("shares").toLocaleString()} shares`);
  const l30 = ig.accountInsights?.last30 || {};
  console.log(`  last 30d: ${(l30.views || 0).toLocaleString()} views · ${(l30.reach || 0).toLocaleString()} reach · ${l30.accounts_engaged || 0} engaged · ${l30.profile_links_taps || 0} link taps`);
  const cities = ig.audience?.city && !ig.audience.city.error ? Object.entries(ig.audience.city).slice(0, 5) : [];
  if (cities.length) console.log(`  top cities: ${cities.map(([c, n]) => `${c} ${n}`).join(" · ")}`);
  const fbPosts = Array.isArray(fb.posts) ? fb.posts : [];
  console.log(`facebook: ${fb.page?.fan_count ?? "?"} fans · ${fbPosts.length} posts pulled`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
