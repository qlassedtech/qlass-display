// Reads the Qlass Coins database to build the TV's leaderboard banners.
//
// That database belongs to the student rewards app, not to this one, and every table in it carries a
// zz_legacy_read_only trigger that rejects writes. Nothing here does anything but SELECT, and the pool
// is deliberately tiny — the display is one more reader alongside the app that actually owns the data.

import pg from "pg";
const { Pool } = pg;

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
        select s.class, s.name, net.value,
               row_number() over (partition by s.class order by net.value desc, s.name) as rn
        from net join students s on s.qlass_id = net.qlass_id
        where s.name !~* $1
      )
      select class, name, value from ranked where rn = 1
      order by nullif(regexp_replace(class, '\\D', '', 'g'), '')::int desc nulls last
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
    subtitle: "Best school result shared by each class · last 60 days",
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
    subtitle: spec.subtitle,
    unit: spec.unit,
    accent: spec.accent,
    rows: rows.map((r, i) => ({
      rank: i + 1,
      name: r.name,
      cls: r.class,
      value: Number(r.value),
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

