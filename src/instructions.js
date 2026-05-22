import { computeBearing, haversine } from './map.js'

/* Trip UI — three pieces, two modes:
 *
 *   OVERVIEW mode:
 *     - bottom panel:  trip summary, profile toggle, "Start Trip"
 *     - top banner:    hidden
 *
 *   NAVIGATING mode (Apple/Google-Maps-style):
 *     - top banner:    big upcoming-turn callout that updates as you move
 *     - bottom panel:  thin footer with remaining time/distance + End button
 *     - full list:     hidden (we only show the next turn)
 */

let panelEl = null
let bannerEl = null
let appRoot = null
let mode = 'idle' // 'idle' | 'overview' | 'navigating'

let stepsData = []
let geometry = []
let currentStepIdx = -1
let lastDistanceToTurn = null
let currentProfile = 'cycling-electric'
let currentPrefs = { avoidHighways: true, avoidHills: false }
let currentDestName = ''
let currentSummary = { distance: 0, duration: 0 }

let onStartCb = null
let onCancelCb = null
let onProfileChangeCb = null
let onPrefsChangeCb = null

export function initTripPanel(rootEl, callbacks) {
  appRoot = rootEl
  onStartCb = callbacks.onStart
  onCancelCb = callbacks.onCancel
  onProfileChangeCb = callbacks.onProfileChange
  onPrefsChangeCb = callbacks.onPrefsChange

  panelEl = document.createElement('div')
  panelEl.className = 'trip-panel hidden'
  rootEl.appendChild(panelEl)

  bannerEl = document.createElement('div')
  bannerEl.className = 'nav-banner hidden'
  rootEl.appendChild(bannerEl)
}

export function showOverview(routeGeoJson, destName, profile, prefs) {
  ingestRoute(routeGeoJson)
  currentDestName = destName || 'Destination'
  currentProfile = profile
  if (prefs) currentPrefs = { ...currentPrefs, ...prefs }
  mode = 'overview'
  render()
  showPanel()
  bannerEl.classList.add('hidden')
}

export function updateRoute(routeGeoJson, profile, prefs) {
  ingestRoute(routeGeoJson)
  if (profile) currentProfile = profile
  if (prefs) currentPrefs = { ...currentPrefs, ...prefs }
  render()
}

export function startNavigating() {
  mode = 'navigating'
  currentStepIdx = -1
  lastDistanceToTurn = null
  render()
}

export function clearTrip() {
  mode = 'idle'
  stepsData = []
  geometry = []
  currentStepIdx = -1
  lastDistanceToTurn = null
  panelEl.classList.add('hidden')
  bannerEl.classList.add('hidden')
  appRoot.classList.remove('has-trip')
  document.documentElement.style.removeProperty('--trip-panel-height')
}

export function updateUpcomingStep(userLngLat) {
  if (mode !== 'navigating' || !stepsData.length || !geometry.length) return
  const idx = nearestStepIndex(userLngLat)
  const step = stepsData[idx]
  if (step?.way_points?.length >= 2) {
    const endGeomIdx = step.way_points[1]
    const stepEnd = geometry[endGeomIdx]
    if (stepEnd) lastDistanceToTurn = haversine(userLngLat, stepEnd)
  }
  if (idx !== currentStepIdx) {
    currentStepIdx = idx
    renderBanner()
  } else {
    // Step is the same; just refresh the live distance to the next turn
    const distEl = bannerEl.querySelector('.nav-banner-distance')
    if (distEl && lastDistanceToTurn != null) {
      distEl.textContent = formatDistance(lastDistanceToTurn)
    }
  }
}

/** Initial bearing along the first ~10m of the route — used to face the
 *  camera the right way the moment "Start Trip" is tapped. */
export function getInitialBearing() {
  if (geometry.length < 2) return null
  const start = geometry[0]
  let i = 1
  while (i < geometry.length && haversine(start, geometry[i]) < 10) i++
  if (i >= geometry.length) i = geometry.length - 1
  return computeBearing(start, geometry[i])
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

function showPanel() {
  panelEl.classList.remove('hidden')
  appRoot.classList.add('has-trip')
  const h = mode === 'overview' ? '46dvh' : '10dvh'
  document.documentElement.style.setProperty('--trip-panel-height', h)
}

function render() {
  panelEl.classList.toggle('mode-overview', mode === 'overview')
  panelEl.classList.toggle('mode-navigating', mode === 'navigating')
  if (mode === 'overview') {
    renderOverview()
    showPanel()
    bannerEl.classList.add('hidden')
  } else if (mode === 'navigating') {
    renderNavFooter()
    renderBanner()
    showPanel()
    bannerEl.classList.remove('hidden')
  }
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
      <div class="trip-profiles" role="radiogroup" aria-label="Routing mode">
        <button type="button" class="profile-btn" data-profile="cycling-electric" role="radio">⚡ E-bike</button>
        <button type="button" class="profile-btn" data-profile="cycling-regular" role="radio">🚲 Regular</button>
        <button type="button" class="profile-btn" data-profile="brouter-safety" role="radio">🛡️ Safest</button>
      </div>
      <div class="trip-prefs">
        <label class="pref-row">
          <input type="checkbox" data-pref="avoidHighways" />
          <span>Avoid highways &amp; busy roads</span>
        </label>
        <label class="pref-row">
          <input type="checkbox" data-pref="avoidHills" />
          <span>Avoid steep hills</span>
        </label>
        <div class="prefs-note hidden">Safest mode uses its own road-safety rules — toggles above don't apply.</div>
      </div>
      <button type="button" class="trip-start">Start Trip</button>
      <div class="trip-hint">Long-press the map to add a stop · tap × to remove</div>
    </div>
  `
  panelEl.querySelector('.trip-destination').textContent = currentDestName
  panelEl.querySelectorAll('.trip-stat-value')[0].textContent = formatDuration(currentSummary.duration)
  panelEl.querySelectorAll('.trip-stat-value')[1].textContent = formatDistance(currentSummary.distance)
  for (const btn of panelEl.querySelectorAll('.profile-btn')) {
    const active = btn.dataset.profile === currentProfile
    btn.classList.toggle('active', active)
    btn.setAttribute('aria-checked', active ? 'true' : 'false')
    btn.addEventListener('click', () => {
      const p = btn.dataset.profile
      if (p && p !== currentProfile && typeof onProfileChangeCb === 'function') {
        onProfileChangeCb(p)
      }
    })
  }
  const safest = currentProfile === 'brouter-safety'
  for (const cb of panelEl.querySelectorAll('input[data-pref]')) {
    const key = cb.dataset.pref
    cb.checked = !!currentPrefs[key]
    cb.disabled = safest
    cb.addEventListener('change', () => {
      if (typeof onPrefsChangeCb === 'function') {
        onPrefsChangeCb({ [key]: cb.checked })
      }
    })
  }
  panelEl.querySelector('.prefs-note')?.classList.toggle('hidden', !safest)
  panelEl.querySelector('.trip-prefs')?.classList.toggle('disabled', safest)
  panelEl.querySelector('.trip-close').addEventListener('click', () => {
    if (typeof onCancelCb === 'function') onCancelCb()
  })
  panelEl.querySelector('.trip-start').addEventListener('click', () => {
    if (typeof onStartCb === 'function') onStartCb()
  })
}

function renderNavFooter() {
  panelEl.innerHTML = `
    <div class="nav-footer">
      <div class="nav-summary">
        <span class="nav-duration"></span>
        <span class="nav-sep">·</span>
        <span class="nav-distance"></span>
      </div>
      <button type="button" class="nav-end">End</button>
    </div>
  `
  panelEl.querySelector('.nav-duration').textContent = formatDuration(currentSummary.duration)
  panelEl.querySelector('.nav-distance').textContent = formatDistance(currentSummary.distance)
  panelEl.querySelector('.nav-end').addEventListener('click', () => {
    if (typeof onCancelCb === 'function') onCancelCb()
  })
}

function renderBanner() {
  if (mode !== 'navigating' || !stepsData.length) {
    bannerEl.classList.add('hidden')
    return
  }
  const stepIdx = currentStepIdx >= 0 ? currentStepIdx : 0
  const step = stepsData[stepIdx]
  if (!step) { bannerEl.classList.add('hidden'); return }
  const distance = lastDistanceToTurn != null ? lastDistanceToTurn : (step.distance || 0)
  bannerEl.innerHTML = `
    <div class="nav-banner-icon">${stepIcon(step.type)}</div>
    <div class="nav-banner-body">
      <div class="nav-banner-distance"></div>
      <div class="nav-banner-instruction"></div>
    </div>
  `
  bannerEl.querySelector('.nav-banner-distance').textContent = formatDistance(distance)
  bannerEl.querySelector('.nav-banner-instruction').textContent =
    step.instruction || stepFallback(step)
  bannerEl.classList.remove('hidden')
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

const ICONS = {
  0: '←', 1: '→', 2: '↰', 3: '↱', 4: '↖', 5: '↗',
  6: '↑', 7: '⟲', 8: '⟳', 9: '↶', 10: '◉', 11: '▲',
  12: '⬉', 13: '⬈'
}
function stepIcon(type) { return ICONS[type] ?? '↑' }
function stepFallback(step) { return step.name ? `Continue on ${step.name}` : 'Continue' }
