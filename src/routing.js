import maplibregl from 'maplibre-gl'

const ORS_BASE = 'https://api.openrouteservice.org/v2/directions'
const BROUTER_BASE = 'https://brouter.de/brouter'
const API_KEY = import.meta.env.VITE_ORS_API_KEY

const SOURCE_ID = 'route'
const CASING_ID = 'route-casing'
const LINE_ID = 'route-line'

let startMarker = null
let endMarker = null
let viaMarkers = []

/**
 * Request a cycling route through an ordered list of waypoints.
 * @param {{lng:number,lat:number}[]} waypoints - At least 2; first = start, last = end.
 * @param {string} profile - ORS profile, e.g. 'cycling-regular'.
 * @param {object} [prefs] - Route preferences. Defaults to safe-ish.
 * @param {boolean} [prefs.avoidHighways=true] - Skip motorways / trunk roads.
 * @param {boolean} [prefs.avoidHills=false]   - Cap max gradient at ~8%.
 */
export async function getRoute(waypoints, profile = 'cycling-electric', prefs = {}) {
  if (!API_KEY) {
    throw new Error('Missing VITE_ORS_API_KEY (set it in .env)')
  }
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    throw new Error('Need at least 2 waypoints')
  }
  const url = `${ORS_BASE}/${profile}/geojson`
  // Note: ORS doesn't accept "highways" in avoid_features for cycling profiles
  // (cycling already routes around motorways by default). Only car profiles
  // allow it. Use the Safest mode (BRouter) when you want max road avoidance.
  const options = { avoid_features: ['steps', 'fords'] }
  if (prefs.avoidHills) {
    options.profile_params = { restrictions: { gradient: 8 } }
  }
  const body = {
    coordinates: waypoints.map((w) => [w.lng, w.lat]),
    instructions: true,
    units: 'm',
    language: 'en',
    geometry: true,
    options
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json, application/geo+json'
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.error?.message || JSON.stringify(j)
    } catch {
      detail = await res.text()
    }
    throw new Error(`ORS ${res.status}: ${detail}`.slice(0, 240))
  }
  return res.json()
}

/**
 * Request a route from BRouter (free, no key). The "safety" profile reads OSM
 * tags like `lanes`, `maxspeed`, and `cycleway:*` and weights against
 * multi-lane, fast, or car-priority roads. Returns a response shaped like ORS
 * so the rest of the app doesn't need to care which engine produced it.
 */
export async function getRouteBRouter(waypoints, profile = 'safety') {
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    throw new Error('Need at least 2 waypoints')
  }
  const lonlats = waypoints
    .map((w) => `${w.lng.toFixed(6)},${w.lat.toFixed(6)}`)
    .join('|')
  const params = new URLSearchParams({
    lonlats,
    profile,
    alternativeidx: '0',
    format: 'geojson'
  })
  const res = await fetch(`${BROUTER_BASE}?${params.toString()}`)
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`BRouter ${res.status}: ${txt.slice(0, 200)}`)
  }
  // BRouter sometimes responds 200 with a plain-text error body
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('json')) {
    const txt = await res.text()
    throw new Error(`BRouter: ${txt.slice(0, 200)}`)
  }
  const data = await res.json()
  if (data?.type !== 'FeatureCollection' || !data.features?.length) {
    throw new Error('BRouter: empty route')
  }
  return adaptBRouterToORS(data)
}

function adaptBRouterToORS(brouterGeoJson) {
  const feat = brouterGeoJson.features[0]
  // BRouter returns [lng, lat, elevation] — we keep the 3D coords; MapLibre
  // ignores Z for line layers and our haversine() only reads indices 0 and 1.
  const coords = feat.geometry.coordinates
  const props = feat.properties || {}
  const distance = parseFloat(props['track-length']) || 0
  const duration = parseFloat(props['total-time']) || 0
  const voicehints = Array.isArray(props.voicehints) ? props.voicehints : []
  const steps = []

  if (voicehints.length === 0) {
    steps.push({
      distance,
      duration,
      type: 11, // depart
      instruction: 'Head toward destination',
      name: '',
      way_points: [0, Math.max(0, coords.length - 1)]
    })
  } else {
    let prevIdx = 0
    for (const vh of voicehints) {
      const pointIdx = Number(vh[0]) || prevIdx
      const cmd = Number(vh[1]) || 1
      const distToTurn = Number(vh[2]) || 0
      const exitNumber = vh[5]
      steps.push({
        distance: distToTurn,
        duration: 0, // BRouter doesn't reliably give per-step duration
        type: brouterCmdToOrsType(cmd),
        instruction: brouterInstruction(cmd, exitNumber),
        name: '',
        way_points: [prevIdx, pointIdx]
      })
      prevIdx = pointIdx
    }
    // Final arrival step
    if (prevIdx < coords.length - 1) {
      steps.push({
        distance: 0,
        duration: 0,
        type: 10, // goal
        instruction: 'Arrive at destination',
        name: '',
        way_points: [prevIdx, coords.length - 1]
      })
    }
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: {
          engine: 'brouter',
          segments: [{ distance, duration, steps }],
          summary: { distance, duration },
          way_points: [0, coords.length - 1]
        }
      }
    ]
  }
}

// BRouter command code → ORS instruction type code
// (so our existing step-icon table keeps working)
function brouterCmdToOrsType(c) {
  if (c === 1) return 6   // continue / straight
  if (c === 2) return 0   // left
  if (c === 3) return 4   // slight left
  if (c === 4) return 2   // sharp left
  if (c === 5) return 1   // right
  if (c === 6) return 5   // slight right
  if (c === 7) return 3   // sharp right
  if (c === 8) return 12  // keep left
  if (c === 9) return 13  // keep right
  if (c === 10 || c === 11 || c === 33) return 9 // u-turn
  if (c >= 13 && c <= 32) return 7 // roundabout (enter)
  return 6
}

function brouterInstruction(c, exitNumber) {
  if (c === 1) return 'Continue straight'
  if (c === 2) return 'Turn left'
  if (c === 3) return 'Slight left'
  if (c === 4) return 'Sharp left'
  if (c === 5) return 'Turn right'
  if (c === 6) return 'Slight right'
  if (c === 7) return 'Sharp right'
  if (c === 8) return 'Keep left'
  if (c === 9) return 'Keep right'
  if (c === 10 || c === 11 || c === 33) return 'Make a U-turn'
  if (c >= 13 && c <= 22) {
    const exit = exitNumber || (c - 12)
    return `Take exit ${exit} at the roundabout`
  }
  if (c >= 23 && c <= 32) {
    const exit = exitNumber || (c - 22)
    return `Take exit ${exit} at the roundabout`
  }
  return 'Continue'
}

export function drawRoute(map, routeGeoJson) {
  // If layers already exist, just update the source — no flicker on re-route.
  const existing = map.getSource(SOURCE_ID)
  if (existing) {
    existing.setData(routeGeoJson)
    return
  }
  map.addSource(SOURCE_ID, { type: 'geojson', data: routeGeoJson })
  map.addLayer({
    id: CASING_ID,
    type: 'line',
    source: SOURCE_ID,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#013545', 'line-width': 9, 'line-opacity': 0.9 }
  })
  map.addLayer({
    id: LINE_ID,
    type: 'line',
    source: SOURCE_ID,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#38d1ff', 'line-width': 5 }
  })
}

/**
 * Long-press anywhere on the map to drop a new waypoint into the route.
 * MapLibre fires `contextmenu` on long-press (mobile) and right-click (desktop).
 * Replaces the old drag-on-line gesture, which was too fragile on touch — a
 * long-press is a deliberate ~500ms hold that taps and pans can't trigger.
 */
export function setupLongPressAdd(map, onAdd) {
  map.on('contextmenu', (e) => {
    if (typeof onAdd !== 'function') return
    // No active route → nothing to insert into
    e.preventDefault?.()
    onAdd({ lng: e.lngLat.lng, lat: e.lngLat.lat })
  })
}

export function drawEndpointMarkers(map, start, end) {
  if (startMarker) startMarker.remove()
  if (endMarker) endMarker.remove()

  const startEl = document.createElement('div')
  startEl.className = 'endpoint-marker endpoint-start'
  startEl.textContent = 'A'
  startMarker = new maplibregl.Marker({ element: startEl })
    .setLngLat([start.lng, start.lat])
    .addTo(map)

  const endEl = document.createElement('div')
  endEl.className = 'endpoint-marker endpoint-end'
  endEl.textContent = 'B'
  endMarker = new maplibregl.Marker({ element: endEl })
    .setLngLat([end.lng, end.lat])
    .addTo(map)
}

/**
 * Render orange numbered markers for via waypoints.
 * Each marker has a visible × button to remove it. Drag the body to move it.
 */
export function renderViaMarkers(map, vias, { onMove, onRemove }) {
  for (const m of viaMarkers) m.remove()
  viaMarkers = []

  vias.forEach((wp, idx) => {
    const wrap = document.createElement('div')
    wrap.className = 'via-wrap'

    const dot = document.createElement('div')
    dot.className = 'via-marker'
    dot.textContent = String(idx + 1)

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'via-remove'
    remove.setAttribute('aria-label', `Remove stop ${idx + 1}`)
    remove.textContent = '×'

    wrap.appendChild(dot)
    wrap.appendChild(remove)

    const marker = new maplibregl.Marker({ element: wrap, draggable: true })
      .setLngLat([wp.lng, wp.lat])
      .addTo(map)

    marker.on('dragend', () => {
      const ll = marker.getLngLat()
      onMove(idx, { lng: ll.lng, lat: ll.lat })
    })

    // Tap the × to remove. Stop propagation so it doesn't initiate a drag.
    const removeHandler = (ev) => {
      ev.stopPropagation()
      ev.preventDefault()
      onRemove(idx)
    }
    remove.addEventListener('click', removeHandler)
    remove.addEventListener('touchend', removeHandler)

    viaMarkers.push(marker)
  })
}

export function fitRouteBounds(map, routeGeoJson) {
  const coords = routeGeoJson?.features?.[0]?.geometry?.coordinates
  if (!coords || !coords.length) return
  let minLng = coords[0][0], minLat = coords[0][1]
  let maxLng = coords[0][0], maxLat = coords[0][1]
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  map.fitBounds(
    [[minLng, minLat], [maxLng, maxLat]],
    {
      padding: { top: 80, bottom: 280, left: 40, right: 40 },
      maxZoom: 16,
      duration: 700
    }
  )
}

export function clearRoute(map) {
  for (const id of [LINE_ID, CASING_ID]) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
  if (startMarker) { startMarker.remove(); startMarker = null }
  if (endMarker) { endMarker.remove(); endMarker = null }
  for (const m of viaMarkers) m.remove()
  viaMarkers = []
}
