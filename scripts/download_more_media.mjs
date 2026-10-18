import "../meta/env.js";
import { get } from "../meta/graph.js";
import fs from "node:fs";
import path from "node:path";

const OUT = "/Users/nikhilkumar/Downloads/Qlass-display/GMB Photos and Videos";
fs.mkdirSync(OUT, { recursive: true });

const items = [
  { id: "18195789049347910", name: "shreyansh-sinha-85-percent-result" },
  { id: "18106223459189264", name: "meet-diwa-ai-robot" },
  { id: "17956877013012417", name: "kaash-personalised-learning" },
  { id: "18130901581667578", name: "ai-enabled-strong-foundation" },
  { id: "18086206040482302", name: "real-students-real-progress-95-percent" },
  { id: "17937197595367628", name: "teachers-day-celebration" },
];

for (const item of items) {
  try {
    const m = await get(`/${item.id}`, { fields: "media_type,media_product_type,media_url,thumbnail_url" });
    const isVideo = m.media_type === "VIDEO";
    const usingThumbFallback = isVideo && !m.media_url;
    const url = isVideo ? (m.media_url || m.thumbnail_url) : (m.media_url || m.thumbnail_url);
    const ext = isVideo && !usingThumbFallback ? "mp4" : "jpg";
    const file = path.join(OUT, `${item.name}.${ext}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(file, buf);
    console.log(`OK  ${(buf.length/1024).toFixed(0)}KB  ${file}${usingThumbFallback ? "  (thumbnail only)" : ""}`);
  } catch (e) {
    console.log(`FAIL ${item.id} ${item.name}: ${e.message}`);
  }
}
