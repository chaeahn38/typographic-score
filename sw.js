const CACHE = 'typo-score-v1';
const FILES = [
  './',
  './index.html',
  './style.css',
  './script-1.js',
  './script-2.js',
  './script-3.js',
  './script-4.js',
  './icon.svg',
  'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.3/p5.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
