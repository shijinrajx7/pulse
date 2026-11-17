const CACHE_NAME = "pulse-shell-v1";
const SHELL = ["/", "/design.css", "/manifest.webmanifest", "/assets/pulse-pwa.svg", "/assets/pulse-badge.svg"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("pulse-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/") || url.pathname.includes("/functions/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok && response.type === "basic") {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  })));
});
self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data ? event.data.text() : "Open PULSE for the latest update." }; }
  const priority = ["breaking", "important", "general", "low"].includes(payload.priority) ? payload.priority : "general";
  const options = {
    body: String(payload.body || "Open PULSE for the latest update.").slice(0, 220),
    icon: payload.icon || "/assets/pulse-alert-general.svg",
    badge: payload.badge || "/assets/pulse-badge.svg",
    tag: payload.tag || (priority === "breaking" ? "pulse-breaking" : "pulse-" + priority + "-" + (payload.eventId || Date.now())),
    renotify: priority === "breaking",
    requireInteraction: priority === "breaking" && payload.requireInteraction === true,
    silent: payload.silent === true,
    data: { url: payload.url || "/", eventId: payload.eventId || null, deliveryIds: payload.deliveryIds || [], subscriptionEndpoint: payload.subscriptionEndpoint || "" },
    actions: [{ action: "read", title: "Read report" }, { action: "dismiss", title: "Dismiss" }]
  };
  if (payload.image) options.image = payload.image;
  event.waitUntil(self.registration.showNotification(String(payload.title || "PULSE update").slice(0, 90), options));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;
  const data = event.notification.data || {};
  const target = new URL(data.url || "/", self.location.origin).href;
  const track = data.subscriptionEndpoint ? fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "mark-clicked", endpoint: data.subscriptionEndpoint, deliveryIds: data.deliveryIds || [] }) }).catch(() => {}) : Promise.resolve();
  event.waitUntil(Promise.all([track, self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if ("focus" in client) {
        if ("navigate" in client && client.url !== target) return client.navigate(target).then((next) => (next || client).focus());
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })]));
});
self.addEventListener("notificationclose", () => {});
