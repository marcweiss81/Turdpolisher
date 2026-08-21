// TurdPolisher service worker — enables "Install app" on Android/Chrome.
// Only the app shell (this page, its manifest, its icons) is ever cached;
// every TMDB/Reddit/LLM request passes straight through untouched,
// since recommendation data must always be live.

var CACHE_NAME = "turdpolisher-shell-v1";
var SHELL_URLS = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/favicon-32.png"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(SHELL_URLS); })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n !== CACHE_NAME; }).map(function (n) { return caches.delete(n); }));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  var url = new URL(req.url);
  var isShell = url.origin === self.location.origin &&
    (req.mode === "navigate" || SHELL_URLS.some(function (s) { return url.pathname.endsWith(s.replace("./", "")) || s === "./"; }));
  if (!isShell) return; // let every other request (all live API calls) through untouched

  // Network-first for the shell: an online visit always gets the latest
  // deployed version; only a network failure (offline) falls back to cache.
  event.respondWith(
    fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
      return res;
    }).catch(function () {
      return caches.match(req).then(function (cached) { return cached || caches.match("./index.html"); });
    })
  );
});
