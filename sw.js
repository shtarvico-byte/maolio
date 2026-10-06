var CACHE_NAME = "zht-vocab-v5";
/* Bump the version suffix (v1 → v2 → …) on every release so clients drop the old
   cache and fetch the updated app shell. */
var APP_SHELL = [
  "index.html",
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

self.addEventListener("controllerchange", function () {
  // only reload once to avoid loops with multiple controller changes
  if (self.__reloaded) return;
  self.__reloaded = true;
  self.clients.matchAll().then(function (clients) {
    clients.forEach(function (client) {
      client.navigate(client.url);
    });
  });
});

self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        if (response.ok && APP_SHELL.indexOf(url.pathname.replace(/^\//, "")) !== -1) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function () {
        if (event.request.mode === "navigate") {
          return caches.match("index.html");
        }
      });
    })
  );
});
