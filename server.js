import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as metaGraph from "./meta/graph.js";
import * as metaAds from "./meta/ads.js";
import * as metaSnapshot from "./meta/snapshot.js";
import { BOARDS, fetchBoards } from "./coins/leaderboards.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- config ----------
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 2048);
// A second password gates the Instagram/ads tab (pause/resume real ad spend) separately from the
// shared upload password, so anyone who can upload photos can't also touch the ad account.
const META_ADMIN_PASSWORD = process.env.META_ADMIN_PASSWORD || "";

const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const MEDIA_FILE = path.join(DATA_DIR, "media.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const AUTH_FILE = path.join(DATA_DIR, "auth.json");
const CLIENT_LOG_FILE = path.join(DATA_DIR, "client-log.json");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (ADMIN_PASSWORD === "change-me" || SESSION_SECRET === "dev-secret-change-me") {
  console.warn("WARNING: ADMIN_PASSWORD / SESSION_SECRET are using defaults. Set them in .env before going live.");
}

// ---------- tiny JSON store ----------
const DEFAULT_SETTINGS = {
  imageDuration: 10,   // seconds per photo
  transition: "fade",  // fade | none
  videoSound: false,   // TVs block unmuted autoplay; keep muted unless the TV browser allows it
  volume: 60,          // percent ceiling — this plays in a reception area, so never full blast
  audioCompressor: true, // evens out the loudness gap between reels so no one clip startles the room
  shuffle: false,
  refreshInterval: 30, // seconds between player checks for new media
  contact: "qlasslearning.com · +91 90310 03985",
  // Qlass Coins leaderboard banners, read live from the rewards database.
  boards: {
    enabled: true,
    show: ["coins", "coinsClass", "dppSubmissions", "dppScores", "rewards", "schoolTests", "subjectStars", "attendance"],
    duration: 14,     // seconds per board — longer than an achiever card, there's more to read
    every: 4,         // insert one board after every N uploaded items
    repeat: 1,        // times each board appears per cycle (copies are spread far apart)
  },
  achievers: {
    enabled: true,
    sheetUrl: process.env.RESULTS_SHEET_URL || "https://docs.google.com/spreadsheets/d/1uPrXEi93HPhphqgdwRY2HcJxD7WgDQFOaXGVeZCpR-0/edit?gid=1634670191",
    minPercent: 80,
    photoPattern: process.env.PHOTO_URL_PATTERN || "", // e.g. https://portal.qlass.in/photos/{id}.jpg
    every: 2,            // one achiever slide after every N uploads
    duration: 10,        // seconds per achiever slide
    recapDuration: 12,   // seconds for the "Our Achievers" summary
    hidden: [],          // student keys hidden from the TV
    test: "",            // which test to feature ("" = most recent)
    cls: "",             // limit to one class ("" = all classes)
  },
};
const loadSettings = async () => {
  const s = await readJson(SETTINGS_FILE, {});
  return { ...DEFAULT_SETTINGS, ...s,
    achievers: { ...DEFAULT_SETTINGS.achievers, ...(s.achievers || {}) },
    boards: { ...DEFAULT_SETTINGS.boards, ...(s.boards || {}) } };
};

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}
async function writeJson(file, value) {
  const tmp = file + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2));
  await fsp.rename(tmp, file);
}

// Serialize writes so concurrent uploads don't clobber the manifest.
let chain = Promise.resolve();
function withMedia(fn) {
  const run = chain.then(async () => {
    const list = await readJson(MEDIA_FILE, []);
    const result = await fn(list);
    await writeJson(MEDIA_FILE, list);
    return result;
  });
  chain = run.catch(() => {});
  return run;
}

// ---------- auth ----------
// authState.epoch increments to invalidate every outstanding session cookie at once (e.g. after a leak).
let authState = { epoch: 0 };
(async () => { authState = { epoch: 0, ...(await readJson(AUTH_FILE, {})) }; })();
function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}
function makeToken() {
  const payload = `${Date.now()}.${authState.epoch}`;
  return `${payload}.${sign(payload)}`;
}
function verifyToken(token) {
  if (!token || !token.includes(".")) return false;
  const i = token.lastIndexOf(".");
  const payload = token.slice(0, i), sig = token.slice(i + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const [ts, epoch] = payload.split(".");
  if (Number(epoch) !== authState.epoch) return false;
  const ageDays = (Date.now() - Number(ts)) / 86400000;
  return ageDays < 30;
}
async function revokeAllSessions() {
  authState = { epoch: authState.epoch + 1 };
  await writeJson(AUTH_FILE, authState);
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function requireAuth(req, res, next) {
  if (verifyToken(parseCookies(req).qd_session)) return next();
  res.status(401).json({ error: "Not signed in" });
}

// Login rate limiting: 10 attempts per IP per 15 minutes, in memory (fine for a single-instance app).
const loginAttempts = new Map();
setInterval(() => {
  const cutoff = Date.now() - 15 * 60_000;
  for (const [ip, hits] of loginAttempts) {
    const kept = hits.filter((t) => t > cutoff);
    if (kept.length) loginAttempts.set(ip, kept); else loginAttempts.delete(ip);
  }
}, 5 * 60_000).unref();
function loginLimiter(req, res, next) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
  const cutoff = Date.now() - 15 * 60_000;
  const hits = (loginAttempts.get(ip) || []).filter((t) => t > cutoff);
  if (hits.length >= 10) return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
  hits.push(Date.now());
  loginAttempts.set(ip, hits);
  next();
}

// Separate gate for the Instagram/ads tab: requires its own password even once signed in to the portal.
function requireMetaAuth(req, res, next) {
  if (!META_ADMIN_PASSWORD) return res.status(503).json({ error: "Instagram & Ads admin password is not configured (set META_ADMIN_PASSWORD)." });
  const supplied = Buffer.from(String(req.headers["x-meta-password"] || ""));
  const expected = Buffer.from(META_ADMIN_PASSWORD);
  const ok = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  if (!ok) return res.status(401).json({ error: "Wrong Instagram & Ads password" });
  next();
}

// ---------- uploads ----------
const ALLOWED = {
  "image/jpeg": "image", "image/png": "image", "image/gif": "image", "image/webp": "image",
  "image/avif": "image", "image/bmp": "image",
  "video/mp4": "video", "video/webm": "video", "video/quicktime": "video", "video/x-m4v": "video",
  "video/ogg": "video",
};
const EXT_TYPES = {
  ".jpg": ["image", "image/jpeg"], ".jpeg": ["image", "image/jpeg"], ".png": ["image", "image/png"],
  ".gif": ["image", "image/gif"], ".webp": ["image", "image/webp"], ".avif": ["image", "image/avif"], ".bmp": ["image", "image/bmp"],
  ".mp4": ["video", "video/mp4"], ".m4v": ["video", "video/mp4"], ".webm": ["video", "video/webm"],
  ".mov": ["video", "video/quicktime"], ".ogv": ["video", "video/ogg"],
};
// Browsers (and curl) sometimes send application/octet-stream; fall back to the extension.
function classify(file) {
  if (ALLOWED[file.mimetype]) return { type: ALLOWED[file.mimetype], mime: file.mimetype };
  const ext = path.extname(file.originalname).toLowerCase();
  if (EXT_TYPES[ext]) return { type: EXT_TYPES[ext][0], mime: EXT_TYPES[ext][1] };
  return null;
}
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "") || "";
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (classify(file)) return cb(null, true);
    cb(new Error(`Unsupported file "${file.originalname}". Upload JPG, PNG, GIF, WebP, MP4, WebM or MOV.`));
  },
});

// ---------- achievers (from the Google results sheet) ----------
function parseCSV(t) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; } else if (c !== "\r") f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const COLS = {
  id: [/qlassid/, /^id$/, /studentid/], name: [/^name$/, /studentname/, /fullname/], cls: [/^class/, /grade/],
  school: [/school/], subject: [/subject/], exam: [/testname/, /examname/, /^exam$/, /^test$/],
  date: [/testdate/, /^date$/], marks: [/obtained/, /secured/, /^marks?$/], total: [/fullmarks/, /total/, /maxmarks/, /outof/], pct: [/percent/], photo: [/photo/, /image/],
};
const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return Number.isNaN(n) ? null : n; };
const fmt = (n) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));
function toStudents(arr, photoPattern) {
  const head = (arr[0] || []).map((h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, ""));
  const ix = {}; for (const k in COLS) ix[k] = head.findIndex((h) => COLS[k].some((re) => re.test(h)));
  const g = (r, k) => (ix[k] >= 0 ? String(r[ix[k]] ?? "").trim() : "");
  return arr.slice(1).filter((r) => g(r, "name")).map((r) => {
    const m = num(g(r, "marks")), t = num(g(r, "total"));
    let p = num(g(r, "pct")); if (p != null && p <= 1 && !g(r, "pct").includes("%")) p *= 100;
    if (p == null && m != null && t) p = (m / t) * 100;
    const name = g(r, "name").replace(/\s+/g, " "), parts = name.split(" ");
    let cls = g(r, "cls"); if (/^\d+$/.test(cls)) cls = "Class " + cls;
    const id = g(r, "id"), photo = g(r, "photo");
    return {
      key: [id || name, g(r, "subject"), g(r, "exam")].join("|"),
      id, name, first: parts[0], initials: (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase(),
      cls, school: g(r, "school"), subject: g(r, "subject"), exam: g(r, "exam"), date: g(r, "date"),
      marks: m != null ? fmt(m) : "", total: t != null ? fmt(t) : "", pct: Math.round(p || 0),
      photoUrl: /^https?:/.test(photo) ? photo : photoPattern && id ? photoPattern.replace("{id}", encodeURIComponent(id)) : "",
    };
  });
}
// One entry per student per test (overall % across subjects) — mirrors QlassArt.group in achiever-art.js.
const parseDate = (d) => { const m = String(d || "").match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/); if (!m) return 0; const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return new Date(y, +m[2] - 1, +m[1]).getTime(); };
const SUBJ = [[/^maths?$|^mathematics|fraction|algebra|geometry|mensuration|integers|decimals/i, "Mathematics"], [/^sst$|social\s*science|social\s*studies/i, "Social Science"], [/^sci(ence)?\b|science\s*\(/i, "Science"],
  [/^bio/i, "Biology"], [/^chem/i, "Chemistry"], [/^phy/i, "Physics"], [/^eng/i, "English"], [/^hin/i, "Hindi"], [/^comp/i, "Computer"], [/^sans/i, "Sanskrit"], [/^ger/i, "German"]];
const normSubject = (x, exam) => {
  const t = String(x || "").trim();
  for (const [re, n] of SUBJ) if (re.test(t)) return n;
  const m = t.match(/\(([^)]+)\)/); if (m) for (const [re, n] of SUBJ) if (re.test(m[1])) return n;
  if (!t || /^(class|unit|chapter|weekly|monthly)?\s*test|^mcq|multiple choice|^fac|^total$/i.test(t) || t.toLowerCase() === String(exam).toLowerCase()) return "";
  return t.replace(/\s*-\s*.*$/, "");
};
const normExam = (x) => String(x || "").trim().replace(/examination$/i, "Exam").replace(/\s+/g, " ").replace(/^term[\s-]*i\b/i, "Term 1").replace(/^half[\s-]*yearly/i, "Half-Yearly");
function groupResults(rows) {
  rows = rows.map((r) => ({ ...r, exam: normExam(r.exam), subjectRaw: r.subject, subject: normSubject(r.subject, r.exam) }));
  const map = new Map();
  for (const r of rows) {
    if (/verify|flag|review|test entry|dummy/i.test(r.exam + " " + r.name)) continue;
    const k = (r.id || r.name) + "|" + r.exam;
    if (!map.has(k)) map.set(k, { ...r, key: k, subjects: [], sumM: 0, sumT: 0, ts: 0 });
    const g = map.get(k);
    g.ts = Math.max(g.ts, parseDate(r.date));
    if (!g.photoUrl && r.photoUrl) g.photoUrl = r.photoUrl;
    if (/^(grand\s*)?total$|^overall$/i.test(r.subjectRaw.trim())) { g.overall = r; continue; }
    const prev = r.subject && g.subjects.find((x) => x.subject === r.subject);
    if (prev) prev.pct = Math.max(prev.pct, r.pct); else g.subjects.push({ subject: r.subject, pct: r.pct });
    const m = Number(r.marks), t = Number(r.total);
    if (!Number.isNaN(m) && t > 0) { g.sumM += m; g.sumT += t; }
  }
  return [...map.values()].filter((g) => g.subjects.length || g.overall).map((g) => {
    if (!g.subjects.length) g.subjects.push({ subject: g.overall.subject, pct: g.overall.pct });
    g.subjects.sort((a, b) => b.pct - a.pct);
    const n = g.subjects.length;
    let pct = g.sumT ? Math.round((g.sumM / g.sumT) * 100) : Math.round(g.subjects.reduce((a, b) => a + b.pct, 0) / n);
    const fromTotal = !!g.overall && !g.sumT;
    if (fromTotal) { pct = g.overall.pct; g.sumM = Number(g.overall.marks) || 0; g.sumT = Number(g.overall.total) || 0; }
    const { overall, ...rest } = g;
    const named = fromTotal ? [] : g.subjects.filter((x) => x.subject), k = named.length;
    return { ...rest, pct, marks: g.sumT ? fmt(g.sumM) : "", total: g.sumT ? fmt(g.sumT) : "",
      subject: k > 1 ? `Overall · ${k} subjects` : k && g.subjects.length === k ? named[0].subject : "",
      best: named.slice(0, k > 3 ? 2 : 3).map((x) => `${x.subject.length > 22 ? x.subject.slice(0, 20).trim() + "…" : x.subject} ${x.pct}%`).join(" · "),
      inSubj: k > 1 ? `overall across ${k} subjects` : k && g.subjects.length === k ? `in ${named[0].subject}` : "overall" };
  });
}
const latestTest = (list) => { let best = null; for (const s of list) if (!best || s.ts > best.ts) best = s; return best ? best.exam : ""; };
let sheetCache = { key: "", at: 0, students: [], error: null };
async function getStudents(a, force = false) {
  if (!a.sheetUrl) return { students: [], error: "No results sheet linked yet." };
  const key = a.sheetUrl + "|" + a.photoPattern;
  if (!force && sheetCache.key === key && Date.now() - sheetCache.at < 120000) return sheetCache;
  const id = (a.sheetUrl.match(/\/d\/([\w-]+)/) || [])[1], gid = (a.sheetUrl.match(/gid=(\d+)/) || [])[1];
  try {
    if (!id) throw new Error("That doesn't look like a Google Sheets link.");
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&headers=1${gid ? "&gid=" + gid : ""}`);
    const text = await r.text();
    if (!r.ok || /^\s*</.test(text)) throw new Error("Can't read the sheet. Share it as 'Anyone with the link · Viewer'.");
    sheetCache = { key, at: Date.now(), students: groupResults(toStudents(parseCSV(text), a.photoPattern)), error: null };
  } catch (e) {
    sheetCache = { key, at: Date.now(), students: sheetCache.key === key ? sheetCache.students : [], error: e.message };
  }
  return sheetCache;
}
// Leaderboards change slowly (a day's worth of events at most), but /api/playlist is hit by the TV
// every 30s. Cache for 10 minutes and keep serving the last good copy if the rewards DB is briefly
// unreachable — a stale board on screen beats a gap in the rotation.
let boardCache = { key: "", at: 0, boards: [], errors: [] };
// Students upload marksheets and earn coins through the day, so the boards are refreshed on a
// timer rather than only when a request happens to arrive. Polling here also keeps the database
// round-trip off the TV's request path: the player asks every 30s and gets whatever is already warm.
const BOARD_TTL_MS = 5 * 60_000;

async function getBoards(b, force = false) {
  if (!b.enabled) return { boards: [], errors: [] };
  const key = (b.show || []).join(",");
  if (!force && boardCache.key === key && Date.now() - boardCache.at < BOARD_TTL_MS) return boardCache;
  try {
    const { boards, errors } = await fetchBoards(b.show);
    // Only replace the cache when we actually got something; otherwise keep the last good boards.
    if (boards.length || !boardCache.boards.length) boardCache = { key, at: Date.now(), boards, errors };
    else boardCache = { ...boardCache, key, at: Date.now(), errors };
  } catch (e) {
    boardCache = { ...boardCache, key, at: Date.now(), errors: [{ key: "all", error: e.message }] };
  }
  return boardCache;
}

// Kept unref'd so it never holds the process open, and errors are swallowed: getBoards already
// keeps the last good standings when a refresh fails, so a flaky database just means stale rows.
setInterval(async () => {
  try {
    const s = await loadSettings();
    if (s.boards && s.boards.enabled) await getBoards(s.boards, true);
  } catch {}
}, BOARD_TTL_MS).unref();

const achieversFor = (a, students) => {
  const test = a.test || latestTest(students);
  return students.filter((s) => s.exam === test && (!a.cls || s.cls === a.cls) && s.pct >= a.minPercent && !a.hidden.includes(s.key)).sort((x, y) => y.pct - x.pct);
};

// ---------- app ----------
const app = express();
app.disable("x-powered-by");
app.use(express.json());

// Static: player + admin UI, and uploaded media (with range support for video seeking)
app.use(express.static(path.join(__dirname, "public"), { index: false }));
app.use("/media", express.static(UPLOAD_DIR, { maxAge: "365d", immutable: true, acceptRanges: true }));

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "display.html")));
app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/studio", (_req, res) => res.sendFile(path.join(__dirname, "public", "studio.html")));

// --- auth ---
app.post("/api/login", loginLimiter, (req, res) => {
  const { password } = req.body || {};
  const a = Buffer.from(String(password || ""));
  const b = Buffer.from(ADMIN_PASSWORD);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: "Wrong password" });
  const secure = req.headers["x-forwarded-proto"] === "https" || req.secure;
  res.setHeader("Set-Cookie",
    `qd_session=${makeToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure ? "; Secure" : ""}`);
  res.json({ ok: true });
});
app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "qd_session=; Path=/; HttpOnly; Max-Age=0");
  res.json({ ok: true });
});
app.get("/api/me", (req, res) => res.json({ signedIn: verifyToken(parseCookies(req).qd_session) }));
// Invalidates every other signed-in session (e.g. if the shared password was exposed) by bumping the epoch,
// then re-signs the caller in on the new epoch so they aren't locked out by their own click.
app.post("/api/revoke-sessions", requireAuth, async (req, res) => {
  await revokeAllSessions();
  const secure = req.headers["x-forwarded-proto"] === "https" || req.secure;
  res.setHeader("Set-Cookie",
    `qd_session=${makeToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure ? "; Secure" : ""}`);
  res.json({ ok: true });
});

// --- public: what the TV plays ---
app.get("/api/playlist", async (_req, res) => {
  const [list, settings] = await Promise.all([readJson(MEDIA_FILE, []), loadSettings()]);
  const uploads = list.filter((m) => m.enabled).map((m) => ({
    id: m.id, type: m.type, url: `/media/${m.file}`, duration: m.duration ?? null, caption: m.caption || "",
    priority: m.priority || 1,
  }));
  const a = settings.achievers;
  const bcfg = settings.boards;
  const ach = a.enabled ? achieversFor(a, (await getStudents(a)).students) : [];
  const boards = (await getBoards(bcfg)).boards;
  // Deal the deck by kind instead of walking the upload list and dropping extras in by modulo.
  // Uploads arrive in batches, so that older scheme put every video together and every photo
  // together — a reception sees one long block of clips, then a long block of stills. Dealing
  // round-robin from separate piles keeps videos, photos, leaderboards and achiever cards
  // alternating, so whenever someone looks up the screen has changed character.
  // A slide can be worth seeing more than once a cycle. Results and the coin leaderboards are
  // what a waiting parent actually wants, but one pass of ~22 minutes means a ten-minute wait
  // shows them under half the deck. Repeating those few beats padding the deck with weaker
  // filler. Each copy is positioned a full 1/priority around the cycle from its siblings, so
  // repeats land far apart wherever the item happens to sit in the upload list.
  const weigh = (m) => Math.max(1, Math.min(3, Math.round(Number(m.priority)) || 1));
  const bRepeat = Math.max(1, Math.min(3, Math.round(Number(bcfg.repeat)) || 1));
  const lanes = [
    { items: uploads.filter((m) => m.type === "video"), weight: null },
    { items: uploads.filter((m) => m.type !== "video"), weight: null },
    { items: boards.map((b) => ({ id: "board-" + b.key, type: "board", duration: bcfg.duration, board: b })), weight: bRepeat },
    { items: ach.map((s) => ({ id: "ach-" + s.key, type: "achiever", duration: a.duration, student: s })), weight: null },
  ].filter((l) => l.items.length);

  const items = [];
  if (ach.length >= 2) items.push({ id: "recap", type: "recap", duration: a.recapDuration, students: ach, minPercent: a.minPercent });
  if (lanes.length) {
    // Spread each lane evenly across the whole cycle, then order by that position. A lane with
    // 16 videos and one with 4 boards both end up evenly distributed rather than front-loaded.
    const slotted = [];
    lanes.forEach((lane, li) => {
      // Group a lane by weight before positioning. The result banners were uploaded together, so
      // in raw upload order they sit side by side and their repeats would land side by side too.
      // Spreading each weight group across its own full turn of the cycle fixes that.
      const groups = new Map();
      lane.items.forEach((item) => {
        const w = lane.weight || weigh(item);
        if (!groups.has(w)) groups.set(w, []);
        groups.get(w).push(item);
      });
      groups.forEach((group, w) => {
        // Lay the group's copies out as one evenly spaced run of n*w slots, with each item's
        // copies exactly n slots apart. Offsetting by a flat 1/w instead would drop one copy
        // straight onto a sibling's slot, which is what paired them up.
        const n = group.length;
        group.forEach((item, i) => {
          for (let j = 0; j < w; j++) {
            const pos = (j * n + i + 0.5) / (n * w);
            slotted.push({ item: j === 0 ? item : { ...item, id: item.id + "-r" + j }, pos, li });
          }
        });
      });
    });
    slotted.sort((x, y) => x.pos - y.pos || x.li - y.li);
    // Two videos back to back is the one pairing worth avoiding: they are the longest items, so
    // the screen would sit on the same kind of content for minutes. Push the later one along.
    for (let i = 1; i < slotted.length; i++) {
      if (slotted[i].item.type !== "video" || slotted[i - 1].item.type !== "video") continue;
      const j = slotted.findIndex((s, k) => k > i && s.item.type !== "video");
      if (j > -1) slotted.splice(i, 0, slotted.splice(j, 1)[0]);
    }
    slotted.forEach((s) => items.push(s.item));
  }
  // Public endpoint: don't leak the results-sheet URL, QLASS IDs, or internal grouping fields to anyone with this link.
  const publicStudent = (s) => {
    const { id, date, subjectRaw, sumM, sumT, inSubj, ...pub } = s;
    return pub;
  };
  const publicItems = items.map((it) => it.student ? { ...it, student: publicStudent(it.student) }
    : it.students ? { ...it, students: it.students.map(publicStudent) } : it);
  const publicSettings = { imageDuration: settings.imageDuration, transition: settings.transition, videoSound: settings.videoSound,
    volume: settings.volume, audioCompressor: settings.audioCompressor,
    shuffle: settings.shuffle, refreshInterval: settings.refreshInterval, contact: settings.contact };
  const version = crypto.createHash("md5").update(JSON.stringify({ items: publicItems, settings: publicSettings })).digest("hex");
  res.setHeader("Cache-Control", "no-store");
  res.json({ version, settings: publicSettings, items: publicItems });
});

// --- TV client-side diagnostics (display.html's on-screen log also ships here, so debugging an
// unattended TV never needs a photo of the screen) ---
const MAX_CLIENT_LOG_ENTRIES = 2000; // caps file size over long unattended uptime
let clientLogChain = Promise.resolve(); // serializes writes, same pattern as withMedia
function appendClientLog(session, entries) {
  clientLogChain = clientLogChain.then(async () => {
    const log = await readJson(CLIENT_LOG_FILE, []);
    for (const e of entries) {
      log.push({
        session: String(session || "").slice(0, 40),
        t: Number.isFinite(e.t) ? e.t : Date.now(),
        level: ["ok", "info", "warn", "error"].includes(e.level) ? e.level : "info",
        label: String(e.label || "").slice(0, 300),
        detail: String(e.detail || "").slice(0, 1000),
        receivedAt: new Date().toISOString(),
      });
    }
    if (log.length > MAX_CLIENT_LOG_ENTRIES) log.splice(0, log.length - MAX_CLIENT_LOG_ENTRIES);
    await writeJson(CLIENT_LOG_FILE, log);
  });
  return clientLogChain;
}
// No auth: this is the unattended TV itself posting, which has no session cookie, and the payload
// is just operational status text (slide positions, play() outcomes) — nothing sensitive.
app.post("/api/client-log", async (req, res) => {
  const { session, entries } = req.body || {};
  if (!Array.isArray(entries) || !entries.length) return res.status(400).json({ error: "entries required" });
  await appendClientLog(session, entries.slice(0, 300)); // also capped per-request, mirrors the client's own MAX_PENDING
  res.json({ ok: true });
});
app.get("/api/client-log", requireAuth, async (req, res) => {
  const log = await readJson(CLIENT_LOG_FILE, []);
  const limit = Math.min(Number(req.query.limit) || 300, MAX_CLIENT_LOG_ENTRIES);
  res.json(log.slice(-limit));
});
app.delete("/api/client-log", requireAuth, async (_req, res) => { await writeJson(CLIENT_LOG_FILE, []); res.json({ ok: true }); });

// --- admin: achievers ---
app.get("/api/achievers", requireAuth, async (req, res) => {
  const settings = await loadSettings(), a = settings.achievers;
  const { students, error } = await getStudents(a, req.query.refresh === "1");
  res.json({
    settings: a, contact: settings.contact, error,
    students: students.map((s) => ({ ...s, qualifies: s.pct >= a.minPercent, hidden: a.hidden.includes(s.key) })),
  });
});

// --- admin: media management ---
app.get("/api/media", requireAuth, async (_req, res) => res.json(await readJson(MEDIA_FILE, [])));

app.post("/api/media", requireAuth, (req, res) => {
  upload.array("files", 50)(req, res, async (err) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? `File too large (limit ${MAX_UPLOAD_MB} MB)` : err.message;
      return res.status(400).json({ error: msg });
    }
    const added = await withMedia((list) => {
      const out = [];
      for (const f of req.files || []) {
        const kind = classify(f);
        const item = {
          id: crypto.randomUUID(),
          file: f.filename,
          originalName: f.originalname,
          type: kind.type,
          mime: kind.mime,
          size: f.size,
          duration: null,      // null = use default image duration (videos play to the end)
          caption: "",
          enabled: true,
          uploadedAt: new Date().toISOString(),
        };
        list.push(item);
        out.push(item);
      }
      return out;
    });
    res.json(added);
  });
});

app.patch("/api/media/:id", requireAuth, async (req, res) => {
  const item = await withMedia((list) => {
    const m = list.find((x) => x.id === req.params.id);
    if (!m) return null;
    const b = req.body || {};
    if ("enabled" in b) m.enabled = Boolean(b.enabled);
    if ("caption" in b) m.caption = String(b.caption).slice(0, 200);
    if ("priority" in b) {
      const n = Number(b.priority);
      m.priority = Number.isFinite(n) ? Math.max(1, Math.min(3, Math.round(n))) : 1;
    }
    if ("duration" in b) {
      const d = Number(b.duration);
      m.duration = b.duration === null || b.duration === "" || !Number.isFinite(d) || d <= 0 ? null : Math.min(d, 3600);
    }
    return m;
  });
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});

app.put("/api/media/order", requireAuth, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const list = await withMedia((list) => {
    const byId = new Map(list.map((m) => [m.id, m]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
    const rest = list.filter((m) => !ids.includes(m.id));
    list.splice(0, list.length, ...ordered, ...rest);
    return list;
  });
  res.json(list);
});

app.delete("/api/media/:id", requireAuth, async (req, res) => {
  const removed = await withMedia((list) => {
    const i = list.findIndex((x) => x.id === req.params.id);
    if (i < 0) return null;
    return list.splice(i, 1)[0];
  });
  if (!removed) return res.status(404).json({ error: "Not found" });
  fsp.unlink(path.join(UPLOAD_DIR, removed.file)).catch(() => {});
  res.json({ ok: true });
});

// --- admin: settings ---
app.get("/api/settings", requireAuth, async (_req, res) => res.json(await loadSettings()));
app.put("/api/settings", requireAuth, async (req, res) => {
  const cur = await loadSettings();
  const b = req.body || {};
  if ("imageDuration" in b) cur.imageDuration = Math.min(Math.max(Number(b.imageDuration) || 10, 1), 3600);
  if ("transition" in b) cur.transition = b.transition === "none" ? "none" : "fade";
  if ("videoSound" in b) cur.videoSound = Boolean(b.videoSound);
  if ("volume" in b) cur.volume = Math.min(Math.max(Number(b.volume) || 0, 0), 100);
  if (b.boards && typeof b.boards === "object") {
    const bd = cur.boards;
    if ("enabled" in b.boards) bd.enabled = Boolean(b.boards.enabled);
    if ("duration" in b.boards) bd.duration = Math.min(Math.max(Number(b.boards.duration) || 14, 4), 120);
    if ("every" in b.boards) bd.every = Math.min(Math.max(Number(b.boards.every) || 4, 1), 50);
    if ("repeat" in b.boards) bd.repeat = Math.min(Math.max(Math.round(Number(b.boards.repeat)) || 1, 1), 3);
    if (Array.isArray(b.boards.show)) bd.show = b.boards.show.filter((k) => k in BOARDS);
  }
  if ("audioCompressor" in b) cur.audioCompressor = Boolean(b.audioCompressor);
  if ("shuffle" in b) cur.shuffle = Boolean(b.shuffle);
  if ("refreshInterval" in b) cur.refreshInterval = Math.min(Math.max(Number(b.refreshInterval) || 30, 5), 3600);
  if ("contact" in b) cur.contact = String(b.contact).slice(0, 120);
  if (b.achievers && typeof b.achievers === "object") {
    const x = b.achievers, a = cur.achievers;
    if ("enabled" in x) a.enabled = Boolean(x.enabled);
    if ("sheetUrl" in x) a.sheetUrl = String(x.sheetUrl).trim().slice(0, 500);
    if ("photoPattern" in x) a.photoPattern = String(x.photoPattern).trim().slice(0, 500);
    if ("minPercent" in x) a.minPercent = Math.min(Math.max(Number(x.minPercent) || 0, 0), 100);
    if ("every" in x) a.every = Math.min(Math.max(Number(x.every) || 2, 1), 50);
    if ("duration" in x) a.duration = Math.min(Math.max(Number(x.duration) || 10, 3), 600);
    if ("recapDuration" in x) a.recapDuration = Math.min(Math.max(Number(x.recapDuration) || 12, 3), 600);
    if ("test" in x) a.test = String(x.test).slice(0, 200);
    if ("cls" in x) a.cls = String(x.cls).slice(0, 100);
    if (Array.isArray(x.hidden)) a.hidden = x.hidden.map(String).slice(0, 5000);
  }
  await writeJson(SETTINGS_FILE, cur);
  res.json(cur);
});

// --- admin: Meta (Instagram insights + ad campaigns) ---
// Configured via META_* env vars; see meta/README.md. Everything here is read-only except pause.
app.get("/api/meta/report", requireAuth, requireMetaAuth, async (req, res, next) => {
  try {
    const r = await metaSnapshot.report(Math.min(Math.max(Number(req.query.days) || 7, 1), 90));
    res.json({ configured: metaGraph.isConfigured(), ...r });
  } catch (e) { next(e); }
});
app.post("/api/meta/snapshot", requireAuth, requireMetaAuth, async (_req, res) => {
  try { const s = await metaSnapshot.take(); res.json({ ok: true, date: s.date, media: s.media.length, errors: s.errors }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.get("/api/meta/daily", requireAuth, requireMetaAuth, async (req, res, next) => {
  try {
    const r = await metaSnapshot.dailyBreakdown(Math.min(Math.max(Number(req.query.days) || 7, 1), 30));
    res.json({ configured: metaGraph.isConfigured(), ...r });
  } catch (e) { next(e); }
});
app.get("/api/meta/ads", requireAuth, requireMetaAuth, async (_req, res) => {
  if (!metaGraph.isConfigured()) return res.json({ configured: false });
  try { res.json({ configured: true, ...(await metaAds.status()) }); }
  catch (e) { res.status(502).json({ error: e.message, code: e.code }); }
});
app.post("/api/meta/ads/pause-all", requireAuth, requireMetaAuth, async (_req, res) => {
  try { res.json(await metaAds.pauseAll()); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.post("/api/meta/ads/:id/:action", requireAuth, requireMetaAuth, async (req, res) => {
  if (!/^\d+$/.test(req.params.id) || !["pause", "resume"].includes(req.params.action)) return res.status(400).json({ error: "bad request" });
  try { res.json(await metaAds.setStatus(req.params.id, req.params.action === "pause" ? "PAUSED" : "ACTIVE")); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// Take one snapshot per day (after META_SNAPSHOT_HOUR local time, default 22:00 Asia/Kolkata).
// Also run from cron if you prefer: node meta/snapshot.js take
if (metaGraph.isConfigured()) {
  const HOUR = Number(process.env.META_SNAPSHOT_HOUR ?? 22);
  const tick = async () => {
    try {
      const now = new Date();
      const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: metaGraph.config.timezone, hour: "2-digit", hour12: false }).format(now));
      const today = metaGraph.todayKey(now);
      if (hour < HOUR) return;
      if ((await metaSnapshot.listSnapshots()).includes(today)) return;
      const s = await metaSnapshot.take();
      console.log(`[meta] snapshot ${s.date}: ${s.media.length} media, followers ${s.account?.followers ?? "-"}${s.errors.length ? " · " + s.errors.join("; ") : ""}`);
    } catch (e) { console.error("[meta] snapshot failed:", e.message); }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, 15 * 60_000).unref();
}

app.get("/favicon.ico", (_req, res) => res.status(204).end());
app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

app.listen(PORT, () => {
  console.log(`Qlass Display running on http://localhost:${PORT}`);
  console.log(`  TV player:     http://localhost:${PORT}/`);
  console.log(`  Upload portal: http://localhost:${PORT}/admin`);
  console.log(`  Social studio: http://localhost:${PORT}/studio`);
});
