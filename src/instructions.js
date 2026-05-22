/* Trip panel — two modes:
 *   OVERVIEW    : trip summary, profile toggle, "Start Trip" button (shown
 *                 after picking a destination, before tapping Start)
 *   NAVIGATING  : scrollable turn-by-turn list with upcoming-step highlight
 *
 * Same DOM container, content swaps based on mode.
 */

let panelEl = null
let appRoot = null
let mode = 'idle' // 'idle' | 'overview' | 'navigating'

let stepsData = []
let geometry = []
let currentStepIdx = -1
let currentProfile = 'cycling-regular'
let currentDestName = ''
let currentSummary = { distance: 0, duration: 0 }

let onStartCb = null
let onCancelCb = null
let onProfileChangeCb = null

export function initTripPanel(rootEl, callbacks) {
  appRoot = rootEl
  onStartCb = callbacks.onStart
  onCancelCb = callbacks.onCancel
  onProfileChangeCb = callbacks.onProfileChange

  panelEl = document.createElement('div')
  panelEl.className = 'trip-panel hidden'
  rootEl.appendChild(panelEl)
}

/** Show the trip overview after a fresh destination + route fetch. */
export function showOverview(routeGeoJson, destName, profile) {
  ingestRoute(routeGeoJson)
  currentDestName = destName || 'Destination'
  currentProfile = profile
  mode = 'overview'
  render()
  show()
}

/** Called when route data changes (drag-reroute, profile change). */
export function updateRoute(routeGeoJson, profile) {
  ingestRoute(routeGeoJson)
  if (profile) currentProfile = profile
  if (mode === 'overview') render()
  else if (mode === 'navigating') render()
}

/** Transition from OVERVIEW to NAVIGATING. */
export function startNavigating() {
  mode = 'navigating'
  currentStepIdx = -1
  render()
}

/** Tear everything down — used by Cancel / End Trip. */
export function clearTrip() {
  mode = 'idle'
  stepsData = []
  geometry = []
  currentStepIdx = -1
  panelEl.classList.add('hidden')
  appRoot.classList.remove('has-trip')
  document.documentElement.style.removeProperty('--trip-panel-height')
}

/** Live update from the geolocation watcher — only relevant during navigation. */
export function updateUpcomingStep(userLngLat) {
  if (mode !== 'navigating') return
  if (!stepsData.length || !geometry.length) return
  const idx = nearestStepIndex(userLngLat)
  if (idx === currentStepIdx) return
  currentStepIdx = idx
  for (const el of panelEl.querySelectorAll('.step')) {
    el.classList.toggle('upcoming', Number(el.dataset.idx) === idx)
  }
  const el = panelEl.querySelector(`.step[data-idx="${idx}"]`)
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

// --- internals ---

function ingestRoute(routeGeoJson) {
  const feature = routeGeoJson?.features?.[0]
  if (!feature) return
  geometry = feature.geometry.coordinates
  const props = feature.properties || {}
  stepsData = (props.segments || []).flatMap((s) => s.steps || [])
  currentSummary = {
    distance: props.summary?.distance ?? 0,
    duration: props.summary?.duration ?? 0
  }
}

function show() {
  panelEl.classList.remove('hidden')
  appRoot.classList.add('has-trip')
  // Hint for FAB offset — actual panel height varies by mode
  const h = mode === 'overview' ? '46dvh' : '44dvh'
  document.documentElement.style.setProperty('--trip-panel-height', h)
}

function render() {
  panelEl.classList.toggle('mode-overview', mode === 'overview')
  panelEl.classList.toggle('mode-navigating', mode === 'navigating')
  if (mode === 'overview') renderOverview()
  else if (mode === 'navigating') renderNavigating()
}

function renderOverview() {
  panelEl.innerHTML = `
    <div class="trip-overview">
      <div class="trip-head">
        <div class="trip-head-text">
          <div class="trip-label">Trip to</div>
          <div class="trip-destination"></div>
        </div>
        <button class="trip-close" type="button" aria-label="Cancel">✕</button>
      </div>
      <div class="trip-stats">
        <div class="trip-stat">
          <div class="trip-stat-value"></div>
          <div class="trip-stat-label">Time</div>
        </div>
        <div class="trip-stat">
          <div class="trip-stat-value"></div>
          <div class="trip-stat-label">Distance</div>
        </div>
      </div>
      <div class="trip-profiles" role="radiogroup" aria-label="Bike type">
        <button type="button" class="profile-btn" data-profile="cycling-regular" role="radio">🚲 Regular</button>
        <button type="button" class="profile-btn" data-profile="cycling-electric" role="radio">⚡ E-bike</button>
      </div>
      <button type="button" class="trip-start">Start Trip</button>
      <div class="trip-hint">Drag the route to add a stop · tap × to remove</div>
    </div>
  `
  panelEl.querySelector('.trip-destination').textContent = currentDestName
  panelEl.querySelectorAll('.trip-stat-value')[0].textContent = formatDuration(currentSummary.duration)
  panelEl.querySelectorAll('.trip-stat-value')[1].textContent = formatDistance(currentSummary.distance)
  for (const btn of panelEl.querySelectorAll('.profile-btn')) {
    btn.classList.toggle('active', btn.dataset.profile === currentProfile)
    btn.setAttribute('aria-checked', btn.dataset.profile === currentProfile ? 'true' : 'false')
    btn.addEventListener('click', () => {
      const p = btn.dataset.profile
      if (p && p !== currentProfile && typeof onProfileChangeCb === 'function') {
        onProfileChangeCb(p)
      }
    })
  }
  panelEl.querySelector('.trip-close').addEventListener('click', () => {
    if (typeof onCancelCb === 'function') onCancelCb()
  })
  panelEl.querySelector('.trip-start').addEventListener('click', () => {
    if (typeof onStartCb === 'function') onStartCb()
  })
}

function renderNavigating() {
  panelEl.innerHTML = `
    <div class="nav-header">
      <div class="nav-summary">
        <span class="nav-duration"></span>
        <span class="nav-sep">·</span>
        <span class="nav-distance"></span>
      </div>
      <button type="button" class="nav-end">End</button>
    </div>
    <div class="instructions-list" role="list"></div>
  `
  panelEl.querySelector('.nav-duration').textContent = formatDuration(currentSummary.duration)
  panelEl.querySelector('.nav-distance').textContent = formatDistance(currentSummary.distance)
  panelEl.querySelector('.nav-end').addEventListener('click', () => {
    if (typeof onCancelCb === 'function') onCancelCb()
  })
  const list = panelEl.querySelector('.instructions-list')
  stepsData.forEach((step, idx) => {
    const item = document.createElement('div')
    item.className = 'step'
    item.dataset.idx = String(idx)
    item.setAttribute('role', 'listitem')

    const icon = document.createElement('div')
    icon.className = 'step-icon'
    icon.textContent = stepIcon(step.type)

    const body = document.createElement('div')
    body.className = 'step-body'

    const instr = document.createElement('div')
    instr.className = 'step-instruction'
    instr.textContent = step.instruction || stepFallback(step)

    const dist = document.createElement('div')
    dist.className = 'step-distance'
    dist.textContent = formatDistance(step.distance || 0)

    body.appendChild(instr)
    body.appendChild(dist)
    item.appendChild(icon)
    item.appendChild(body)
    list.appendChild(item)
  })
}

function nearestStepIndex(userLngLat) {
  let bestI = 0
  let bestD = Infinity
  for (let i = 0; i < geometry.length; i++) {
    const d = haversine(userLngLat, geometry[i])
    if (d < bestD) { bestD = d; bestI = i }
  }
  for (let s = 0; s < stepsData.length; s++) {
    const wp = stepsData[s].way_points
    if (Array.isArray(wp) && wp.length >= 2 && bestI <= wp[1]) return s
  }
  return stepsData.length - 1
}

function haversine(a, b) {
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

function formatDistance(m) {
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`
}

function formatDuration(s) {
  const total = Math.max(1, Math.round(s / 60))
  if (total < 60) return `${total} min`
  const h = Math.floor(total / 60)
  const rem = total % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

// ORS instruction type codes
const ICONS = {
  0: '←', 1: '→', 2: '↰', 3: '↱', 4: '↖', 5: '↗',
  6: '↑', 7: '⟲', 8: '⟳', 9: '↶', 10: '◉', 11: '▲',
  12: '⬉', 13: '⬈'
}
function stepIcon(type) { return ICONS[type] ?? '↑' }
function stepFallback(step) { return step.name ? `Continue on ${step.name}` : 'Continue' }
