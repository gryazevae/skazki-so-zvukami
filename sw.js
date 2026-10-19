/* Офлайн-работа страницы. Только свой сервер.
 * Страница и скрипты: сначала сеть (чтобы обновления доходили), без сети — кэш.
 * Записи звуков и модель распознавания: сначала кэш (они не меняются, модель 46 МБ).
 * При установке кэшируются только страница и звуки (~1,5 МБ); модель — при первом включении слушания. */
const CACHE = 'sp1-v2-2';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'sounds.js', 'stories.js', 'follow_core.js', 'follow_vosk.js',
  'follow_worklet.js', 'vendor/vosk.js', 'audio/manifest.js'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    // записи из манифеста; отказ одной записи не ломает установку
    try {
      const txt = await (await fetch('audio/manifest.json')).json();
      const files = Object.values(txt.sounds).flatMap((s) => s.variants.map((v) => v.file));
      await Promise.all(files.map((f) => c.add(f).catch(() => null)));
    } catch (e) { /* без манифеста — только синтез */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sp1-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const stable = /\/(audio|model|vendor)\//.test(url.pathname);
  event.respondWith(caches.open(CACHE).then(async (c) => {
    if (stable) {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok) await c.put(req, res.clone());
      return res;
    }
    try {
      const res = await fetch(event.request);
      if (res.ok) await c.put(req, res.clone());
      return res;
    } catch (e) {
      const hit = await c.match(req);
      if (hit) return hit;
      throw e;
    }
  }));
});
