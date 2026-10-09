// Pulls the latest Qlass Display bundle from Claude Design into this folder.
// usage: node scripts/apply-bundle.mjs <bundle-url>
import fs from "node:fs"; import path from "node:path";
const url = process.argv[2]; if (!url) { console.error("usage: node scripts/apply-bundle.mjs <bundle-url>"); process.exit(1); }
const res = await fetch(url); if (!res.ok) { console.error("download failed", res.status); process.exit(1); }
const { files, created } = await res.json(); let n = 0;
for (const [rel, f] of Object.entries(files)) {
  if (rel === ".env" || (rel.startsWith("data/") && rel !== "data/uploads/.gitkeep")) continue;
  const out = path.join(process.cwd(), rel); fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, f.b64 ? Buffer.from(f.b64, "base64") : f.text); n++;
}
console.log("Bundle " + created + ": updated " + n + " files. Next: git add -A && git commit && git push");
