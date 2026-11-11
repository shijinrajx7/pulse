// PULSE ingestion Worker. Paste into Cloudflare dashboard > Worker > Edit code.
// Variables: SUPABASE_URL (text), SUPABASE_SERVICE_KEY (secret), RUN_KEY (secret), NVD_API_KEY (optional secret)
const MAX_SOURCES_PER_RUN = 5; // free plan: keeps CPU and the 50-subrequest limit safe
const UA = "Mozilla/5.0 (compatible; PULSE/1.0)";

export default {
  async scheduled(evt, env, ctx) { ctx.waitUntil(run(env, false)); },
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === "/run" && env.RUN_KEY && u.searchParams.get("key") === env.RUN_KEY) {
      return Response.json(await run(env, true));
    }
    return new Response("PULSE worker is deployed.");
  },
};

function sb(env, path, opt = {}) {
  const k = env.SUPABASE_SERVICE_KEY;
  const h = { apikey: k, "Content-Type": "application/json", ...(opt.headers || {}) };
  if (k.startsWith("eyJ")) h.Authorization = "Bearer " + k;
  return fetch(env.SUPABASE_URL + "/rest/v1/" + path, { ...opt, headers: h });
}

async function run(env, force) {
  const r = await sb(env, "sources?enabled=eq.true&select=*&order=last_run_at.asc.nullsfirst");
  if (!r.ok) return { error: "supabase " + r.status + " " + (await r.text()).slice(0, 200) };
  const now = Date.now();
  const due = (await r.json())
    .filter((s) => force || !s.last_run_at || now - Date.parse(s.last_run_at) >= s.interval_min * 60000)
    .slice(0, MAX_SOURCES_PER_RUN);
  const out = [];
  for (const s of due) out.push(await one(env, s));
  // keep the free database small: drop events older than 30 days
  await sb(env, "events?detected_at=lt." + new Date(now - 30 * 864e5).toISOString(), { method: "DELETE" });
  return out;
}

async function one(env, s) {
  const t0 = Date.now();
  const patch = { last_run_at: new Date().toISOString() };
  let n = 0, err = null;
  try {
    const items = await CON[s.type](s, env);
    const t = new Date().toISOString();
    const map = new Map();
    for (const i of items) {
      if (!i.title || !i.url) continue;
      const key = (i.platform ? i.platform + ":" : "") + canon(i.url);
      map.set(await sha(key), i);
    }
    const rows = [...map].map(([h, i]) => ({
      source_id: s.id, url: i.url, url_hash: h, title: i.title.slice(0, 300),
      summary: i.summary ? i.summary.slice(0, 600) : null,
      category: s.category, region: s.region, label: s.label,
      platform: i.platform || null, severity: i.severity || null,
      score: i.score ?? null, published_at: i.published || null,
      processed_at: t, meta: i.meta || {},
    }));
    if (rows.length) {
      const r = await sb(env, "events?on_conflict=url_hash", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows),
      });
      if (!r.ok) throw new Error("db " + r.status + " " + (await r.text()).slice(0, 150));
    }
    n = rows.length;
    Object.assign(patch, { status: "operational", last_success_at: t, failures: 0, last_error: null,
      last_latency_ms: Date.now() - t0, items_last_run: n });
  } catch (e) {
    err = String(e.message || e);
    const f = (s.failures || 0) + 1;
    Object.assign(patch, { failures: f, last_error: err.slice(0, 300), last_latency_ms: Date.now() - t0,
      status: /429/.test(err) ? "rate_limited" : f >= 3 ? "offline" : "degraded" });
  }
  await sb(env, "sources?id=eq." + s.id, { method: "PATCH", body: JSON.stringify(patch) });
  return { source: s.name, items: n, error: err, ms: Date.now() - t0 };
}

async function get(url, h = {}) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*", ...h }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r;
}

const CON = {
  async rss(s) {
    const x = (await (await get(s.url)).text()).slice(0, 300000);
    return parseFeed(x);
  },
  async hackernews(s) {
    const j = await (await get(s.url)).json();
    return j.hits.filter((h) => h.points >= 50).map((h) => {
      const hn = "https://news.ycombinator.com/item?id=" + h.objectID;
      return { title: h.title, url: h.url || hn, platform: "hackernews", score: h.points,
        summary: h.points + " points, " + h.num_comments + " comments on Hacker News",
        published: h.created_at, meta: { discussion: hn, comments: h.num_comments } };
    });
  },
  async cisa_kev(s) {
    const j = await (await get(s.url)).json();
    return j.vulnerabilities.sort((a, b) => b.dateAdded.localeCompare(a.dateAdded)).slice(0, 25).map((v) => ({
      title: v.cveID + " – " + v.vendorProject + " " + v.product + ": " + v.vulnerabilityName,
      url: "https://nvd.nist.gov/vuln/detail/" + v.cveID,
      summary: v.shortDescription + " Required action: " + v.requiredAction,
      published: v.dateAdded + "T00:00:00Z",
      meta: { cve: v.cveID, known_exploited: true, ransomware_use: v.knownRansomwareCampaignUse, due: v.dueDate },
    }));
  },
  async nvd(s, env) {
    const f = (d) => new Date(d).toISOString().slice(0, -1);
    const e = Date.now();
    const u = s.url + (s.url.includes("?") ? "&" : "?") + "pubStartDate=" + f(e - 864e5) + "&pubEndDate=" + f(e);
    const j = await (await get(u, env.NVD_API_KEY ? { apiKey: env.NVD_API_KEY } : {})).json();
    return (j.vulnerabilities || []).map(({ cve: c }) => {
      const m = c.metrics || {};
      const d = (m.cvssMetricV31 || m.cvssMetricV40 || m.cvssMetricV30 || [])[0]?.cvssData;
      const desc = (c.descriptions || []).find((x) => x.lang === "en")?.value || "";
      const sev = d?.baseSeverity && ["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(d.baseSeverity) ? d.baseSeverity : null;
      return { title: c.id + " – " + desc.slice(0, 110), url: "https://nvd.nist.gov/vuln/detail/" + c.id,
        summary: desc, published: c.published ? c.published + "Z" : null, severity: sev,
        score: d?.baseScore ?? null, meta: { cve: c.id, cvss: d?.baseScore ?? null } };
    });
  },
};

function clean(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, " ").trim();
}
function tag(x, n) {
  const m = x.match(new RegExp("<" + n + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + n + ">", "i"));
  return m ? clean(m[1]) : "";
}
function parseFeed(xml) {
  return xml.split(/<(?:item|entry)[\s>]/i).slice(1, 26).map((c) => {
    const link = tag(c, "link") || (c.match(/<link[^>]*?href=["']([^"']+)["']/i) || [])[1] || "";
    const d = Date.parse(tag(c, "pubDate") || tag(c, "published") || tag(c, "updated") || tag(c, "dc:date"));
    return { title: tag(c, "title"), url: link.trim(), summary: tag(c, "description") || tag(c, "summary") || tag(c, "content"),
      published: isNaN(d) ? null : new Date(d).toISOString() };
  });
}
function canon(u) {
  try {
    const x = new URL(u); x.hash = "";
    [...x.searchParams.keys()].forEach((k) => /^(utm_|fbclid$|gclid$|ref$)/.test(k) && x.searchParams.delete(k));
    return x.toString();
  } catch { return u; }
}
async function sha(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
