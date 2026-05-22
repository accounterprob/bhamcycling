import { geocode } from './geocoding.js'
import { getFavorites, updateFavorite } from './favorites.js'
import { showToast } from './toast.js'

let onDestinationSelected = null
let panelEl = null
let searchInput = null
let resultsEl = null
let favoritesEl = null
let debounceTimer = null
let pendingEditId = null

export function initDestinationPanel(rootEl, onSelect) {
  onDestinationSelected = onSelect

  panelEl = document.createElement('div')
  panelEl.className = 'destination-panel collapsed'
  panelEl.innerHTML = `
    <button class="search-toggle" type="button">
      <span class="search-toggle-icon">⌕</span>
      <span class="search-toggle-text">Where to?</span>
    </button>
    <div class="search-body">
      <div class="search-row">
        <input
          type="search"
          class="search-input"
          placeholder="Search address or place"
          inputmode="search"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
        />
        <button class="icon-btn search-close" type="button" aria-label="Close">✕</button>
      </div>
      <div class="search-results" role="listbox"></div>
      <div class="favorites-section">
        <h3>Favorites</h3>
        <div class="favorites-list"></div>
      </div>
    </div>
  `
  rootEl.appendChild(panelEl)

  searchInput = panelEl.querySelector('.search-input')
  resultsEl = panelEl.querySelector('.search-results')
  favoritesEl = panelEl.querySelector('.favorites-list')

  panelEl.querySelector('.search-toggle').addEventListener('click', open)
  panelEl.querySelector('.search-close').addEventListener('click', close)
  searchInput.addEventListener('input', onSearchInput)
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close()
  })

  renderFavorites()
}

export function openDestinationPanel() { open() }
export function closeDestinationPanel() { close() }

function open() {
  panelEl.classList.remove('collapsed')
  // Slight delay so iOS Safari reliably opens the keyboard
  setTimeout(() => searchInput.focus(), 50)
}

function close() {
  panelEl.classList.add('collapsed')
  searchInput.value = ''
  resultsEl.innerHTML = ''
  pendingEditId = null
  searchInput.blur()
}

function onSearchInput() {
  clearTimeout(debounceTimer)
  const q = searchInput.value.trim()
  if (q.length < 3) {
    resultsEl.innerHTML = ''
    return
  }
  debounceTimer = setTimeout(async () => {
    try {
      const results = await geocode(q, 6)
      renderResults(results)
    } catch (e) {
      console.error(e)
      resultsEl.innerHTML = ''
      const err = document.createElement('div')
      err.className = 'result-item error'
      err.textContent = 'Search failed. Try again.'
      resultsEl.appendChild(err)
    }
  }, 350)
}

function renderResults(results) {
  resultsEl.innerHTML = ''
  if (results.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'result-item'
    empty.textContent = 'No matches found.'
    resultsEl.appendChild(empty)
    return
  }
  for (const r of results) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'result-item'
    btn.textContent = r.name
    btn.title = r.fullName
    btn.addEventListener('click', () => {
      if (pendingEditId) {
        // We're setting a favorite's location
        updateFavorite(pendingEditId, {
          lat: r.lat,
          lon: r.lon,
          address: r.fullName
        })
        showToast('Favorite saved')
        pendingEditId = null
        renderFavorites()
        close()
      } else {
        selectDestination({ name: r.name, lat: r.lat, lon: r.lon })
      }
    })
    resultsEl.appendChild(btn)
  }
}

function renderFavorites() {
  const favs = getFavorites()
  favoritesEl.innerHTML = ''
  for (const f of favs) {
    const has = Number.isFinite(f.lat) && Number.isFinite(f.lon)
    const row = document.createElement('div')
    row.className = 'favorite-row'

    const go = document.createElement('button')
    go.type = 'button'
    go.className = 'favorite-go'
    go.disabled = !has
    go.innerHTML = `
      <span class="fav-icon">★</span>
      <span class="fav-name"></span>
      ${has ? '' : '<span class="fav-empty">(tap ⋯ to set)</span>'}
    `
    go.querySelector('.fav-name').textContent = f.name
    go.addEventListener('click', () => {
      if (has) selectDestination({ name: f.name, lat: f.lat, lon: f.lon })
    })

    const edit = document.createElement('button')
    edit.type = 'button'
    edit.className = 'favorite-edit'
    edit.setAttribute('aria-label', `Edit ${f.name}`)
    edit.textContent = '⋯'
    edit.addEventListener('click', () => {
      pendingEditId = f.id
      searchInput.value = f.address || f.name
      searchInput.focus()
      searchInput.dispatchEvent(new Event('input'))
      showToast(`Pick a location for ${f.name}`, { duration: 2500 })
    })

    row.appendChild(go)
    row.appendChild(edit)
    favoritesEl.appendChild(row)
  }
}

function selectDestination(dest) {
  close()
  if (onDestinationSelected) onDestinationSelected(dest)
}
