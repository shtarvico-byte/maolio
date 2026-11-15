var CACHE_NAME = "zht-vocab-v22";
/* Bump the version suffix (v1 → v2 → …) on every release so clients drop the old
   cache. App shell code (index.html / sync-github.js / navigations) is served
   network-first below, so a stale cache is only ever an offline fallback. */
var APP_SHELL = [
  "index.html",
  "sync-github.js",
  "manifest.json",
  "icon.svg",
  "icon-192.png",
  "icon-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("message", function (event) {
  if (event.data === "skip-waiting") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME) return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* Note: the post-update page reload is wired in index.html via
   navigator.serviceWorker "controllerchange" — that event fires on the
   page's ServiceWorkerContainer, never inside this worker global. */

self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;

  var path = url.pathname.replace(/^\/+/, "");
  var isAppCode = event.request.mode === "navigate" ||
    path === "index.html" || path === "sync-github.js" ||
    path.slice(-11) === "/index.html" || path.slice(-15) === "/sync-github.js";

  if (isAppCode) {
    /* Network-first for app code: online clients always run the latest
       index.html / sync-github.js; the cache is only an offline fallback. */
    event.respondWith(
      fetch(event.request).then(function (response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function () {
        return caches.match(event.request).then(function (cached) {
          return cached || caches.match("index.html");
        });
      })
    );
    return;
  }

  /* Cache-first for static assets (icons, manifest). */
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        if (response.ok && APP_SHELL.indexOf(path) !== -1) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    })
  );
});
