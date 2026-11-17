import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import webpush from "npm:web-push@3.6.7";

const secret = Deno.env.get("PULSE_PUSH_SECRET") || "";
const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const privateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
const supabase = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_KEY") || "", { auth: { persistSession: false, autoRefreshToken: false } });

function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }); }
function priorityOf(event: any): "breaking" | "important" | "general" | "low" {
  const override = String(event?.meta?.pulse_priority || "").toLowerCase();
  if (["breaking", "important", "general", "low"].includes(override)) return override as any;
  const severity = String(event?.severity || "").toUpperCase();
  const cvss = Number(event?.meta?.cvss ?? event?.score);
  if (event?.meta?.known_exploited === true || severity === "CRITICAL" || (Number.isFinite(cvss) && cvss >= 9)) return "important";
  if (severity === "HIGH" || (Number.isFinite(cvss) && cvss >= 7) || /zero.day|ransomware|confirmed breach|major outage|service disruption|urgent security advisory/i.test(String(event?.title || "") + " " + String(event?.summary || ""))) return "important";
  if (["social", "early"].includes(String(event?.category || "").toLowerCase())) return "low";
  return "general";
}
function quietNow(prefs: any) {
  const start = String(prefs?.quietStart || ""), end = String(prefs?.quietEnd || ""), zone = String(prefs?.timezone || "Asia/Kolkata");
  if (!start || !end || start === end) return false;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
    const now = Number(parts.find((p) => p.type === "hour")?.value) * 60 + Number(parts.find((p) => p.type === "minute")?.value);
    const toMin = (s: string) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };
    const a = toMin(start), b = toMin(end);
    if (a < 0 || b < 0) return false;
    return a < b ? now >= a && now < b : now >= a || now < b;
  } catch { return false; }
}
function enabled(prefs: any, priority: string, category: string) {
  const levels = prefs?.priorities || { breaking: true, important: true, general: true, low: false };
  const categories = prefs?.categories;
  if (levels[priority] === false) return false;
  if (levels[priority] === undefined && priority === "low") return false;
  if (Array.isArray(categories) && categories.length && !categories.includes(category)) return false;
  return true;
}
async function sendWithRetry(subscription: any, payload: string, urgency: string) {
  let last: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await webpush.sendNotification(subscription, payload, { TTL: 3600, urgency }); }
    catch (error: any) {
      last = error;
      const status = Number(error?.statusCode || 0);
      if (status === 404 || status === 410) throw error;
      if (attempt === 2 || (status && status < 500 && status !== 429)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw last;
}
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required." }, 405);
  if (!secret || req.headers.get("x-pulse-push-secret") !== secret) return json({ error: "Unauthorized dispatch." }, 401);
  if (!publicKey || !privateKey) return json({ error: "VAPID keys are not configured." }, 503);
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const body = await req.json(), events = Array.isArray(body.events) ? body.events.slice(0, 40) : [];
    if (!events.length) return json({ ok: true, received: 0, delivered: 0 });
    const { data: subscriptions, error } = await supabase.from("push_subscriptions").select("id,subscription,preferences");
    if (error) throw error;
    const totals = { received: events.length, subscriptions: subscriptions?.length || 0, delivered: 0, skipped: 0, failed: 0 };
    for (const sub of subscriptions || []) {
      const prefs = sub.preferences || {};
      const candidates = events.map((event: any) => ({ event, priority: priorityOf(event) }))
        .filter((item: any) => Number.isInteger(Number(item.event.id)) && enabled(prefs, item.priority, String(item.event.category || "news")))
        .filter((item: any) => item.priority === "breaking" || !quietNow(prefs));
      if (!candidates.length) { totals.skipped++; continue; }
      const urgent = candidates.filter((item: any) => item.priority === "breaking" || item.priority === "important").slice(0, 3);
      const general = candidates.filter((item: any) => item.priority === "general");
      const low = candidates.filter((item: any) => item.priority === "low");
      const batches: any[] = urgent.map((item: any) => ({ items: [item], priority: item.priority }));
      if (general.length) batches.push({ items: general, priority: "general" });
      if (low.length && prefs.lowMode !== "off") {
        if (prefs.lowMode === "immediate") low.slice(0, 3).forEach((item: any) => batches.push({ items: [item], priority: "low" }));
        else batches.push({ items: low, priority: "low" });
      }
      for (const batch of batches) {
        const ids = batch.items.map((x: any) => Number(x.event.id));
        const rows = batch.items.map((x: any) => ({ event_id: Number(x.event.id), subscription_id: sub.id, priority: x.priority, status: "queued", attempt_count: 0 }));
        const { data: inserted, error: insertError } = await supabase.from("push_deliveries").upsert(rows, { onConflict: "event_id,subscription_id", ignoreDuplicates: true }).select("id,event_id");
        if (insertError) throw insertError;
        if (!inserted?.length) { totals.skipped += ids.length; continue; }
        const selectedIds = new Set(inserted.map((x: any) => Number(x.event_id)));
        const selected = batch.items.filter((x: any) => selectedIds.has(Number(x.event.id)));
        const first = selected[0].event, priority = batch.priority;
        const url = priority === "breaking" ? "/?pulseEvent=" + Number(first.id) + "#breaking" : "/?pulseEvent=" + Number(first.id) + "#overview";
        const title = priority === "breaking" ? "BREAKING · PULSE" : priority === "important" ? "IMPORTANT · PULSE" : selected.length > 1 ? "PULSE · " + selected.length + " new reports" : "PULSE · New report";
        const bodyText = selected.length > 1 ? selected.slice(0, 3).map((x: any) => String(x.event.title || "New report").slice(0, 100)).join(" · ") : String(first.title || "Open PULSE for details").slice(0, 180);
        const payload = JSON.stringify({ title, body: bodyText, priority, eventId: Number(first.id), deliveryIds: inserted.map((x: any) => x.id), url, icon: "/assets/pulse-alert-" + priority + ".svg", badge: "/assets/pulse-badge.svg", requireInteraction: priority === "breaking", silent: (priority === "low" && prefs.silentLow === true) || (prefs.sounds && prefs.sounds[priority] === false) });
        try {
          await sendWithRetry(sub.subscription, payload, priority === "breaking" ? "high" : priority === "important" ? "high" : "normal");
          const now = new Date().toISOString();
          await supabase.from("push_deliveries").update({ status: "sent", delivered_at: now, attempt_count: 1, last_error: null }).in("id", inserted.map((x: any) => x.id));
          totals.delivered += selected.length;
        } catch (pushError: any) {
          const status = Number(pushError?.statusCode || 0), message = String(pushError?.body || pushError?.message || "Push delivery failed").slice(0, 240);
          await supabase.from("push_deliveries").update({ status: "failed", attempt_count: 3, last_error: message }).in("id", inserted.map((x: any) => x.id));
          if (status === 404 || status === 410) await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          totals.failed += selected.length;
        }
      }
    }
    return json({ ok: true, ...totals });
  } catch (error) {
    console.error("PULSE push dispatch failed:", String((error as Error)?.message || error).slice(0, 300));
    return json({ error: "Notification dispatch failed. Check Supabase Edge Function logs." }, 500);
  }
});
