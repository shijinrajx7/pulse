import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("PULSE_APP_URL") || "https://pulsex-phi.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-pulse-owner",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin",
};
const url = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_KEY") || "";
const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const privateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const encoder = new TextEncoder();
const attempts = new Map<string, { at: number; count: number }>();

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function validOwner(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{32,160}$/.test(value); }
async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, "0")).join("");
}
function limited(key: string) {
  const now = Date.now(), current = attempts.get(key);
  if (!current || now - current.at > 60_000) { attempts.set(key, { at: now, count: 1 }); return false; }
  current.count++;
  return current.count > 20;
}
function setupPush() {
  if (!publicKey || !privateKey) throw new Error("Push is not configured yet. Add the VAPID secrets in Supabase.");
  webpush.setVapidDetails(subject, publicKey, privateKey);
}
async function owned(endpoint: string, ownerHash: string) {
  const endpointHash = await hash(endpoint);
  const { data, error } = await db.from("push_subscriptions").select("*").eq("endpoint_hash", endpointHash).maybeSingle();
  if (error) throw error;
  if (!data || data.owner_token_hash !== ownerHash) return null;
  return data;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method === "GET") return reply({ publicKey, configured: !!(publicKey && privateKey) });
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405);
  try {
    const body = await req.json();
    const owner = body.ownerToken;
    if (!validOwner(owner)) return reply({ error: "This device registration is invalid. Refresh and enable alerts again." }, 400);
    const ownerHash = await hash(owner);
    const key = ownerHash.slice(0, 20);
    if (limited(key)) return reply({ error: "Too many notification settings requests. Wait one minute." }, 429);
    const action = String(body.action || "");
    if (action === "subscribe") {
      const sub = body.subscription;
      if (!sub || typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) return reply({ error: "The browser returned an invalid push subscription." }, 400);
      const endpointHash = await hash(sub.endpoint);
      const { data: existing, error: readError } = await db.from("push_subscriptions").select("id,owner_token_hash").eq("endpoint_hash", endpointHash).maybeSingle();
      if (readError) throw readError;
      if (existing && existing.owner_token_hash !== ownerHash) return reply({ error: "This browser subscription belongs to another PULSE installation. Disable it in the original browser first." }, 409);
      const preferences = body.preferences && typeof body.preferences === "object" ? body.preferences : {};
      const { error } = await db.from("push_subscriptions").upsert({
        endpoint_hash: endpointHash, endpoint: sub.endpoint, subscription: sub, owner_token_hash: ownerHash,
        preferences, updated_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), disabled_at: null
      }, { onConflict: "endpoint_hash" });
      if (error) throw error;
      return reply({ ok: true, enabled: true });
    }
    const endpoint = String(body.endpoint || body.subscription?.endpoint || "");
    if (!endpoint.startsWith("https://")) return reply({ error: "A valid device endpoint is required." }, 400);
    const record = await owned(endpoint, ownerHash);
    if (!record) return reply({ error: "This device registration was not found or is not owned by this browser." }, 404);
    if (action === "unsubscribe") {
      const { error } = await db.from("push_subscriptions").delete().eq("id", record.id);
      if (error) throw error;
      return reply({ ok: true, enabled: false });
    }
    if (action === "preferences") {
      const prefs = body.preferences && typeof body.preferences === "object" ? body.preferences : {};
      const { error } = await db.from("push_subscriptions").update({ preferences: prefs, updated_at: new Date().toISOString() }).eq("id", record.id);
      if (error) throw error;
      return reply({ ok: true });
    }
    if (action === "test") {
      setupPush();
      await webpush.sendNotification(record.subscription, JSON.stringify({ title: "PULSE · TEST ALERT", body: "Background push is connected on this device.", priority: "general", icon: "/assets/pulse-alert-general.svg", badge: "/assets/pulse-badge.svg", url: "/" }), { TTL: 60, urgency: "normal" });
      return reply({ ok: true, message: "Test push accepted by the browser push service." });
    }
    if (action === "history") {
      const { data, error } = await db.from("push_deliveries").select("id,event_id,priority,status,created_at,delivered_at,read_at,event:events(id,title,url,category,region,published_at)").eq("subscription_id", record.id).order("created_at", { ascending: false }).limit(40);
      if (error) throw error;
      return reply({ items: data || [] });
    }
    if (action === "mark-read") {
      const ids = Array.isArray(body.deliveryIds) ? body.deliveryIds.filter((v: unknown) => Number.isInteger(Number(v))).slice(0, 40) : [];
      if (!ids.length) return reply({ ok: true });
      const { error } = await db.from("push_deliveries").update({ read_at: new Date().toISOString() }).eq("subscription_id", record.id).in("id", ids);
      if (error) throw error;
      return reply({ ok: true });
    }
    return reply({ error: "Unknown notification action." }, 400);
  } catch (error) {
    const message = String((error as Error)?.message || error).slice(0, 240);
    console.error("PULSE push client error:", message);
    return reply({ error: message.includes("VAPID") ? message : "PULSE could not complete this notification request. Check the function logs." }, 500);
  }
});
