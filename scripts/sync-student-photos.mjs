// Caches student photos locally so the TV never talks to SharePoint.
//
// The rewards app stores each student's photo as a OneDrive sharing link in users.photo_url.
// Those links are private — fetched anonymously they return 403 — so they are resolved through
// Microsoft Graph with the same app-only registration the assessment backend uses, and the
// result is written into data/student-photos/<qlass_id>.jpg for the display to serve itself.
//
// Graph's own thumbnail renderer does the downscaling: the originals are 1-2MB each, which is
// far too heavy for a board that shows eight at once, and this server has no image tooling of
// its own. A c400x400 crop lands at roughly 25KB and is already square, which is the shape the
// tiles want.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "data", "student-photos");
const SIZE = "c400x400";

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

async function token(env) {
  const body = new URLSearchParams({
    client_id: env.AZURE_CLIENT_ID, client_secret: env.AZURE_CLIENT_SECRET,
    grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default",
  });
  const r = await fetch(`https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/oauth2/v2.0/token`, { method: "POST", body });
  const j = await r.json();
  if (!j.access_token) throw new Error(`token: ${j.error || r.status} ${String(j.error_description || "").slice(0, 120)}`);
  return j.access_token;
}

// Graph addresses a sharing link by a base64url of the URL itself, prefixed "u!".
const shareToken = (url) =>
  "u!" + Buffer.from(url).toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");

async function main() {
  const env = readEnv();
  for (const k of ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "QLASS_COINS_DATABASE_URL"]) {
    if (!env[k]) throw new Error(`${k} is not set`);
  }
  await fsp.mkdir(OUT, { recursive: true });

  const pool = new pg.Pool({ connectionString: env.QLASS_COINS_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
  const { rows } = await pool.query(
    `select s.qlass_id, s.name, u.photo_url
     from users u join students s on s.qlass_id = u.qlass_id
     where u.photo_url is not null and u.photo_url <> ''`);
  await pool.end();

  const access = await token(env);
  const force = process.argv.includes("--force");
  let saved = 0, skipped = 0, failed = 0;

  for (const r of rows) {
    // One file per student id, so a changed photo overwrites rather than accumulating.
    const dest = path.join(OUT, `${r.qlass_id}.jpg`);
    if (!force && fs.existsSync(dest)) { skipped++; continue; }
    try {
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/shares/${shareToken(r.photo_url)}/driveItem/thumbnails/0/${SIZE}/content`,
        { headers: { Authorization: `Bearer ${access}` }, redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // Only trust something that really is a JPEG — an error page written to disk would show
      // up as a broken tile on the TV rather than as a failure here.
      if (buf.subarray(0, 2).toString("hex") !== "ffd8") throw new Error("not a JPEG");
      await fsp.writeFile(dest, buf);
      saved++;
    } catch (e) {
      failed++;
      console.warn(`  ${r.name}: ${e.message}`);
    }
  }
  console.log(`photos: ${saved} saved, ${skipped} already cached, ${failed} failed (${rows.length} students with a photo)`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
