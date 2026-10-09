#!/usr/bin/env node
// Instagram Graph API helpers + CLI.
//   node meta/instagram.js profile          followers, following, media count
//   node meta/instagram.js media [n]        latest n posts/reels with likes & comments
//   node meta/instagram.js insights <id>    views/reach/saves/shares for one post or reel
//   node meta/instagram.js comments <id>    comments on one post
//   node meta/instagram.js publish-image <image-url> "<caption>"
//   node meta/instagram.js publish-reel  <video-url> "<caption>"
import "./env.js";
import { config, get, post, getAll } from "./graph.js";

const IG = () => {
  if (!config.igUserId) throw new Error("META_IG_USER_ID is not set. Run: node meta/instagram.js discover");
  return config.igUserId;
};

/** Find the Instagram professional account linked to the Pages this token can see. */
export async function discover() {
  const pages = await getAll("/me/accounts", { fields: "id,name,instagram_business_account{id,username,followers_count},access_token" });
  return pages.map((p) => ({ pageId: p.id, page: p.name, igUserId: p.instagram_business_account?.id, username: p.instagram_business_account?.username, followers: p.instagram_business_account?.followers_count, pageToken: p.access_token }));
}

export async function profile() {
  return get(`/${IG()}`, { fields: "id,username,name,followers_count,follows_count,media_count,profile_picture_url" });
}

export async function media(limit = 50) {
  return getAll(`/${IG()}/media`, {
    fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,thumbnail_url,media_url",
  }, { limit });
}

const METRIC_SETS = {
  // Order matters: the first set that the API accepts wins.
  REELS: [["views", "reach", "likes", "comments", "shares", "saved", "total_interactions"], ["plays", "reach", "likes", "comments", "shares", "saved"], ["reach", "saved"]],
  FEED: [["views", "reach", "likes", "comments", "shares", "saved", "total_interactions"], ["impressions", "reach", "saved", "shares"], ["reach", "saved"]],
  STORY: [["views", "reach", "replies", "shares"], ["impressions", "reach"]],
};

/** Insights for one media object, tolerant of metric names changing between API versions. */
export async function mediaInsights(id, productType = "FEED") {
  const sets = METRIC_SETS[productType] || METRIC_SETS.FEED;
  let lastErr;
  for (const metrics of sets) {
    try {
      const r = await get(`/${id}/insights`, { metric: metrics.join(",") });
      return Object.fromEntries((r.data || []).map((m) => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? 0]));
    } catch (e) {
      lastErr = e;
      if (e.code !== 100) throw e; // 100 = unsupported metric; try the next set
    }
  }
  return { error: lastErr?.message };
}

export async function comments(mediaId, limit = 100) {
  return getAll(`/${mediaId}/comments`, { fields: "id,text,username,timestamp,like_count,replies{id,text,username,timestamp}" }, { limit });
}

/** Account-level daily follower change for the last `days` days (max 30). */
export async function followerHistory(days = 30) {
  const until = Math.floor(Date.now() / 1000);
  const since = until - Math.min(days, 30) * 86400;
  const r = await get(`/${IG()}/insights`, { metric: "follower_count,reach", period: "day", since, until });
  const out = {};
  for (const m of r.data || []) for (const v of m.values || []) (out[v.end_time.slice(0, 10)] ||= {})[m.name] = v.value;
  return out;
}

/** Publish an image or reel. The URL must be publicly reachable (e.g. https://display.qlass.in/media/...). */
export async function publish({ imageUrl, videoUrl, caption = "" }) {
  const params = videoUrl ? { media_type: "REELS", video_url: videoUrl, caption } : { image_url: imageUrl, caption };
  const { id: creationId } = await post(`/${IG()}/media`, params);
  // Videos need processing time: poll status_code until FINISHED.
  for (let i = 0; i < 40; i++) {
    const s = await get(`/${creationId}`, { fields: "status_code,status" });
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR") throw new Error(`Media processing failed: ${s.status}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  return post(`/${IG()}/media_publish`, { creation_id: creationId });
}

// ---------------- CLI ----------------
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const [cmd = "profile", a, b] = process.argv.slice(2);
  try {
    if (cmd === "discover") {
      const rows = await discover();
      for (const r of rows) console.log(`Page "${r.page}" (${r.pageId}) → Instagram @${r.username || "-"} id ${r.igUserId || "-"} followers ${r.followers ?? "-"}`);
      if (rows.length) console.log("\nPut these in .env:\n" + `META_PAGE_ID=${rows[0].pageId}\nMETA_IG_USER_ID=${rows[0].igUserId || ""}`);
    } else if (cmd === "profile") {
      console.log(await profile());
    } else if (cmd === "media") {
      for (const m of await media(Number(a) || 20)) {
        console.log(`${m.timestamp.slice(0, 10)}  ${m.media_product_type || m.media_type}  ♥ ${m.like_count ?? "-"}  💬 ${m.comments_count ?? 0}  ${m.id}  ${(m.caption || "").replace(/\s+/g, " ").slice(0, 60)}`);
      }
    } else if (cmd === "insights") {
      if (!a) throw new Error("usage: insights <media id>");
      const m = await get(`/${a}`, { fields: "media_product_type,media_type" });
      console.log(await mediaInsights(a, m.media_product_type || "FEED"));
    } else if (cmd === "comments") {
      if (!a) throw new Error("usage: comments <media id>");
      for (const c of await comments(a)) console.log(`${c.timestamp.slice(0, 16)}  @${c.username}: ${c.text}`);
    } else if (cmd === "followers") {
      console.log(await followerHistory(Number(a) || 30));
    } else if (cmd === "publish-image" || cmd === "publish-reel") {
      if (!a) throw new Error(`usage: ${cmd} <public url> "<caption>"`);
      console.log(await publish(cmd === "publish-reel" ? { videoUrl: a, caption: b } : { imageUrl: a, caption: b }));
    } else {
      console.log("commands: discover | profile | media [n] | insights <id> | comments <id> | followers [days] | publish-image <url> <caption> | publish-reel <url> <caption>");
    }
  } catch (e) {
    console.error(`Error: ${e.message}${e.code ? ` (code ${e.code})` : ""}`);
    process.exit(1);
  }
}
