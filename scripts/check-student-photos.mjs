// Screens cached student portraits before they are allowed onto the reception screen.
//
// Students upload their own photo through the rewards app, so the cache can contain anything they
// happened to pick: a screenshot, a cartoon, a group shot, a friend, a blank wall. The TV faces a
// public waiting area, so each portrait is checked once by a vision model and the verdict is kept
// in data/photo-review.json. Boards only draw a face that passed; everything else quietly falls
// back to initials and is listed here for a human to look at.
//
// What this cannot do: confirm the face belongs to that student. There is no reference photo to
// compare against, so a child who uploads a friend's portrait passes every check below. This
// filters obviously unsuitable images; it is not identity verification, and nothing in the admin
// UI should imply that it is.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PHOTO_DIR = path.join(ROOT, "data", "student-photos");
const REVIEW_FILE = path.join(ROOT, "data", "photo-review.json");
const MODEL = "claude-haiku-4-5-20251001";

const PROMPT = `This is a profile photo a school student uploaded of themselves. It may be shown on a
screen in the school's public reception area, so it has to be a suitable portrait.

Answer with JSON only, no other text:
{"ok": true|false, "faces": <number of human faces you can see>, "reason": "<short reason, max 12 words>"}

Set "ok" to true only if ALL of these hold:
- exactly one human face is clearly visible, and it is a real photograph of a real person
- the face takes up a reasonable part of the frame and is not tiny, cut off, or turned away
- it is suitable for public display in a school: no offensive gesture, no text overlay, nothing inappropriate

Set "ok" to false for: no face, several faces, a screenshot of something else, a cartoon or
drawing, an AI-generated or stock image, a photo of a document or a screen, a celebrity, an animal,
an object, or anything unsuitable for a school reception.`;

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

async function judge(apiKey, buf, mime) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 150,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mime, data: buf.toString("base64") } },
          { type: "text", text: PROMPT },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`api ${res.status}: ${(await res.text()).slice(0, 140)}`);
  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || "").join("").trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`unparseable reply: ${text.slice(0, 80)}`);
  const v = JSON.parse(m[0]);
  return { ok: !!v.ok, faces: Number(v.faces) || 0, reason: String(v.reason || "").slice(0, 80) };
}

async function main() {
  const env = readEnv();
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");

  let review = {};
  try { review = JSON.parse(await fsp.readFile(REVIEW_FILE, "utf8")); } catch {}

  const files = fs.existsSync(PHOTO_DIR)
    ? fs.readdirSync(PHOTO_DIR).filter((f) => /\.(jpe?g|png)$/i.test(f)) : [];
  const force = process.argv.includes("--force");
  let checked = 0, passed = 0, failed = 0, skipped = 0, errored = 0;

  for (const f of files) {
    const id = f.replace(/\.(jpe?g|png)$/i, "");
    const stat = fs.statSync(path.join(PHOTO_DIR, f));
    const prev = review[id];
    // Re-check when the file has been replaced since the last verdict, so a student swapping in a
    // new photo cannot inherit the old one's pass.
    if (!force && prev && prev.mtime === stat.mtimeMs) { skipped++; continue; }
    try {
      const buf = await fsp.readFile(path.join(PHOTO_DIR, f));
      const mime = f.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      const v = await judge(env.ANTHROPIC_API_KEY, buf, mime);
      review[id] = { ...v, file: f, mtime: stat.mtimeMs, at: new Date().toISOString() };
      checked++;
      v.ok ? passed++ : failed++;
      if (!v.ok) console.log(`  REJECT ${id}: ${v.reason} (faces=${v.faces})`);
    } catch (e) {
      // An API failure must not quietly reject a good photo, so the old verdict is left alone and
      // an unreviewed photo simply stays unreviewed until the next run.
      errored++;
      console.warn(`  ${id}: ${e.message}`);
    }
  }
  await fsp.writeFile(REVIEW_FILE, JSON.stringify(review, null, 2));
  const totalOk = Object.values(review).filter((r) => r.ok).length;
  console.log(`review: ${checked} checked (${passed} passed, ${failed} rejected), ${skipped} unchanged, ${errored} errors — ${totalOk}/${files.length} photos cleared for display`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
