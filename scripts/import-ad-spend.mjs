// Merges a Meta billing export into data/social-history.json so spend sits next to delivery.
//
// Instagram boosts are billed through a prepaid wallet rather than a Marketing API ad account, so
// none of this is reachable programmatically — the only source is the CSV from
// Business Suite → Billing & payments → Payment activity → Download report (CSV).
//
// That export mixes two different things under one "Amount" column: wallet top-ups (money in) and
// ad charges (money out). The UI distinguishes them as "Funded" versus "Paid" but the CSV does
// not, so they are separated here by shape — top-ups are round figures a person chose (₹500,
// ₹1,000), charges land on arbitrary paise (₹294.36, ₹1,269.09). That heuristic produced
// ₹22,603.99 of charges against ₹14,140 of top-ups, and the charge figure agrees with the
// cost-per-view implied by Ad Center to within a few percent, so it is close to right — but it is
// still a heuristic, and a round-number charge would be misfiled as a top-up.
//
// Usage:  node scripts/import-ad-spend.mjs <path-to-csv>

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY = path.join(__dirname, "..", "data", "social-history.json");

// Minimal CSV reader — the export is plain, but amounts carry thousands separators inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) throw new Error("usage: node scripts/import-ad-spend.mjs <billing-export.csv>");
  const rows = parseCsv(await fsp.readFile(csvPath, "utf8").then((t) => t.replace(/^﻿/, "")));

  const head = rows.findIndex((r) => r.includes("Date") && r.includes("Amount"));
  if (head < 0) throw new Error("no transaction table found — is this a Meta billing export?");
  const col = Object.fromEntries(rows[head].map((c, i) => [c.trim(), i]));

  const charges = new Map();                   // date -> rupees charged that day
  let topUps = 0, chargeTotal = 0;
  for (const r of rows.slice(head + 1)) {
    const rawDate = (r[col.Date] || "").trim();
    const rawAmt = (r[col.Amount] || "").trim();
    if (!rawDate || !rawAmt) continue;
    const [m, d, y] = rawDate.split("/").map(Number);
    if (!y) continue;
    const amount = Number(rawAmt.replace(/,/g, ""));
    if (!Number.isFinite(amount)) continue;
    // Round figure ending in a whole ten rupees: a person topping up the wallet.
    if (Math.abs(amount - Math.round(amount)) < 0.005 && Math.round(amount) % 10 === 0) {
      topUps += amount; continue;
    }
    const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    charges.set(date, (charges.get(date) || 0) + amount);
    chargeTotal += amount;
  }

  let hist = [];
  try { hist = JSON.parse(await fsp.readFile(HISTORY, "utf8")); } catch {}
  const byDate = new Map(hist.map((h) => [h.date, h]));
  let matched = 0, orphan = 0;
  for (const [date, spend] of charges) {
    const row = byDate.get(date);
    if (row) { row.adSpendInr = Math.round(spend * 100) / 100; matched++; }
    else { byDate.set(date, { date, adSpendInr: Math.round(spend * 100) / 100 }); orphan++; }
  }
  const out = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  await fsp.writeFile(HISTORY, JSON.stringify(out, null, 2));

  const withBoth = out.filter((h) => h.adSpendInr && h.bySurface?.AD);
  const spent = withBoth.reduce((n, h) => n + h.adSpendInr, 0);
  const views = withBoth.reduce((n, h) => n + h.bySurface.AD, 0);
  console.log(`imported ${charges.size} days of charges — ₹${chargeTotal.toFixed(2)} (plus ₹${topUps.toFixed(2)} of wallet top-ups, not counted as spend)`);
  console.log(`matched to existing days: ${matched}, added as new: ${orphan}`);
  if (views) {
    console.log(`\non ${withBoth.length} days with both figures: ₹${spent.toFixed(2)} bought ${views.toLocaleString()} ad views`);
    console.log(`  ₹${(spent / views).toFixed(4)} per view · ₹${(spent / views * 1000).toFixed(0)} per thousand`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
