// PULSE Web Push proxy. Uses only the Supabase public key; service credentials stay in Edge Functions.
export default async function handler(req, res) {
  const base = (process.env.SUPABASE_URL || process.env.PULSE_SUPABASE_URL || "").replace(/\/$/, "");
  const anon = process.env.SUPABASE_ANON_KEY || process.env.PULSE_SUPABASE_ANON_KEY || "";
  if (!base || !anon) return res.status(503).json({ error: "Add SUPABASE_URL and SUPABASE_ANON_KEY to Vercel environment variables." });
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    let body;
    if (req.method === "POST") {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (!body || typeof body !== "object" || JSON.stringify(body).length > 24000) return res.status(400).json({ error: "Invalid notification request." });
    }
    const response = await fetch(base + "/functions/v1/push-client", {
      method: req.method,
      headers: { apikey: anon, "Content-Type": "application/json" },
      body: req.method === "POST" ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12000)
    });
    const data = await response.json().catch(() => ({ error: "Notification service returned an unreadable response." }));
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("PULSE push proxy:", String(error?.message || error).slice(0, 240));
    return res.status(502).json({ error: "PULSE notification service is temporarily unavailable." });
  }
}
