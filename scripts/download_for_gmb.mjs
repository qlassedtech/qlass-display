import "../meta/env.js";
import { get } from "../meta/graph.js";
import fs from "node:fs";
import path from "node:path";

const OUT = "/tmp/gmb_upload";
fs.mkdirSync(OUT, { recursive: true });

const items = [
  { id: "18116218471960252", name: "divyansh-82-to-better-results" },
  { id: "17947935894338002", name: "apurv-class10-93-percent" },
  { id: "18123666274893703", name: "strong-foundation-classes-4-12" },
  { id: "18224548573327848", name: "learning-beyond-classroom" },
  { id: "18112667975012344", name: "hands-on-experiments-classroom" },
  { id: "17996999100007332", name: "ai-enabled-doubt-solving" },
  { id: "18132413374673882", name: "board-neet-jee-foundation" },
  { id: "18010272869967402", name: "structured-learning-support" },
  { id: "17971424193140150", name: "vr-science-experiments" },
  { id: "17970361356161135", name: "welcome-to-qlass" },
];

for (const item of items) {
  try {
    const m = await get(`/${item.id}`, { fields: "media_type,media_url,thumbnail_url" });
    const isVideo = m.media_type === "VIDEO";
    const url = isVideo ? (m.media_url || m.thumbnail_url) : (m.media_url || m.thumbnail_url);
    const usingThumbFallback = isVideo && !m.media_url;
    const ext = isVideo && !usingThumbFallback ? "mp4" : "jpg";
    const file = path.join(OUT, `${item.name}.${ext}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(file, buf);
    console.log(`OK  ${(buf.length/1024).toFixed(0)}KB  ${file}${usingThumbFallback ? "  (thumbnail only, no video_url)" : ""}`);
  } catch (e) {
    console.log(`FAIL ${item.id} ${item.name}: ${e.message}`);
  }
}
