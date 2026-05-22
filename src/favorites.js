const KEY = 'bham-cycle-favorites-v1'

// Samford University has well-known coordinates so we seed it.
// Home and Wildforest are left empty for the user to set via the edit button.
const DEFAULTS = [
  { id: 'home', name: 'Home', lat: null, lon: null, address: null },
  {
    id: 'samford',
    name: 'Samford University',
    lat: 33.4647,
    lon: -86.7920,
    address: '800 Lakeshore Dr, Birmingham, AL 35229'
  },
  { id: 'wildforest', name: 'Wildforest Apartments', lat: null, lon: null, address: null }
]

export function getFavorites() {
  const raw = localStorage.getItem(KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    } catch {
      /* fall through to defaults */
    }
  }
  saveFavorites(DEFAULTS)
  return [...DEFAULTS]
}

export function saveFavorites(list) {
  localStorage.setItem(KEY, JSON.stringify(list))
}

export function updateFavorite(id, updates) {
  const list = getFavorites()
  const idx = list.findIndex((f) => f.id === id)
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...updates }
    saveFavorites(list)
  }
  return list
}

export function addFavorite(fav) {
  const list = getFavorites()
  list.push({ id: `fav-${Date.now()}`, ...fav })
  saveFavorites(list)
  return list
}

export function removeFavorite(id) {
  const list = getFavorites().filter((f) => f.id !== id)
  saveFavorites(list)
  return list
}
