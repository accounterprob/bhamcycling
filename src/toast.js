let toastEl = null
let hideTimer = null

function ensure() {
  if (toastEl) return toastEl
  toastEl = document.createElement('div')
  toastEl.className = 'toast'
  document.body.appendChild(toastEl)
  return toastEl
}

export function showToast(message, { type = 'info', duration = 2200 } = {}) {
  const el = ensure()
  el.textContent = message
  el.classList.toggle('error', type === 'error')
  el.classList.add('visible')
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => el.classList.remove('visible'), duration)
}
