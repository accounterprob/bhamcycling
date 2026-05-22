/* Bham Cycle Nav — service worker
 * Strategy:
 *   - Same-origin app shell  → cache-first, populated lazily on fetch
 *   - OpenFreeMap tiles      → stale-while-revalidate (separate cache so it
 *                              can be cleared without nuking the app shell)
 *   - Nominatim & ORS        → network-only (don't cache search/routing)
 *
 * Bump CACHE_VERSION whenever you want to force a clean refresh.
 */

const CACHE_VERSION = 'v1'
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

  // Same-origin app shell: cache-first, fill on demand
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, APP_CACHE))
  }
})

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(req, { ignoreSearch: false })
  if (cached) return cached
  try {
    const resp = await fetch(req)
    // Only cache successful, basic (same-origin) responses
    if (resp && resp.ok && resp.type === 'basic') {
      cache.put(req, resp.clone())
    }
    return resp
  } catch (err) {
    // Offline + nothing cached → return a minimal fallback for navigations
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
