let panelEl = null
let listEl = null
let summaryDistanceEl = null
let summaryDurationEl = null
let onClearCb = null

let stepsData = []
let geometry = []
let currentStepIdx = -1
let appRoot = null

export function initInstructionsPanel(rootEl, onClear) {
  appRoot = rootEl
  onClearCb = onClear

  panelEl = document.createElement('div')
  panelEl.className = 'instructions-panel'
  panelEl.innerHTML = `
    <div class="instructions-header">
      <div class="route-summary">
        <span class="summary-distance"></span>
        <span class="summary-duration"></span>
      </div>
      <button class="close-route" type="button" aria-label="Clear route">✕</button>
    </div>
    <div class="instructions-list" role="list"></div>
  `
  rootEl.appendChild(panelEl)

  listEl = panelEl.querySelector('.instructions-list')
  summaryDistanceEl = panelEl.querySelector('.summary-distance')
  summaryDurationEl = panelEl.querySelector('.summary-duration')

  panelEl.querySelector('.close-route').addEventListener('click', () => {
    clearInstructions()
    if (onClearCb) onClearCb()
  })
}

export function setRoute(routeGeoJson) {
  const feature = routeGeoJson?.features?.[0]
  if (!feature) return
  geometry = feature.geometry.coordinates
  const props = feature.properties || {}
  stepsData = (props.segments || []).flatMap((seg) => seg.steps || [])

  const distance = props.summary?.distance ?? 0
  const duration = props.summary?.duration ?? 0
  summaryDistanceEl.textContent = formatDistance(distance)
  summaryDurationEl.textContent = formatDuration(duration)

  renderSteps()
  show()
  currentStepIdx = -1
}

export function clearInstructions() {
  stepsData = []
  geometry = []
  currentStepIdx = -1
  listEl.innerHTML = ''
  hide()
}

export function updateUpcomingStep(userLngLat) {
  if (!stepsData.length || !geometry.length) return
  const idx = nearestStepIndex(userLngLat)
  if (idx === currentStepIdx) return
  currentStepIdx = idx
  for (const el of listEl.querySelectorAll('.step')) {
    el.classList.toggle('upcoming', Number(el.dataset.idx) === idx)
  }
  const el = listEl.querySelector(`.step[data-idx="${idx}"]`)
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

function renderSteps() {
  listEl.innerHTML = ''
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
    listEl.appendChild(item)
  })
}

function show() {
  panelEl.classList.add('visible')
  appRoot.classList.add('has-instructions')
  // Approximate panel height for FAB offset (CSS reads --instructions-height)
  document.documentElement.style.setProperty('--instructions-height', '40dvh')
}

function hide() {
  panelEl.classList.remove('visible')
  appRoot.classList.remove('has-instructions')
  document.documentElement.style.removeProperty('--instructions-height')
}

function nearestStepIndex(userLngLat) {
  let bestI = 0
  let bestD = Infinity
  for (let i = 0; i < geometry.length; i++) {
    const d = haversine(userLngLat, geometry[i])
    if (d < bestD) { bestD = d; bestI = i }
  }
  // Map nearest geometry index → step whose way_points end at or beyond it
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
// https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/instruction-types
const ICONS = {
  0: '←',   // Left
  1: '→',   // Right
  2: '↰',   // Sharp left
  3: '↱',   // Sharp right
  4: '↖',   // Slight left
  5: '↗',   // Slight right
  6: '↑',   // Straight
  7: '⟲',   // Enter roundabout
  8: '⟳',   // Exit roundabout
  9: '↶',   // U-turn
  10: '◉',  // Goal
  11: '▲',  // Depart
  12: '⬉',  // Keep left
  13: '⬈'   // Keep right
}

function stepIcon(type) {
  return ICONS[type] ?? '↑'
}

function stepFallback(step) {
  return step.name ? `Continue on ${step.name}` : 'Continue'
}
