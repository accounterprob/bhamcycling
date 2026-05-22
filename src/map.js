import maplibregl from 'maplibre-gl'

const BIRMINGHAM_CENTER = [-86.8025, 33.5186]
const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

// Nav view tuning
const NAV_ZOOM = 17.5
const NAV_PITCH = 60

let currentMap = null
let userMarker = null
let watchId = null
let lastKnownLngLat = null
let onPositionListeners = []

// Navigation camera state
let navModeOn = false
let followingUser = false
let lastBearingPos = null
let lastBearing = null

export function initMap(containerId) {
  const map = new maplibregl.Map({
    container: containerId,
    style: OPENFREEMAP_STYLE,
    center: BIRMINGHAM_CENTER,
    zoom: 12,
    pitch: 0,
    bearing: 0,
    attributionControl: { compact: true },
    cooperativeGestures: false,
    fadeDuration: 100
  })
  map.addControl(
    new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
    'top-right'
  )
  return map
}

export function startTracking(map, onUpdate) {
  currentMap = map
  if (onUpdate) onPositionListeners.push(onUpdate)
  // Pause auto-follow when the user manually pans the map (registered once)
  map.on('dragstart', () => {
    if (followingUser) followingUser = false
  })
  if (watchId != null) return
  if (!navigator.geolocation) {
    console.warn('Geolocation not supported')
    return
  }
  watchId = navigator.geolocation.watchPosition(
    handlePosition,
    (err) => console.warn('watchPosition error:', err.message),
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
  )
}

function handlePosition(pos) {
  const lngLat = [pos.coords.longitude, pos.coords.latitude]
  lastKnownLngLat = lngLat
  if (!userMarker) {
    const el = document.createElement('div')
    el.className = 'user-marker'
    userMarker = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(currentMap)
  } else {
    userMarker.setLngLat(lngLat)
  }

  // External listeners (turn-by-turn upcoming step etc.)
  for (const cb of onPositionListeners) {
    try { cb(lngLat, pos.coords) } catch (e) { console.error(e) }
  }

  // In nav mode while following, ease camera to user + rotate to heading
  if (followingUser && currentMap) {
    const bearing = pickBearing(pos.coords, lngLat)
    const easeOpts = { center: lngLat, duration: 700, essential: true }
    if (bearing != null && !isNaN(bearing)) easeOpts.bearing = bearing
    currentMap.easeTo(easeOpts)
  }
}

function pickBearing(coords, lngLat) {
  // Prefer device-reported heading when reliable (moving and accurate)
  const speed = coords.speed ?? 0
  let bearing = coords.heading
  if (bearing == null || isNaN(bearing) || speed < 1) {
    // Fall back to bearing computed from movement since last sample
    if (lastBearingPos && haversine(lastBearingPos, lngLat) > 3) {
      bearing = computeBearing(lastBearingPos, lngLat)
      lastBearingPos = [...lngLat]
    } else {
      // Reuse previous bearing if we just don't have a fresh signal
      bearing = lastBearing
    }
  } else {
    lastBearingPos = [...lngLat]
  }
  if (bearing != null && !isNaN(bearing)) lastBearing = bearing
  return bearing
}

export function stopTracking() {
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId)
    watchId = null
  }
}

export function flyToCurrentLocation(map, { silent = false } = {}) {
  const fly = (lngLat) => {
    if (navModeOn) {
      // In nav mode, "locate me" re-engages follow + restores nav view
      followingUser = true
      const bearing = lastBearing ?? 0
      map.easeTo({
        center: lngLat, zoom: NAV_ZOOM, pitch: NAV_PITCH, bearing, duration: 700
      })
    } else {
      map.flyTo({ center: lngLat, zoom: 16, speed: 1.2 })
    }
  }
  if (lastKnownLngLat) { fly(lastKnownLngLat); return }
  if (!navigator.geolocation) {
    if (!silent) console.warn('No geolocation')
    return
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lngLat = [pos.coords.longitude, pos.coords.latitude]
      lastKnownLngLat = lngLat
      fly(lngLat)
    },
    (err) => { if (!silent) console.warn('getCurrentPosition error:', err.message) },
    { enableHighAccuracy: true, timeout: 10000 }
  )
}

export function getLastKnownLocation() {
  return lastKnownLngLat ? [...lastKnownLngLat] : null
}

/* ----- Navigation camera ----- */

/** Enter the navigation camera: tilt, zoom in, follow user, rotate to heading. */
export function startNavView(map, { initialBearing = 0 } = {}) {
  navModeOn = true
  followingUser = true
  const center = lastKnownLngLat || map.getCenter().toArray()
  // Seed bearing tracking so the first geolocation update has something to compare
  if (lastKnownLngLat) lastBearingPos = [...lastKnownLngLat]
  if (initialBearing != null && !isNaN(initialBearing)) lastBearing = initialBearing
  map.easeTo({
    center,
    zoom: NAV_ZOOM,
    pitch: NAV_PITCH,
    bearing: initialBearing ?? 0,
    duration: 1100
  })
}

/** Exit nav view: untilt, unrotate, stop following. */
export function stopNavView(map) {
  navModeOn = false
  followingUser = false
  lastBearing = null
  lastBearingPos = null
  map.easeTo({ pitch: 0, bearing: 0, duration: 600 })
}

export function isNavMode() {
  return navModeOn
}

/* ----- Geo helpers (also used by instructions.js for initial bearing) ----- */

export function computeBearing(from, to) {
  const [lng1, lat1] = from
  const [lng2, lat2] = to
  const toRad = (d) => (d * Math.PI) / 180
  const toDeg = (r) => (r * 180) / Math.PI
  const phi1 = toRad(lat1)
  const phi2 = toRad(lat2)
  const dLambda = toRad(lng2 - lng1)
  const y = Math.sin(dLambda) * Math.cos(phi2)
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

export function haversine(a, b) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const lat1 = toRad(a[1]), lat2 = toRad(b[1])
  const dLat = toRad(b[1] - a[1])
  const dLon = toRad(b[0] - a[0])
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}
