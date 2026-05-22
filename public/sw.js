/* Bham Cycle Nav — service worker
 * Strategy:
 *   - Same-origin app shell  → network-first, cache fallback (fresh code wins
 *                              when online; cached shell keeps it usable offline)
 *   - OpenFreeMap tiles      → stale-while-revalidate (separate cache so it
 *                              can be cleared without nuking the app shell)
 *   - Nominatim & ORS        → network-only (don't cache search/routing)
 *
 * Bump CACHE_VERSION on breaking changes — old caches are cleared on activate.
 */

const CACHE_VERSION = 'v2'
const APP_CACHE = `bham-cycle-app-${CACHE_VERSION}`
const TILE_CACHE = `bham-cycle-tiles-${CACHE_VERSION}`
const VALID_CACHES = new Set([APP_CACHE, TILE_CACHE])

self.addEventListener('install', (event) => {
  // Activate immediately on first install so the page is controlled right away.
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => !VALID_CACHES.has(k)).map((k) => caches.delete(k))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // Map tiles: stale-while-revalidate, separate cache
  if (
    url.hostname.endsWith('openfreemap.org') ||
    url.hostname.endsWith('tiles.openfreemap.org')
  ) {
    event.respondWith(staleWhileRevalidate(req, TILE_CACHE))
    return
  }

  // Live data endpoints: never cache (let them go to network)
  if (
    url.hostname.includes('nominatim.openstreetmap.org') ||
    url.hostname.includes('openrouteservice.org')
  ) {
    return
  }

  // Same-origin app shell: network-first so fresh deploys always win when
  // online; cache acts purely as an offline fallback.
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, APP_CACHE))
  }
})

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const resp = await fetch(req)
    if (resp && resp.ok && resp.type === 'basic') {
      cache.put(req, resp.clone())
    }
    return resp
  } catch (err) {
    const cached = await cache.match(req, { ignoreSearch: false })
    if (cached) return cached
    if (req.mode === 'navigate') {
      const indexFallback = await cache.match('./') || await cache.match('./index.html')
      if (indexFallback) return indexFallback
    }
    throw err
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(req)
  const networkPromise = fetch(req)
    .then((resp) => {
      if (resp && resp.ok) cache.put(req, resp.clone())
      return resp
    })
    .catch(() => cached)
  return cached || networkPromise
}
