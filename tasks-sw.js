// Bump this version whenever index.html or one of its dependencies changes.
// A new worker waits for existing tabs to close before switching the whole shell.
const CACHE_PREFIX = 'taskimatic-tasks-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v15`;
const SHELL_ASSETS = [
    './index.html',
    './css/tasks.css',
    './css/protect-modal.css',
    './js/download.js',
    './js/workspace-tabs.js',
    './js/offline.js',
    './js/portable-app.js',
    './js/tasks-app.js',
    './js/task-api.js',
    './js/task-model.js',
    './js/task-repository.js',
    './js/task-analytics.js',
    './webcomp/task-item.js',
    './webcomp/planning-item.js',
    './webcomp/task-table.js',
    './webcomp/task-hierarchy-editor.js',
    './webcomp/lock-in-controls.js',
    './webcomp/task-sort-controls.js',
    './webcomp/task-workspace.js',
    './webcomp/dual-range-slider.js',
    './webcomp/task-visualization.js',
    './js/i18n.js',
    './data/i18n.json',
    './data/i18n/en.json',
    './data/i18n/zh.json',
    './data/i18n/es.json',
    './data/i18n/hi.json',
    './data/i18n/pt.json',
    './data/i18n/ja.json',
    './data/i18n/de.json',
    './data/i18n/fr.json',
    './data/i18n/ko.json',
    './data/i18n/it.json',
    './data/i18n/ru.json',
    './data/i18n/id.json',
    './data/i18n/uk.json',
    './data/i18n/tr.json',
    './data/i18n/nl.json',
    './webcomp/backuptracker.js',
    './webcomp/searcher-element.js',
    './webcomp/session-times.js',
    './js/task-planning-model.js',
    './js/task-table-model.js',
    './tasks.webmanifest',
    './favicon.ico',
    './favicon-16x16.png',
    './favicon-32x32.png',
    './apple-touch-icon.png',
    './android-icon-144x144.png',
    './android-icon-192x192.png',
    './android-icon-512x512.png'
].map(path => new URL(path, self.location.href).href);
const SHELL_URLS = new Set(SHELL_ASSETS);
const PAGE_URL = new URL('./index.html', self.location.href).href;

self.addEventListener('install', event => {
    // addAll is atomic: a failed download never activates an incomplete shell.
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(
        SHELL_ASSETS.map(url => new Request(url, { cache: 'reload' }))
    )));
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map(name => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    // Only the task shell is cached; other pages, APIs and external links pass through.
    url.search = '';
    url.hash = '';
    if (!SHELL_URLS.has(url.href)) return;
    // Queries are ignored only for page navigation, never for scripts or other assets.
    const cacheKey = event.request.mode === 'navigate' && url.href === PAGE_URL
        ? PAGE_URL : event.request.url;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(cacheKey)) || fetch(event.request);
    })());
});
