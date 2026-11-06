/* Ija Nbadlou — service worker
   - network-first for pages (so a new index.html shows up immediately), cache as offline fallback
   - never touches Firebase / Google / fonts requests (only same-origin GET)
   - shows notifications and focuses/opens the right listing when tapped */
var CACHE = "ija-v1";
var SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .catch(function () { /* a missing file must not block install */ })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // Firebase, fonts, gstatic… go straight to the network

  if (req.mode === "navigate") {
    // /annonce/xyz, /a-propos … all served by the single index.html
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put("/index.html", copy); }).catch(function () {});
        return res;
      }).catch(function () {
        return caches.match("/index.html").then(function (r) {
          return r || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
        });
      })
    );
    return;
  }

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (r) { return r || Response.error(); });
    })
  );
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if ("focus" in c) {
          if ("navigate" in c) { try { c.navigate(target); } catch (err) {} }
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
