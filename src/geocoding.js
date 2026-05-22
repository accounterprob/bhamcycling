const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'

// Roughly bounds the Birmingham metro to bias search results.
// Format: left,top,right,bottom (lon,lat,lon,lat)
const BHAM_VIEWBOX = '-87.05,33.70,-86.55,33.30'

export async function geocode(query, limit = 6) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: String(limit),
    addressdetails: '1',
    viewbox: BHAM_VIEWBOX,
    bounded: '0',
    countrycodes: 'us'
  })
  const res = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
    headers: { Accept: 'application/json' }
  })
  if (!res.ok) throw new Error(`Nominatim ${res.status}`)
  const data = await res.json()
  return data.map((item) => ({
    name: shortName(item),
    fullName: item.display_name,
    lat: parseFloat(item.lat),
    lon: parseFloat(item.lon),
    type: item.type
  }))
}

function shortName(item) {
  const a = item.address || {}
  const primary =
    item.name ||
    a.amenity ||
    a.shop ||
    a.building ||
    [a.house_number, a.road].filter(Boolean).join(' ') ||
    a.road ||
    a.suburb ||
    a.neighbourhood ||
    a.city ||
    item.display_name.split(',')[0]
  const region = a.city || a.town || a.village || a.suburb || ''
  return region && region !== primary ? `${primary}, ${region}` : primary
}
