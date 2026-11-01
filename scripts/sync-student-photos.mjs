// Caches student photos locally so the TV never talks to SharePoint.
//
// Photos are read straight from the school's own OneDrive folders, per school:
//   <school root>/students/profile-photos/<QLASS ID>-<hash>.jpg         photos students upload in the app
//   <school root>/system/coins-app/Profile Photos/Students/<name> - <class> - <QLASS ID>.jpg   the older rewards-app photos
// (the old rewards-app sharing links no longer work, so the files are found by folder, not by link). The newest file per
// QLASS ID wins. Each is resized by Graph's own thumbnail renderer (c400x400, about 25KB, already square) and written to
// data/student-photos/<school slug>/<QLASS ID>.jpg for the display to serve itself.
//
// A manifest (_manifest.json, same folder) records which OneDrive item and modified time each cached file came from, so a
// photo a student replaces is fetched again and an unchanged one is skipped. The first run adopts files cached before the
// manifest existed without downloading them again, which keeps their review verdicts valid.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
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

async function listFolder(access, user, folder) {
  const out = [];
  let url = `https://graph.microsoft.com/v1.0/users/${user}/drive/root:/${encodeURI(folder)}:/children?$top=200&$select=id,name,file,lastModifiedDateTime`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${access}` } });
    if (res.status === 404) return out;                      // a school with no photos there yet
    if (!res.ok) throw new Error(`list ${folder}: HTTP ${res.status}`);
    const j = await res.json();
    out.push(...j.value.filter((x) => x.file));
    url = j["@odata.nextLink"] || "";
  }
  return out;
}

async function main() {
  const env = readEnv();
  for (const k of ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "ONEDRIVE_USER"]) {
    if (!env[k]) throw new Error(`${k} is not set`);
  }
  const slug = env.QLASS_SCHOOL_SLUG || "qlass-learning";
  const schoolRoot = env.QLASS_SCHOOL_ROOT_FOLDER || slug;
  const OUT = path.join(ROOT, "data", "student-photos", slug);
  await fsp.mkdir(OUT, { recursive: true });
  const manifestFile = path.join(OUT, "_manifest.json");
  let manifest = {};
  try { manifest = JSON.parse(await fsp.readFile(manifestFile, "utf8")); } catch {}

  const access = await token(env);
  const sources = [`${schoolRoot}/system/coins-app/Profile Photos/Students`, `${schoolRoot}/students/profile-photos`];
  const newest = new Map();                                  // QLASS ID -> the newest photo file across both folders
  for (const [n, folder] of sources.entries()) {
    for (const f of await listFolder(access, env.ONEDRIVE_USER, folder)) {
      f.fromOld = n === 0;                                   // the older rewards-app folder
      const id = (f.name.match(/QLPAT\d+/i) || [])[0]?.toUpperCase();
      if (!id || !/\.(jpe?g|png)$/i.test(f.name)) continue;
      const cur = newest.get(id);
      if (!cur || f.lastModifiedDateTime >= cur.lastModifiedDateTime) newest.set(id, f);
    }
  }

  const force = process.argv.includes("--force");
  const dry = process.argv.includes("--dry-run");
  let saved = 0, skipped = 0, adopted = 0, failed = 0;

  for (const [id, f] of newest) {
    const existing = ["jpg", "png"].map((e) => path.join(OUT, `${id}.${e}`)).find((p) => fs.existsSync(p));
    const known = manifest[id];
    if (!force && existing && known && known.item === f.id && known.modified === f.lastModifiedDateTime) { skipped++; continue; }
    if (!force && existing && !known && f.fromOld) {         // cached before the manifest from this very file: adopt it as is
      manifest[id] = { item: f.id, modified: f.lastModifiedDateTime };
      adopted++;
      continue;
    }
    if (dry) { console.log(`  would fetch ${id} (${f.name})`); saved++; continue; }
    try {
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/users/${env.ONEDRIVE_USER}/drive/items/${f.id}/thumbnails/0/${SIZE}/content`,
        { headers: { Authorization: `Bearer ${access}` }, redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // Only trust real image bytes: an error page on disk would show as a broken tile on the TV.
      const magic = buf.subarray(0, 4).toString("hex");
      const ext = magic.startsWith("ffd8") ? "jpg" : magic.startsWith("89504e47") ? "png" : null;
      if (!ext) throw new Error("not an image");
      await fsp.writeFile(path.join(OUT, `${id}.${ext}`), buf);
      // A photo re-uploaded in the other format would otherwise leave its old file behind and keep winning the lookup.
      const stale = path.join(OUT, `${id}.${ext === "jpg" ? "png" : "jpg"}`);
      if (fs.existsSync(stale)) await fsp.unlink(stale);
      manifest[id] = { item: f.id, modified: f.lastModifiedDateTime };
      saved++;
    } catch (e) {
      failed++;
      console.warn(`  ${id}: ${e.message}`);
    }
  }
  if (!dry) await fsp.writeFile(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(`photos: ${saved} ${dry ? "would be fetched" : "saved"}, ${skipped} already cached, ${adopted} adopted, ${failed} failed (${newest.size} students with a photo, school ${slug})`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
