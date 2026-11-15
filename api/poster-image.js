import { createHmac, createHash, timingSafeEqual } from "node:crypto";

const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const publisherRoots = ["techcrunch.com", "arstechnica.com", "openai.com", "nvidia.com", "google.com", "thehindu.com", "thehackernews.com", "feedburner.com", "aws.amazon.com", "microsoft.com", "mozilla.org", "cloudflare.com", "ubuntu.com", "ncsc.gov.uk", "nist.gov", "cisa.gov"];
const imageCdnHosts = ["images.ctfassets.net", "cdn.vox-cdn.com", "cdn.arstechnica.net", "media.wired.com", "i.guim.co.uk", "static01.nyt.com", "images.unsplash.com", "storage.googleapis.com"];

function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(body);
}
function safeEqual(left, right) {
  return timingSafeEqual(createHash("sha256").update(String(left)).digest(), createHash("sha256").update(String(right)).digest());
}
function b64url(value) { return Buffer.from(value).toString("base64url"); }
function adminTokenValid(token) {
  const secret = process.env.PULSE_ADMIN_SESSION_SECRET || "";
  if (!secret || !token) return false;
  const [payload, signature] = String(token).split(".");
  if (!payload || !signature) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeEqual(signature, expected)) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return claims.scope === "poster-admin" && Number(claims.exp) > Date.now();
  } catch { return false; }
}
function bearer(req) {
  const value = String(req.headers?.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}
function tokenAal(token) {
  try { return JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8")).aal || ""; }
  catch { return ""; }
}
async function authorized(token) {
  if (adminTokenValid(token)) return true;
  if (!supabaseUrl || !serviceKey || !token || tokenAal(token) !== "aal2") return false;
  const r = await fetch(supabaseUrl + "/auth/v1/user", { headers: { apikey: serviceKey, Authorization: "Bearer " + token } });
  return r.ok;
}
function rootFor(host) {
  const h = host.toLowerCase().replace(/\.$/, "");
  return publisherRoots.find((root) => h === root || h.endsWith("." + root)) || "";
}
function publicHttps(raw, articleHost = "") {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || host === "::1" || host.startsWith("fc") || host.startsWith("fd")) return null;
    const samePublisher = rootFor(host) && (rootFor(host) === rootFor(articleHost));
    const approvedCdn = imageCdnHosts.some((item) => host === item || host.endsWith("." + item));
    if (articleHost && !samePublisher && !approvedCdn) return null;
    if (!articleHost && !rootFor(host) && !approvedCdn) return null;
    return u;
  } catch { return null; }
}
async function dbGet(path) {
  const response = await fetch(supabaseUrl + "/rest/v1/" + path, {
    headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey },
  });
  if (!response.ok) throw new Error("Could not read this PULSE report.");
  return response.json();
}
async function readLimited(response, limit) {
  const length = Number(response.headers.get("content-length") || 0);
  if (length > limit) throw new Error("The publisher page is too large to inspect safely.");
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); throw new Error("The publisher response is too large."); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}
async function fetchPublic(url, options = {}) {
  let current = url;
  for (let i = 0; i < 4; i++) {
    const checked = publicHttps(current.href, options.articleHost || "");
    if (!checked) throw new Error("This publisher image host is not allowed.");
    const response = await fetch(checked, {
      redirect: "manual",
      headers: { "User-Agent": "PULSE-Poster/1.0 (+https://pulsex-phi.vercel.app)", Accept: options.accept || "text/html,image/avif,image/webp,image/png,image/jpeg" },
      signal: AbortSignal.timeout(9000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The publisher returned an invalid redirect.");
      current = new URL(location, checked);
      continue;
    }
    if (!response.ok) throw new Error("The publisher did not provide the image (HTTP " + response.status + ").");
    return { response, url: checked };
  }
  throw new Error("Too many publisher redirects.");
}
function metaImage(html, articleUrl) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  let candidate = "";
  for (const tag of tags) {
    const attrs = {};
    tag.replace(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g, (_, key, a, b, c) => {
      attrs[key.toLowerCase()] = a ?? b ?? c ?? "";
      return "";
    });
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (["og:image", "og:image:url", "twitter:image", "twitter:image:src"].includes(key) && attrs.content) {
      candidate = attrs.content;
      break;
    }
  }
  if (!candidate) {
    const ld = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (ld) {
      try {
        const data = JSON.parse(ld[1]);
        const item = Array.isArray(data) ? data[0] : data;
        const image = item?.image;
        candidate = typeof image === "string" ? image : Array.isArray(image) ? (typeof image[0] === "string" ? image[0] : image[0]?.url) : image?.url || "";
      } catch {}
    }
  }
  if (!candidate) return null;
  const decoded = candidate.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/");
  return publicHttps(new URL(decoded, articleUrl).href, new URL(articleUrl).hostname);
}
async function getReport(eventId) {
  if (!/^\d{1,20}$/.test(String(eventId || ""))) throw new Error("Choose a valid PULSE report.");
  const rows = await dbGet("events?id=eq." + encodeURIComponent(eventId) + "&select=id,url,meta&limit=1");
  if (!rows.length) throw new Error("This report is no longer available.");
  return rows[0];
}
async function findImage(report) {
  const article = publicHttps(report.url);
  if (!article || !rootFor(article.hostname)) throw new Error("PULSE can only check HTTPS article pages from supported publishers.");
  const metadataUrl = publicHttps(report.meta?.image_url || "", article.hostname);
  if (metadataUrl) return { article, image: metadataUrl, foundOn: "publisher feed" };
  const { response } = await fetchPublic(article, { articleHost: article.hostname, accept: "text/html,application/xhtml+xml" });
  const type = String(response.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("text/html") && !type.includes("application/xhtml")) throw new Error("This publisher page does not provide readable article metadata.");
  const bytes = await readLimited(response, 1_500_000);
  const html = new TextDecoder().decode(bytes);
  const image = metaImage(html, article.href);
  if (!image) throw new Error("No publisher image was found. Open the article and add a photo you have permission to use.");
  return { article, image, foundOn: "publisher article page" };
}
export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { error: "Use POST for publisher image lookup." }); }
  const origin = String(req.headers?.origin || "");
  const allowedOrigins = new Set([process.env.PUBLIC_APP_URL, "https://pulsex-phi.vercel.app", "https://pulsex-binary23.vercel.app", "http://localhost:3000", "http://127.0.0.1:3000"].filter(Boolean).map((value) => value.replace(/\/$/, "")));
  if (origin && !allowedOrigins.has(origin.replace(/\/$/, ""))) return json(res, 403, { error: "This PULSE request origin is not allowed." });
  try {
    const token = bearer(req);
    if (!(await authorized(token))) return json(res, 403, { error: "Sign in and verify your authenticator before using news images." });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const report = await getReport(body.eventId);
    const found = await findImage(report);
    if (body.action === "find") {
      return json(res, 200, { imageUrl: found.image.href, articleUrl: found.article.href, foundOn: found.foundOn, publisher: found.article.hostname });
    }
    if (!["preview", "use"].includes(body.action)) return json(res, 400, { error: "Choose find, preview, or use for this image." });
    const { response } = await fetchPublic(found.image, { articleHost: found.article.hostname, accept: "image/avif,image/webp,image/png,image/jpeg" });
    const type = String(response.headers.get("content-type") || "").split(";")[0].toLowerCase();
    if (!/^image\/(avif|webp|png|jpeg)$/.test(type)) return json(res, 415, { error: "The publisher returned an unsupported image format." });
    const bytes = await readLimited(response, 10 * 1024 * 1024);
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Length", String(bytes.byteLength));
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(Buffer.from(bytes));
  } catch (error) {
    return json(res, 502, { error: String(error?.message || "Could not load the publisher image.").slice(0, 220) });
  }
}
