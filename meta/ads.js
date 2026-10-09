#!/usr/bin/env node
// Marketing API helpers + CLI.
//   node meta/ads.js status            account balance, every campaign, status, budget, spend
//   node meta/ads.js spend [days]      day-by-day spend per campaign (default 7 days)
//   node meta/ads.js pause-all         set every ACTIVE campaign to PAUSED
//   node meta/ads.js pause <id>        pause one campaign
//   node meta/ads.js resume <id>       re-activate one campaign
//   node meta/ads.js leads [days]      leads from lead-form ads (needs leads_retrieval)
//   node meta/ads.js token             show what the current token can do and when it expires
//   node meta/ads.js token-exchange <short-lived-token>   -> 60-day token (needs APP_ID/SECRET)
import "./env.js";
import { config, get, post, getAll, money } from "./graph.js";

const ACT = () => {
  if (!config.adAccountId) throw new Error("META_AD_ACCOUNT_ID is not set (e.g. 4362790727384695).");
  return config.adAccountId;
};

export async function account() {
  return get(`/${ACT()}`, {
    fields: "id,name,account_status,currency,balance,amount_spent,spend_cap,funding_source_details,timezone_name",
  });
}

export async function campaigns() {
  return getAll(`/${ACT()}/campaigns`, {
    fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,created_time,updated_time,start_time,stop_time",
  });
}

/** Spend per campaign per day for the last `days` days (inclusive of today). */
export async function spendByDay(days = 7) {
  return getAll(`/${ACT()}/insights`, {
    level: "campaign",
    fields: "campaign_id,campaign_name,spend,impressions,reach,clicks,actions",
    date_preset: days <= 1 ? "today" : days <= 7 ? "last_7d" : days <= 14 ? "last_14d" : days <= 28 ? "last_28d" : "last_30d",
    time_increment: 1,
  });
}

/** Total spend per campaign since creation. */
export async function spendLifetime() {
  return getAll(`/${ACT()}/insights`, {
    level: "campaign", fields: "campaign_id,campaign_name,spend,impressions,clicks", date_preset: "maximum",
  });
}

export async function setStatus(campaignId, status) {
  return post(`/${campaignId}`, { status });
}

export async function pauseAll() {
  const all = await campaigns();
  const active = all.filter((c) => c.status === "ACTIVE");
  const results = [];
  for (const c of active) {
    try { await setStatus(c.id, "PAUSED"); results.push({ id: c.id, name: c.name, ok: true }); }
    catch (e) { results.push({ id: c.id, name: c.name, ok: false, error: e.message }); }
  }
  return { paused: results, alreadyOff: all.length - active.length };
}

/** Everything the admin UI needs in one call. */
export async function status() {
  const [acct, camps, life] = await Promise.all([account(), campaigns(), spendLifetime().catch(() => [])]);
  const spent = Object.fromEntries(life.map((r) => [r.campaign_id, r]));
  const cur = acct.currency || "INR";
  return {
    account: {
      id: acct.id, name: acct.name, currency: cur, status: acct.account_status,
      // `balance` is the amount owed (in cents). For prepaid accounts the funding source shows the balance text.
      owed: Number(acct.balance || 0) / 100,
      amountSpent: Number(acct.amount_spent || 0) / 100,
      funding: acct.funding_source_details?.display_string || acct.funding_source_details?.type || "",
    },
    campaigns: camps.map((c) => ({
      id: c.id, name: c.name, status: c.status, effective: c.effective_status, objective: c.objective,
      budget: c.daily_budget ? `${money(c.daily_budget / 100, cur)}/day` : c.lifetime_budget ? `${money(c.lifetime_budget / 100, cur)} lifetime` : "ad set budget",
      spent: Number(spent[c.id]?.spend || 0),
      impressions: Number(spent[c.id]?.impressions || 0),
      clicks: Number(spent[c.id]?.clicks || 0),
      updated: c.updated_time,
    })).sort((a, b) => (a.status === "ACTIVE" ? -1 : 1) - (b.status === "ACTIVE" ? -1 : 1) || b.spent - a.spent),
  };
}

/** Leads from lead forms on the connected Page (needs META_PAGE_ID + leads_retrieval). */
export async function leads(days = 30) {
  if (!config.pageId) throw new Error("META_PAGE_ID is not set.");
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const forms = await getAll(`/${config.pageId}/leadgen_forms`, { fields: "id,name,status,leads_count" }, { token: config.pageToken });
  const out = [];
  for (const f of forms) {
    const rows = await getAll(`/${f.id}/leads`, { fields: "id,created_time,field_data,ad_id,ad_name,campaign_name", filtering: [{ field: "time_created", operator: "GREATER_THAN", value: since }] }, { token: config.pageToken });
    for (const r of rows) {
      out.push({ form: f.name, id: r.id, time: r.created_time, campaign: r.campaign_name, ad: r.ad_name,
        ...Object.fromEntries((r.field_data || []).map((x) => [x.name, (x.values || []).join(", ")])) });
    }
  }
  return out;
}

export async function tokenInfo() {
  const me = await get("/me", { fields: "id,name" }).catch((e) => ({ error: e.message }));
  let debug = null;
  if (config.appId && config.appSecret) {
    debug = await get("/debug_token", { input_token: config.token }, { token: `${config.appId}|${config.appSecret}` }).then((r) => r.data).catch((e) => ({ error: e.message }));
  }
  const perms = await getAll("/me/permissions").catch(() => []);
  return { me, debug, permissions: perms.filter((p) => p.status === "granted").map((p) => p.permission) };
}

export async function exchangeToken(shortToken) {
  if (!config.appId || !config.appSecret) throw new Error("META_APP_ID and META_APP_SECRET are required.");
  return get("/oauth/access_token", {
    grant_type: "fb_exchange_token", client_id: config.appId, client_secret: config.appSecret, fb_exchange_token: shortToken,
  }, { token: shortToken });
}

// ---------------- CLI ----------------
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const [cmd = "status", arg] = process.argv.slice(2);
  const pad = (s, n) => String(s ?? "").padEnd(n).slice(0, n);
  try {
    if (cmd === "status") {
      const s = await status();
      console.log(`Ad account ${s.account.id} (${s.account.name}) · ${s.account.funding || "funding: n/a"} · owed ${money(s.account.owed, s.account.currency)} · lifetime spend ${money(s.account.amountSpent, s.account.currency)}\n`);
      console.log(pad("STATUS", 9) + pad("CAMPAIGN", 48) + pad("BUDGET", 22) + pad("SPENT", 12) + "ID");
      for (const c of s.campaigns) console.log(pad(c.status, 9) + pad(c.name, 48) + pad(c.budget, 22) + pad(money(c.spent, s.account.currency), 12) + c.id);
    } else if (cmd === "spend") {
      const rows = await spendByDay(Number(arg) || 7);
      const total = {};
      for (const r of rows) {
        console.log(`${r.date_start}  ${pad(r.campaign_name, 48)} ${money(r.spend)}  ${r.impressions} impr  ${r.clicks} clicks`);
        total[r.date_start] = (total[r.date_start] || 0) + Number(r.spend);
      }
      console.log("\nPer day:"); for (const [d, v] of Object.entries(total)) console.log(`  ${d}  ${money(v)}`);
    } else if (cmd === "pause-all") {
      const r = await pauseAll();
      for (const p of r.paused) console.log(`${p.ok ? "paused " : "FAILED "} ${p.name} (${p.id})${p.error ? " – " + p.error : ""}`);
      console.log(`${r.paused.length} paused, ${r.alreadyOff} were already off.`);
    } else if (cmd === "pause" || cmd === "resume") {
      if (!arg) throw new Error(`usage: ${cmd} <campaign id>`);
      console.log(await setStatus(arg, cmd === "pause" ? "PAUSED" : "ACTIVE"));
    } else if (cmd === "leads") {
      const rows = await leads(Number(arg) || 30);
      console.log(JSON.stringify(rows, null, 2)); console.error(`${rows.length} leads`);
    } else if (cmd === "token") {
      const t = await tokenInfo();
      console.log(JSON.stringify(t, null, 2));
      if (t.debug?.expires_at) console.log(`Expires: ${t.debug.expires_at === 0 ? "never" : new Date(t.debug.expires_at * 1000).toISOString()}`);
    } else if (cmd === "token-exchange") {
      if (!arg) throw new Error("usage: token-exchange <short-lived token>");
      const r = await exchangeToken(arg);
      console.log(`META_ACCESS_TOKEN=${r.access_token}\n# expires in ${Math.round((r.expires_in || 0) / 86400)} days`);
    } else {
      console.log("commands: status | spend [days] | pause-all | pause <id> | resume <id> | leads [days] | token | token-exchange <token>");
    }
  } catch (e) {
    console.error(`Error: ${e.message}${e.code ? ` (code ${e.code}${e.subcode ? "/" + e.subcode : ""})` : ""}`);
    process.exit(1);
  }
}
