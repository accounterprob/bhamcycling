import maplibregl from 'maplibre-gl'

const BIRMINGHAM_CENTER = [-86.8025, 33.5186]
const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

let userMarker = null
let watchId = null
let lastKnownLngLat = null
let onPositionListeners = []

export function initMap(containerId) {
  const map = new maplibregl.Map({
    container: containerId,
    style: OPENFREEMAP_STYLE,
    center: BIRMINGHAM_CENTER,
    zoom: 12,
    pitch: 0,
    bearing: 0,
    attributionControl: { compact: true },
    // Smoother on touch devices
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
  if (onUpdate) onPositionListeners.push(onUpdate)
  if (watchId != null) return
  if (!navigator.geolocation) {
    console.warn('Geolocation not supported')
    return
  }
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lngLat = [pos.coords.longitude, pos.coords.latitude]
      lastKnownLngLat = lngLat
      if (!userMarker) {
        const el = document.createElement('div')
        el.className = 'user-marker'
        userMarker = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map)
      } else {
        userMarker.setLngLat(lngLat)
      }
      for (const cb of onPositionListeners) {
        try { cb(lngLat, pos.coords) } catch (e) { console.error(e) }
      }
    },
    (err) => console.warn('watchPosition error:', err.message),
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
  )
}

export function stopTracking() {
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId)
    watchId = null
  }
}

export function flyToCurrentLocation(map, { silent = false } = {}) {
  if (lastKnownLngLat) {
    map.flyTo({ center: lastKnownLngLat, zoom: 16, speed: 1.2 })
    return
  }
  if (!navigator.geolocation) {
    if (!silent) console.warn('No geolocation')
    return
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lngLat = [pos.coords.longitude, pos.coords.latitude]
      lastKnownLngLat = lngLat
      map.flyTo({ center: lngLat, zoom: 16, speed: 1.2 })
    },
    (err) => { if (!silent) console.warn('getCurrentPosition error:', err.message) },
    { enableHighAccuracy: true, timeout: 10000 }
  )
}

export function getLastKnownLocation() {
  return lastKnownLngLat ? [...lastKnownLngLat] : null
}
