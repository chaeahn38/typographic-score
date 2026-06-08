const CACHE = "score-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./main.js",
  "./score.json",
  "./icon/Pen.svg",
  "./icon/Select.svg",
  "./icon/Type.svg",
  "./icon/Play.svg",
  "./icon/Clear.svg",
  "./icon/BW.svg",
  "./icon/Regular.svg",
  "./icon/Bold.svg",
  "./icon/Line.svg",
  "./icon/Dot.svg",
  "https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.3/p5.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (res && res.status === 200 && res.type !== "opaque") {
          const clone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
