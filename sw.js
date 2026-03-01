const CACHE_NAME = 'iidx-app-shell-v2';
const SW_VERSION = '2026-02-18-1';
const SONG_MASTER_GITHUB_LATEST_JSON_RE =
  /^\/tts1374\/iidx_all_songs_master\/releases\/latest\/download\/latest\.json$/;
const SONG_MASTER_GITHUB_SQLITE_RE =
  /^\/tts1374\/iidx_all_songs_master\/releases\/latest\/download\/.+\.sqlite$/i;
const SONG_MASTER_LOCAL_LATEST_JSON_RE = /\/song-master\/latest\.json$/;
const SONG_MASTER_LOCAL_SQLITE_RE = /\/song-master\/.+\.sqlite$/i;

function resolveScopePath() {
  const scope = self.registration && self.registration.scope ? self.registration.scope : `${self.location.origin}/`;
  const pathname = new URL(scope).pathname;
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

function withIsolationHeaders(response) {
  if (!response || response.type === 'opaque' || response.status === 0) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function shouldBypassSongMasterCache(urlText) {
  const parsed = new URL(urlText);
  return (
    SONG_MASTER_GITHUB_LATEST_JSON_RE.test(parsed.pathname) ||
    SONG_MASTER_GITHUB_SQLITE_RE.test(parsed.pathname) ||
    SONG_MASTER_LOCAL_LATEST_JSON_RE.test(parsed.pathname) ||
    SONG_MASTER_LOCAL_SQLITE_RE.test(parsed.pathname)
  );
}

const SCOPE_PATH = resolveScopePath();
const INDEX_PATH = `${SCOPE_PATH}index.html`;
const APP_SHELL = [SCOPE_PATH, INDEX_PATH];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'GET_SW_VERSION') {
    event.ports?.[0]?.postMessage({ type: 'SW_VERSION', value: SW_VERSION });
    return;
  }
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  if (shouldBypassSongMasterCache(event.request.url)) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).then((response) => withIsolationHeaders(response)));
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => withIsolationHeaders(response))
        .catch(async () => {
          const cached = await caches.match(INDEX_PATH);
          return cached ? withIsolationHeaders(cached) : Response.error();
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return withIsolationHeaders(cached);
      }
      return fetch(event.request).then((response) => {
        const responseForCache = response.clone();
        const responseForClient = withIsolationHeaders(response);
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseForCache));
        return responseForClient;
      });
    }),
  );
});
