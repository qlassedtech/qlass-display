// Builds the morning digest: what happened on the socials, what the TV did overnight, and a
// drafted reply for anything a person still has to answer.
//
// Nothing here publishes. Replies to reviews and comments go out under the school's name in front
// of parents, and a generated answer to an angry review is the one place a wrong word does lasting
// damage — so this drafts and a human sends. The drafts are the time saving; the judgement stays
// with whoever reads them.
//
// Google reviews are collected through gbp/reviews.js when that is configured. Today it is not:
// the Business Profile APIs are access-gated and the project has no Google credentials, so that
// section reports itself as unavailable rather than silently showing nothing.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as gbp from "../gbp/reviews.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data", "digests");
const GRAPH = "v21.0";
const MODEL = "claude-haiku-4-5-20251001";

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

// Comments that should be read by a person rather than answered by a draft. Deliberately short
// and obvious — the point is to raise a hand, not to moderate. Hinglish is included because the
// abuse on these posts arrives in it.
const ABUSE = /\b(bakchodi|bakwas|bakwaas|jhaat|jhant|chutiy|chutia|gandu|madarch|behenc|bhosd|lodu|saala|salo|saloo|harami|kamina|fraud|scam|cheat|useless|worst|pathetic|idiot|stupid|nonsense)\b/i;

const fbJson = async (url) => {
  const r = await fetch(url);
  const b = await r.json();
  if (b.error) throw new Error(b.error.message || `graph ${r.status}`);
  return b;
};

// ---- Instagram ----------------------------------------------------------------
async function instagram(env, sinceMs) {
  const t = env.META_ACCESS_TOKEN, ig = env.META_IG_USER_ID;
  if (!t || !ig) return { available: false, why: "META_ACCESS_TOKEN / META_IG_USER_ID not set" };
  const media = await fbJson(
    `https://graph.facebook.com/${GRAPH}/${ig}/media` +
    `?fields=id,caption,timestamp,like_count,comments_count,permalink&limit=25&access_token=${t}`);
  const posts = media.data || [];
  const recent = posts.filter((p) => Date.parse(p.timestamp) >= sinceMs);

  // Only posts that actually carry comments are worth a second request.
  const needsReply = [], flagged = [];
  for (const p of posts.filter((x) => (x.comments_count || 0) > 0).slice(0, 10)) {
    let data = [];
    try {
      const c = await fbJson(
        `https://graph.facebook.com/${GRAPH}/${p.id}/comments` +
        `?fields=id,text,username,timestamp,replies{id}&limit=25&access_token=${t}`);
      data = c.data || [];
    } catch { continue; }
    for (const c of data) {
      if (((c.replies && c.replies.data) || []).length) continue;   // already answered
      const raw = String(c.text || "");
      // Strip emoji, variation selectors, joiners and any URL before judging length: a wall of
      // hearts and a pasted link both leave nothing to actually reply to.
      const bare = raw
        .replace(/https?:\/\/\S+/g, "")
        .replace(/[\p{Extended_Pictographic}\p{Emoji_Component}️‍\s]/gu, "");
      const entry = { id: c.id, text: raw, username: c.username, at: c.timestamp, post: p.permalink };
      if (ABUSE.test(raw)) {
        // Abuse is surfaced for a person to hide or delete. Drafting a warm reply to it would be
        // worse than silence, and answering a troll in public only feeds them.
        flagged.push({ ...entry, why: "possible abuse or insult" });
      } else if (bare.length >= 8) {
        needsReply.push(entry);
      }
    }
  }
  return {
    available: true,
    totals: {
      posts: posts.length,
      postedInWindow: recent.length,
      likes: posts.reduce((n, p) => n + (p.like_count || 0), 0),
      comments: posts.reduce((n, p) => n + (p.comments_count || 0), 0),
    },
    needsReply,
    flagged,
  };
}

// ---- the TV -------------------------------------------------------------------
async function screen() {
  try {
    const log = JSON.parse(await fsp.readFile(path.join(ROOT, "data", "client-log.json"), "utf8"));
    const sessions = new Map();
    for (const e of log) {
      if (!sessions.has(e.session)) sessions.set(e.session, []);
      sessions.get(e.session).push(e);
    }
    const tv = [...sessions.values()].filter((es) => es.some((e) => /Tizen|TV \|/.test(e.detail || "")));
    if (!tv.length) return { available: true, seen: false };
    const last = tv[tv.length - 1];
    const lastAt = Math.max(...last.map((e) => e.t));
    return {
      available: true, seen: true,
      minutesSinceSeen: Math.round((Date.now() - lastAt) / 60000),
      errors: last.filter((e) => e.level === "error").map((e) => e.label).slice(-5),
    };
  } catch (e) {
    return { available: false, why: e.message };
  }
}

// ---- drafting ------------------------------------------------------------------
async function draftReplies(env, items) {
  if (!items.length) return items;
  if (!env.ANTHROPIC_API_KEY) return items.map((i) => ({ ...i, draft: "", draftNote: "ANTHROPIC_API_KEY not set" }));
  const out = [];
  for (const it of items) {
    const prompt =
      `You write replies for Qlass Learning, a coaching institute in Khagaul, Patna, on behalf of its staff.\n\n` +
      `Someone left this ${it.kind || "comment"} on ${it.source || "Instagram"}:\n` +
      (it.rating ? `Rating: ${it.rating} out of 5\n` : "") +
      `"${it.text}"\n\n` +
      `Write a reply of at most 2 sentences. Warm, specific, plain English, no hashtags, no emoji ` +
      `spam, never promise results or discounts. If the message raises a real complaint, acknowledge ` +
      `it plainly and invite them to contact the centre rather than arguing. Reply with the message ` +
      `text only, nothing else.`;
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens: 200, messages: [{ role: "user", content: prompt }] }),
      });
      if (!r.ok) {
        // Surface what the API actually said. "api 400" sent someone hunting for a bug in the
        // request when the real answer was that the key had no credit left on it.
        const body = await r.json().catch(() => ({}));
        throw new Error((body.error && body.error.message) || `api ${r.status}`);
      }
      const d = await r.json();
      out.push({ ...it, draft: (d.content || []).map((c) => c.text || "").join("").trim() });
    } catch (e) {
      out.push({ ...it, draft: "", draftNote: e.message });
    }
  }
  return out;
}

// ---- report --------------------------------------------------------------------
function toMarkdown(d) {
  const L = [];
  L.push(`# Qlass daily digest — ${d.date}`, "");
  const ig = d.instagram;
  L.push("## Instagram");
  if (!ig.available) L.push(`_Unavailable: ${ig.why}_`);
  else {
    L.push(`${ig.totals.posts} recent posts · ${ig.totals.likes} likes · ${ig.totals.comments} comments` +
           ` · ${ig.totals.postedInWindow} posted in the last 24h`);
    if ((ig.flagged || []).length) {
      L.push("", `**${ig.flagged.length} comment(s) to look at yourself — not drafted**`, "");
      ig.flagged.forEach((c) => {
        L.push(`- **@${c.username}** (${c.why}) — ${c.text}`);
        L.push(`  ${c.post || ""}`);
      });
    }
    if (!ig.needsReply.length) L.push("", "Nothing else awaiting a reply.");
    else {
      L.push("", `**${ig.needsReply.length} comment(s) awaiting a reply**`, "");
      ig.needsReply.forEach((c, i) => {
        L.push(`${i + 1}. **@${c.username}** — ${c.text}`);
        L.push(`   _Suggested:_ ${c.draft || "(no draft: " + (c.draftNote || "unknown") + ")"}`);
        L.push(`   ${c.post || ""}`, "");
      });
    }
  }
  L.push("", "## Google reviews");
  if (!d.google.available) {
    L.push(`_Not connected: ${d.google.why}_`);
    L.push("", "See `docs/api-access-requests.md` for what has to be approved before this section works.");
  } else if (!d.google.reviews.length) L.push("No new reviews.");
  else {
    L.push(`**${d.google.reviews.length} review(s) awaiting a reply**`, "");
    d.google.reviews.forEach((r, i) => {
      L.push(`${i + 1}. **${r.author}** — ${r.rating}★ — ${r.text || "(no text)"}`);
      L.push(`   _Suggested:_ ${r.draft || "(no draft)"}`, "");
    });
  }
  L.push("", "## Reception screen");
  const s = d.screen;
  if (!s.available) L.push(`_Unavailable: ${s.why}_`);
  // The client log is capped, so a TV that has been off for a day or two gets pushed out of it
  // entirely by other visitors. Absence here means "not in the recent log", not "never ran".
  else if (!s.seen) L.push("No TV session in the recent log — the screen has not checked in lately.");
  else {
    L.push(s.minutesSinceSeen < 90
      ? `Online — last seen ${s.minutesSinceSeen} min ago.`
      : `**Offline — last seen ${Math.round(s.minutesSinceSeen / 60)} hours ago.**`);
    if (s.errors.length) L.push("", "Recent errors:", ...s.errors.map((e) => `- ${e}`));
  }
  L.push("", "---", "_Drafts are suggestions. Nothing here has been posted._");
  return L.join("\n");
}

async function main() {
  const env = readEnv();
  const since = Date.now() - 24 * 3600 * 1000;
  await fsp.mkdir(OUT_DIR, { recursive: true });

  let ig;
  try { ig = await instagram(env, since); }
  catch (e) { ig = { available: false, why: e.message }; }
  if (ig.available) ig.needsReply = await draftReplies(env, ig.needsReply.map((c) => ({ ...c, kind: "comment", source: "Instagram" })));

  let google = { available: false, why: "not configured" };
  try {
    if (gbp.isConfigured()) {
      const reviews = await gbp.unansweredReviews();
      google = { available: true, reviews: await draftReplies(env, reviews.map((r) => ({ ...r, kind: "review", source: "Google" }))) };
    } else {
      google = { available: false, why: gbp.whyNotConfigured() };
    }
  } catch (e) { google = { available: false, why: e.message }; }

  const digest = { date: new Date().toISOString().slice(0, 10), generatedAt: new Date().toISOString(), instagram: ig, google, screen: await screen() };
  const base = path.join(OUT_DIR, digest.date);
  await fsp.writeFile(`${base}.json`, JSON.stringify(digest, null, 2));
  await fsp.writeFile(`${base}.md`, toMarkdown(digest));
  const pending = (ig.available ? ig.needsReply.length : 0) + (google.available ? google.reviews.length : 0);
  console.log(`digest: ${digest.date} written, ${pending} item(s) awaiting a reply`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
