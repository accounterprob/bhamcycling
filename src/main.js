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

import { initMap, flyToCurrentLocation, startTracking, getLastKnownLocation } from './map.js'
import { initDestinationPanel } from './destination.js'
import {
  initInstructionsPanel,
  setRoute as setInstructionsRoute,
  updateUpcomingStep,
  clearInstructions
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
initInstructionsPanel(appRoot, onClearRoute)

// Ordered waypoints: [start, via1, via2, ..., end]. Each is {lng, lat, name?}.
let waypoints = []
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
  await reroute({ fit: true })
  maybeShowFirstRouteTip()
}

function onAddVia(lngLat) {
  if (waypoints.length < 2) return
  // Insert before the destination. For multi-via routes the user can drag
  // each via to fine-tune position; we don't auto-order along the path.
  waypoints.splice(waypoints.length - 1, 0, { lng: lngLat.lng, lat: lngLat.lat })
  reroute({ fit: false })
}

function onMoveVia(viaIdx, lngLat) {
  // viaIdx is index within vias array (0..N-1) → waypoint index is viaIdx + 1
  if (waypoints.length < 3) return
  waypoints[viaIdx + 1] = { lng: lngLat.lng, lat: lngLat.lat }
  reroute({ fit: false })
}

function onRemoveVia(viaIdx) {
  if (waypoints.length < 3) return
  waypoints.splice(viaIdx + 1, 1)
  reroute({ fit: false })
}

async function reroute({ fit = false } = {}) {
  if (waypoints.length < 2 || isRerouting) return
  isRerouting = true
  try {
    const geo = await getRoute(waypoints, 'cycling-regular')
    drawRoute(map, geo)
    drawEndpointMarkers(map, waypoints[0], waypoints[waypoints.length - 1])
    const vias = waypoints.slice(1, -1)
    renderViaMarkers(map, vias, { onMove: onMoveVia, onRemove: onRemoveVia })
    if (fit) fitRouteBounds(map, geo)
    setInstructionsRoute(geo)
  } catch (e) {
    console.error(e)
    showToast(`Routing failed: ${e.message}`, { type: 'error', duration: 4000 })
  } finally {
    isRerouting = false
  }
}

function onClearRoute() {
  waypoints = []
  clearRoute(map)
  clearInstructions()
}

const FIRST_TIP_KEY = 'bham-cycle-first-route-tip'
function maybeShowFirstRouteTip() {
  if (localStorage.getItem(FIRST_TIP_KEY)) return
  setTimeout(() => {
    showToast('Tip: drag the route to add a stop. Long-press a stop to remove.', {
      duration: 4500
    })
  }, 1200)
  localStorage.setItem(FIRST_TIP_KEY, '1')
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
