import './style.css'
import 'maplibre-gl/dist/maplibre-gl.css'

// Register the service worker in production builds only.
// In dev, Vite's HMR fights with a SW cache; in prod, this powers the offline shell + PWA install.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const swUrl = new URL('sw.js', document.baseURI).href
    navigator.serviceWorker.register(swUrl).catch((err) => {
      console.warn('SW registration failed:', err)
    })
  })
}

import {
  initMap,
  flyToCurrentLocation,
  startTracking,
  getLastKnownLocation,
  startNavView,
  stopNavView
} from './map.js'
import { initDestinationPanel } from './destination.js'
import {
  initTripPanel,
  showOverview,
  updateRoute,
  startNavigating,
  clearTrip,
  updateUpcomingStep,
  getInitialBearing
} from './instructions.js'
import {
  getRoute,
  drawRoute,
  drawEndpointMarkers,
  fitRouteBounds,
  clearRoute,
  setupRouteDrag,
  renderViaMarkers
} from './routing.js'
import { showToast } from './toast.js'

const appRoot = document.getElementById('app')
appRoot.innerHTML = `
  <div id="map"></div>
  <button id="locate-btn" class="fab" aria-label="Locate me" title="Locate me">
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3"></circle>
      <line x1="12" y1="2" x2="12" y2="5"></line>
      <line x1="12" y1="19" x2="12" y2="22"></line>
      <line x1="2" y1="12" x2="5" y2="12"></line>
      <line x1="19" y1="12" x2="22" y2="12"></line>
    </svg>
  </button>
`

const map = initMap('map')
initDestinationPanel(appRoot, onDestinationChosen)
initTripPanel(appRoot, {
  onStart: handleStartTrip,
  onCancel: handleCancelTrip,
  onProfileChange: handleProfileChange
})

// Ordered waypoints: [start, via1, via2, ..., end]. Each is {lng, lat, name?}.
let waypoints = []
let currentProfile = 'cycling-electric' // default; user can switch on the overview
let isRerouting = false

document.getElementById('locate-btn').addEventListener('click', () => {
  flyToCurrentLocation(map)
})

map.on('load', () => {
  startTracking(map, (lngLat) => {
    updateUpcomingStep([lngLat[0], lngLat[1]])
  })
  flyToCurrentLocation(map, { silent: true })
  setupRouteDrag(map, onAddVia)
})

async function onDestinationChosen(dest) {
  let here = getLastKnownLocation()
  if (!here) {
    showToast('Getting your location…')
    try {
      const pos = await getOneShotPosition()
      here = [pos.lon, pos.lat]
    } catch (e) {
      showToast('Could not get location. Enable Location Services.', { type: 'error' })
      return
    }
  }
  waypoints = [
    { lng: here[0], lat: here[1] },
    { lng: dest.lon, lat: dest.lat, name: dest.name }
  ]
  await reroute({ fit: true, isInitial: true })
}

function onAddVia(lngLat) {
  if (waypoints.length < 2) return
  waypoints.splice(waypoints.length - 1, 0, { lng: lngLat.lng, lat: lngLat.lat })
  reroute({ fit: false })
}

function onMoveVia(viaIdx, lngLat) {
  if (waypoints.length < 3) return
  waypoints[viaIdx + 1] = { lng: lngLat.lng, lat: lngLat.lat }
  reroute({ fit: false })
}

function onRemoveVia(viaIdx) {
  if (waypoints.length < 3) return
  waypoints.splice(viaIdx + 1, 1)
  reroute({ fit: false })
}

async function reroute({ fit = false, isInitial = false } = {}) {
  if (waypoints.length < 2 || isRerouting) return
  isRerouting = true
  try {
    const geo = await getRoute(waypoints, currentProfile)
    drawRoute(map, geo)
    drawEndpointMarkers(map, waypoints[0], waypoints[waypoints.length - 1])
    const vias = waypoints.slice(1, -1)
    renderViaMarkers(map, vias, { onMove: onMoveVia, onRemove: onRemoveVia })
    if (fit) fitRouteBounds(map, geo)
    if (isInitial) {
      const destName = waypoints[waypoints.length - 1].name || 'Destination'
      showOverview(geo, destName, currentProfile)
    } else {
      updateRoute(geo, currentProfile)
    }
  } catch (e) {
    console.error(e)
    showToast(`Routing failed: ${e.message}`, { type: 'error', duration: 4000 })
  } finally {
    isRerouting = false
  }
}

function handleStartTrip() {
  startNavigating()
  // Enter the tilted, zoomed-in, follow-the-user nav camera. Seed bearing
  // from the route's first few meters so the camera faces the right way.
  const initialBearing = getInitialBearing()
  startNavView(map, { initialBearing })
}

function handleCancelTrip() {
  waypoints = []
  clearRoute(map)
  clearTrip()
  stopNavView(map)
}

function handleProfileChange(profile) {
  if (profile === currentProfile) return
  currentProfile = profile
  reroute({ fit: false })
}

function getOneShotPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('No geolocation'))
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      reject,
      { enableHighAccuracy: true, timeout: 10000 }
    )
  })
}
