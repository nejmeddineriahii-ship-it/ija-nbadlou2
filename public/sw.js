/* Ija Nbadlou — service worker
 * - pages : réseau d'abord, page "pas de connexion" si hors ligne
 * - fichiers statiques du site (icônes, manifest) : cache d'abord, mis à jour en arrière-plan
 * - polices Google : mises en cache après la première visite
 * - jamais de cache pour Firestore / API / images d'annonces
 */
const VERSION = "ija-v1";
const SHELL = ["/offline.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      Promise.all(SHELL.map((url) => cache.add(url).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isFont(url) {
  return url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // pages : réseau d'abord, sinon écran "pas de connexion"
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("/offline.html"))
    );
    return;
  }

  const sameOrigin = url.origin === self.location.origin;

  // images d'annonces et sitemap : toujours depuis le réseau
  if (sameOrigin && (url.pathname.startsWith("/img/") || url.pathname === "/sitemap.xml")) return;

  // polices : cache d'abord
  if (isFont(url)) {
    event.respondWith(
      caches.open(VERSION).then((cache) =>
        cache.match(req).then((hit) =>
          hit || fetch(req).then((res) => {
            if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
            return res;
          })
        )
      )
    );
    return;
  }

  // fichiers statiques du site : cache d'abord + mise à jour en arrière-plan
  if (sameOrigin && (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest")) {
    event.respondWith(
      caches.open(VERSION).then((cache) =>
        cache.match(req).then((hit) => {
          const net = fetch(req).then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          }).catch(() => hit);
          return hit || net;
        })
      )
    );
  }
  // tout le reste (Firestore, Firebase, API) : réseau normal
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.focus();
          if ("navigate" in c) { try { c.navigate(target); } catch (e) { /* ignore */ } }
          return;
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
