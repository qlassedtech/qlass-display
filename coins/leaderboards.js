// Reads the Qlass Coins database to build the TV's leaderboard banners.
//
// That database belongs to the student rewards app, not to this one, and every table in it carries a
// zz_legacy_read_only trigger that rejects writes. Nothing here does anything but SELECT, and the pool
// is deliberately tiny — the display is one more reader alongside the app that actually owns the data.

import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { Pool } = pg;

// Photos are cached by scripts/sync-student-photos.mjs. A board only claims a portrait when the
// file is actually on disk, so a student with no photo falls back to initials rather than
// leaving a broken image on the TV.
const PHOTO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "student-photos");
// Maps student id to the cached filename, since portraits arrive as either JPEG or PNG.
//
// Students pick their own photo, and a sweep of the first 53 found anime characters, a WhatsApp QR
// code, a Minecraft screenshot, deities, scenery and three blank frames — so a cached file is not
// on its own fit to show. data/photo-review.json holds a verdict per student and only a cleared
// photo is handed to a board. An unreviewed photo counts as not cleared: this screen faces a
// public waiting room, so the default has to be initials rather than whatever was uploaded.
const REVIEW_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "photo-review.json");
let photoMap = new Map(), photoAt = 0;
function photoFile(id) {
  if (!id) return "";
  if (Date.now() - photoAt > 60_000) {
    let review = {};
    try { review = JSON.parse(fs.readFileSync(REVIEW_FILE, "utf8")); } catch {}
    try {
      photoMap = new Map(fs.readdirSync(PHOTO_DIR)
        .filter((f) => /\.(jpe?g|png)$/i.test(f))
        .map((f) => [f.replace(/\.(jpe?g|png)$/i, ""), f])
        .filter(([sid]) => review[sid] && review[sid].ok));
    } catch { photoMap = new Map(); }
    photoAt = Date.now();
  }
  return photoMap.get(id) || "";
}

const TEST_NAME_RE = /(^|\s)(test|demo|sample|dummy)(\s|$)/i;

let pool = null;
function getPool() {
  const url = process.env.QLASS_COINS_DATABASE_URL;
  if (!url) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      // Neon terminates idle pooled connections; without this a stale socket surfaces as an
      // unhandled 'error' event on the pool and takes the whole display server down with it.
      allowExitOnIdle: true,
    });
    pool.on("error", () => {});
  }
  return pool;
}

// Every banner is the same shape: a title, a unit, and ranked rows. One renderer draws them all.
export const BOARDS = {
  coins: {
    title: "Qlass Coins Leaders",
    subtitle: "Highest balance in every class",
    unit: "coins",
    layout: "cards",
    accent: "#C9A35C",
    windowDays: 0, // lifetime: students think in total balance, not a rolling window
    // Balance, not earnings — it has to match the number the student sees in the rewards app, which
    // is everything they have ever earned, less manual deductions and rewards actually handed over.
    // Requested-but-not-yet-awarded redemptions are deliberately not subtracted: the coins are still
    // theirs until the reward is given out.
    // One row per class rather than a global top-10, so younger classes aren't crowded out by
    // seniors who simply have more events to earn from.
    sql: `
      with earned as (
        select e.qlass_id, sum(e.coins_delta) as value
        from ledger_events e
        group by 1
      ), spent as (
        select qlass_id, sum(item_cost) as value
        from redemptions where awarded_at is not null
        group by 1
      ), net as (
        select earned.qlass_id, earned.value - coalesce(spent.value, 0) as value
        from earned left join spent on spent.qlass_id = earned.qlass_id
      ), ranked as (
        select s.qlass_id, s.class, s.name, net.value,
               row_number() over (partition by s.class order by net.value desc, s.name) as rn
        from net join students s on s.qlass_id = net.qlass_id
        where s.name !~* $1
      )
      select qlass_id, class, name, value from ranked where rn = 1
      order by nullif(regexp_replace(class, '\\D', '', 'g'), '')::int desc nulls last
    `,
  },
  coinsClass: {
    title: "Class Coin Champions",
    subtitle: "Top earners in one class",
    unit: "coins",
    accent: "#C9A35C",
    layout: "cards",
    windowDays: 0,
    // The per-class board shows one name from each class, which hides how deep a class runs:
    // around 160 students hold coins and only nine are ever on screen. This one spotlights a
    // single class at a time and lists its top eight, rotating to the next class every quarter
    // hour so every class gets its turn through the day rather than the same seniors always
    // winning a combined top ten. Classes with fewer than five holders sit out — a podium of
    // three is not a leaderboard.
    sql: `
      with earned as (
        select e.qlass_id, sum(e.coins_delta) as value from ledger_events e group by 1
      ), spent as (
        select qlass_id, sum(item_cost) as value from redemptions where awarded_at is not null group by 1
      ), net as (
        select earned.qlass_id, earned.value - coalesce(spent.value, 0) as value
        from earned left join spent on spent.qlass_id = earned.qlass_id
      ), holders as (
        select s.qlass_id, s.class, s.name, net.value
        from net join students s on s.qlass_id = net.qlass_id
        where s.name !~* $1 and net.value > 0
      ), eligible as (
        select class, row_number() over (
                 order by nullif(regexp_replace(class, '\\D', '', 'g'), '')::int desc nulls last
               ) as i
        from holders group by class having count(*) >= 5
      ), chosen as (
        select class from eligible
        where i = 1 + (floor(extract(epoch from now()) / 900)::bigint
                       % (select count(*) from eligible))
      ), ranked as (
        select h.qlass_id, h.class, h.name, h.value,
               row_number() over (order by h.value desc, h.name) as rn
        from holders h where h.class = (select class from chosen)
      )
      select (select class from chosen) || ' · highest balances' as subtitle,
             qlass_id, class, name, value::int as value
      from ranked where rn <= 8 order by rn
    `,
  },
  dppSubmissions: {
    title: "DPP Champions",
    subtitle: "Most daily practice papers submitted · last 7 days",
    unit: "DPPs",
    accent: "#4F9BE8",
    windowDays: 7,
    sql: `
      select s.class, s.name, count(*)::int as value
      from ledger_events e join students s on s.qlass_id = e.qlass_id
      where e.event_type = 'Subject Wise DPP Submission'
        and e.logged_at > now() - ($2 || ' days')::interval
        and s.name !~* $1
      group by s.class, s.name
      order by value desc, s.name
      limit 8
    `,
  },
  dppScores: {
    title: "DPP Top Scorers",
    subtitle: "Most 90%+ scores on daily practice · last 7 days",
    unit: "× 90%+",
    accent: "#5FBE8C",
    windowDays: 7,
    sql: `
      select s.class, s.name, count(*)::int as value
      from ledger_events e join students s on s.qlass_id = e.qlass_id
      where e.event_type = 'DPP 90% Marks'
        and e.logged_at > now() - ($2 || ' days')::interval
        and s.name !~* $1
      group by s.class, s.name
      order by value desc, s.name
      limit 8
    `,
  },
  rewards: {
    title: "Rewards Claimed",
    subtitle: "Coins turned into real rewards",
    unit: "coins",
    accent: "#B07FD4",
    windowDays: 0,
    // Shows the reward itself in place of a class, so the room sees what coins actually buy —
    // that is the whole point of the scheme and the thing a leaderboard alone never communicates.
    sql: `
      select r.item as class, s.name, r.item_cost::int as value
      from redemptions r join students s on s.qlass_id = r.qlass_id
      where s.name !~* $1
      order by r.item_cost desc, coalesce(r.awarded_at, r.flagged_at) desc nulls last, s.name
      limit 8
    `,
  },
  schoolTests: {
    title: "School Test Toppers",
    subtitle: "Best major school exam shared by each class · last 60 days",
    note: "Marks as shared by students · verified by Qlass staff",
    unit: "%",
    accent: "#5FAE86",
    windowDays: 60,
    // Students upload their own school marksheets to the rewards app; staff verify each one, and
    // only 'processed' rows are trusted here. Pending and rejected uploads never reach the screen.
    //
    // A handful of rows have obtainedMarks and fullMarks entered the wrong way round, which would
    // otherwise show as 110% on a public display. Those submissions are dropped rather than
    // silently reinterpreted — a guessed mark next to a child's name is worse than no row at all.
    //
    // Rows below 80% are left off too. This hangs in a reception where parents are waiting, and the
    // best score in a thin class can be a middling one: naming a child under "Toppers" at 45% does
    // them no favours. A class with nothing above the mark simply sits this one out.
    sql: `
      with per_exam as (
        select t.id, t.qlass_id,
               sum((sub->>'obtainedMarks')::numeric) as got,
               sum((sub->>'fullMarks')::numeric)     as total,
               bool_or((sub->>'obtainedMarks')::numeric > (sub->>'fullMarks')::numeric) as suspect
        from school_test_submissions t
             cross join lateral jsonb_array_elements(t.subjects) sub
        where t.status::text = 'processed'
          and jsonb_array_length(t.subjects) > 0
          and t.exam_date > now() - ($2 || ' days')::interval
          -- Major only: periodic tests, half-yearlies, finals. Mixing in class and chapter tests
          -- let a 10-mark quiz at 100% outrank a half-yearly at 97%, which is not a fair ranking.
          and t.exam_type = 'Major'
          -- Some marksheets carry their own 'Total' line as if it were another subject; summing
          -- it alongside the real rows counts the paper twice.
          and lower(sub->>'subject') not in ('total', 'grand total')
        group by t.id, t.qlass_id
      ), scored as (
        select s.class, s.name, round(100.0 * p.got / p.total, 0)::int as value,
               row_number() over (partition by s.class order by p.got / p.total desc, s.name) as rn
        from per_exam p join students s on s.qlass_id = p.qlass_id
        where p.total > 0 and not p.suspect and s.name !~* $1
          and p.got <= p.total
          and 100.0 * p.got / p.total >= 80
      )
      select class, name, value from scored where rn = 1
      order by nullif(regexp_replace(class, '\\D', '', 'g'), '')::int desc nulls last
      limit 8
    `,
  },
  subjectStars: {
    title: "Subject Stars",
    subtitle: "Best core-subject score in a major exam",
    note: "Marks as shared by students · verified by Qlass staff",
    unit: "%",
    accent: "#8C7BD8",
    windowDays: 180,
    // Ranked one row per student, showing their single strongest subject. Ranking per subject
    // instead put the same two names in all five slots — a handful of students top every science
    // paper, so the board read as a list of two children rather than a wall of achievement.
    //
    // Only the five subjects students actually report in volume are counted. The rest of the
    // field is free text and arrives as 'TWAU', 'Fraction' or 'FAC-1 (Mind Map)', which cannot be
    // ranked against anything.
    sql: `
      with rows_ as (
        select st.name, st.class,
               case
                 when lower(s->>'subject') in ('mathematics', 'maths', 'math') then 'Mathematics'
                 when lower(s->>'subject') = 'science'   then 'Science'
                 when lower(s->>'subject') = 'physics'   then 'Physics'
                 when lower(s->>'subject') = 'chemistry' then 'Chemistry'
                 when lower(s->>'subject') = 'biology'   then 'Biology'
               end as subj,
               (s->>'obtainedMarks')::numeric as got,
               (s->>'fullMarks')::numeric     as total
        from school_test_submissions t
             join students st on st.qlass_id = t.qlass_id
             cross join lateral jsonb_array_elements(t.subjects) s
        where t.status::text = 'processed' and t.exam_type = 'Major'
          and t.exam_date > now() - ($2 || ' days')::interval
          and st.name !~* $1
      ), best as (
        select name, class, subj, round(100.0 * got / total, 0)::int as value,
               row_number() over (partition by name order by got / total desc, subj) as rn
        from rows_
        where subj is not null and total > 0 and got <= total
      )
      select subj || ' · ' || class as class, name, value
      from best where rn = 1 and value >= 80
      order by value desc, name
      limit 8
    `,
  },
  attendance: {
    title: "Attendance Stars",
    subtitle: "Most days present · last 30 days",
    unit: "days",
    accent: "#E0795F",
    windowDays: 30,
    sql: `
      select s.class, s.name, count(distinct e.logged_at::date)::int as value
      from ledger_events e join students s on s.qlass_id = e.qlass_id
      where e.event_type in ('Daily Attendance', 'Attendance Perfect')
        and e.logged_at > now() - ($2 || ' days')::interval
        and s.name !~* $1
      group by s.class, s.name
      order by value desc, s.name
      limit 8
    `,
  },
};

export async function fetchBoard(key) {
  const spec = BOARDS[key];
  if (!spec) throw new Error(`unknown board: ${key}`);
  const p = getPool();
  if (!p) throw new Error("QLASS_COINS_DATABASE_URL is not set");
  const params = [TEST_NAME_RE.source];
  if (spec.sql.includes("$2")) params.push(String(spec.windowDays));
  const { rows } = await p.query(spec.sql, params);
  return {
    key,
    title: spec.title,
    unit: spec.unit,
    accent: spec.accent,
    note: spec.note || "",
    layout: spec.layout || "list",
    // A board whose SQL returns a subtitle column speaks for itself — the rotating class
    // spotlight has to name the class it is currently showing.
    subtitle: (rows[0] && rows[0].subtitle) || spec.subtitle,
    rows: rows.map((r, i) => ({
      rank: i + 1,
      name: r.name,
      cls: r.class,
      value: Number(r.value),
      photoUrl: photoFile(r.qlass_id) ? `/student-photos/${photoFile(r.qlass_id)}` : "",
    })),
  };
}

// One failing board must not take the others down with it — the TV shows what it can get.
export async function fetchBoards(keys) {
  const wanted = (keys && keys.length ? keys : Object.keys(BOARDS)).filter((k) => BOARDS[k]);
  const settled = await Promise.allSettled(wanted.map(fetchBoard));
  const boards = [];
  const errors = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") boards.push(r.value);
    else errors.push({ key: wanted[i], error: r.reason && r.reason.message ? r.reason.message : String(r.reason) });
  });
  return { boards, errors };
}

