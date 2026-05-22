import maplibregl from 'maplibre-gl'

const ORS_BASE = 'https://api.openrouteservice.org/v2/directions'
const API_KEY = import.meta.env.VITE_ORS_API_KEY

const SOURCE_ID = 'route'
const CASING_ID = 'route-casing'
const LINE_ID = 'route-line'
const HIT_ID = 'route-hit' // invisible, wide, just for touch hit-testing

let startMarker = null
let endMarker = null
let viaMarkers = []
let ghostMarker = null

/**
 * Request a cycling route through an ordered list of waypoints.
 * @param {{lng:number,lat:number}[]} waypoints - At least 2; first = start, last = end.
 * @param {string} profile - ORS profile, e.g. 'cycling-regular'.
 */
export async function getRoute(waypoints, profile = 'cycling-regular') {
  if (!API_KEY) {
    throw new Error('Missing VITE_ORS_API_KEY (set it in .env)')
  }
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    throw new Error('Need at least 2 waypoints')
  }
  const url = `${ORS_BASE}/${profile}/geojson`
  const body = {
    coordinates: waypoints.map((w) => [w.lng, w.lat]),
    instructions: true,
    units: 'm',
    language: 'en',
    geometry: true
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
  // Invisible, very wide line so touch reliably hits the route on iPhone.
  map.addLayer({
    id: HIT_ID,
    type: 'line',
    source: SOURCE_ID,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#000', 'line-width': 32, 'line-opacity': 0 }
  })
}

/**
 * Wire up drag-to-add-waypoint on the route line. Call once after map load.
 * onAddVia({lng,lat}) is invoked when the user releases after a drag.
 */
export function setupRouteDrag(map, onAddVia) {
  const showGhost = (lngLat) => {
    if (!ghostMarker) {
      const el = document.createElement('div')
      el.className = 'drag-ghost'
      ghostMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat(lngLat)
        .addTo(map)
    } else {
      ghostMarker.setLngLat(lngLat)
    }
  }
  const hideGhost = () => {
    if (ghostMarker) { ghostMarker.remove(); ghostMarker = null }
  }

  const onDown = (e) => {
    // Single-touch only — let pinch-zoom pass through
    const touches = e.originalEvent?.touches
    if (touches && touches.length > 1) return
    e.preventDefault()

    const startPoint = e.point
    let committed = false
    map.dragPan.disable()
    map.getCanvas().style.cursor = 'grabbing'

    const onMove = (ev) => {
      const dx = ev.point.x - startPoint.x
      const dy = ev.point.y - startPoint.y
      if (!committed && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        committed = true
      }
      if (committed) showGhost(ev.lngLat)
    }
    const onUp = (ev) => {
      map.off('mousemove', onMove)
      map.off('touchmove', onMove)
      map.dragPan.enable()
      map.getCanvas().style.cursor = ''
      hideGhost()
      if (committed && ev?.lngLat && typeof onAddVia === 'function') {
        onAddVia({ lng: ev.lngLat.lng, lat: ev.lngLat.lat })
      }
    }
    map.on('mousemove', onMove)
    map.on('touchmove', onMove)
    map.once('mouseup', onUp)
    map.once('touchend', onUp)
    map.once('touchcancel', onUp)
  }

  map.on('mousedown', HIT_ID, onDown)
  map.on('touchstart', HIT_ID, onDown)
  map.on('mouseenter', HIT_ID, () => { map.getCanvas().style.cursor = 'grab' })
  map.on('mouseleave', HIT_ID, () => { map.getCanvas().style.cursor = '' })
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
 * Drag to move; long-press (mobile) or double-click (desktop) to remove.
 */
export function renderViaMarkers(map, vias, { onMove, onRemove }) {
  for (const m of viaMarkers) m.remove()
  viaMarkers = []

  vias.forEach((wp, idx) => {
    const el = document.createElement('div')
    el.className = 'via-marker'
    el.textContent = String(idx + 1)

    const marker = new maplibregl.Marker({ element: el, draggable: true })
      .setLngLat([wp.lng, wp.lat])
      .addTo(map)

    marker.on('dragend', () => {
      const ll = marker.getLngLat()
      onMove(idx, { lng: ll.lng, lat: ll.lat })
    })

    // Long-press to remove (mobile). Cancel if movement begins (= drag).
    let pressTimer = null
    const clearPress = () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null }
    }
    const startPress = () => {
      clearPress()
      pressTimer = setTimeout(() => onRemove(idx), 650)
    }
    el.addEventListener('touchstart', startPress, { passive: true })
    el.addEventListener('touchmove', clearPress, { passive: true })
    el.addEventListener('touchend', clearPress)
    el.addEventListener('touchcancel', clearPress)
    el.addEventListener('mousedown', startPress)
    el.addEventListener('mousemove', clearPress)
    el.addEventListener('mouseup', clearPress)
    el.addEventListener('mouseleave', clearPress)
    // Desktop convenience: double-click removes
    el.addEventListener('dblclick', (ev) => {
      ev.stopPropagation()
      onRemove(idx)
    })

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
  for (const id of [HIT_ID, LINE_ID, CASING_ID]) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
  if (startMarker) { startMarker.remove(); startMarker = null }
  if (endMarker) { endMarker.remove(); endMarker = null }
  for (const m of viaMarkers) m.remove()
  viaMarkers = []
  if (ghostMarker) { ghostMarker.remove(); ghostMarker = null }
}
