# Bham Cycle Nav

Personal cycling commuter navigation PWA for Birmingham, AL. Single-user, mobile-first, portrait handlebar-mount UI.

## Stack

- [Vite](https://vitejs.dev/) + vanilla JS
- [MapLibre GL JS](https://maplibre.org/) — vector map renderer
- [OpenFreeMap](https://openfreemap.org/) — free vector tiles, no key
- [OpenRouteService](https://openrouteservice.org/) — cycling routes (free API key required)
- [Nominatim](https://nominatim.openstreetmap.org/) — address search, no key
- Web APIs: Geolocation, (Wake Lock, Speech Synthesis — coming later)

## Setup

```sh
npm install
cp .env.example .env
# edit .env and paste your OpenRouteService API key
```

Get a free ORS key at https://openrouteservice.org/dev/#/signup (sign in, then "Request a token", select the **Free** plan).

## Run locally

```sh
npm run dev
```

Opens at http://localhost:5173/.

### Testing on iPhone

iOS Safari requires **HTTPS** for the Geolocation API to work, so the LAN URL printed by Vite won't get a location fix on your phone. Options:

1. **Recommended — deploy and test on GitHub Pages.** Fast enough to iterate, and matches the production environment exactly. (See deploy section below.)
2. **Local HTTPS tunnel** — install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) once, then in another terminal:
   ```sh
   cloudflared tunnel --url http://localhost:5173
   ```
   Open the printed `https://*.trycloudflare.com` URL on your iPhone.

When you visit the site on your phone, accept the **Location** prompt. To install as a PWA: Share → Add to Home Screen.

## Deploy to GitHub Pages

1. Create a new repo on GitHub and push:
   ```sh
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. In the repo on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → New repository secret:**
   - Name: `VITE_ORS_API_KEY`
   - Value: your OpenRouteService key
4. Push to `main`. The workflow at `.github/workflows/deploy.yml` builds and publishes the site. The URL shows up in the Pages settings once the first run finishes.

> ⚠️ **Key visibility.** Vite inlines `import.meta.env.VITE_*` into the built JS bundle, so anyone who loads the deployed site can read your ORS key. That's acceptable for a personal single-user app — just keep an eye on usage in the [ORS dashboard](https://openrouteservice.org/dev/#/home) and rotate the key if it spikes.

## Project layout

```
.
├── index.html                  Vite entry
├── vite.config.js              base: './' so it deploys to any Pages path
├── .env.example                copy to .env, add your ORS key
├── .github/workflows/deploy.yml CI build + Pages deploy
├── public/
│   ├── manifest.webmanifest    PWA manifest
│   ├── sw.js                   service worker (offline shell + tile cache)
│   ├── icon.svg                source icon
│   ├── icon-192.png            manifest icon
│   ├── icon-512.png            manifest icon
│   └── apple-touch-icon-180.png iOS home-screen icon
└── src/
    ├── main.js                 wires modules together + registers SW
    ├── style.css               mobile-first CSS, safe-area aware
    ├── map.js                  MapLibre init + geolocation watch
    ├── geocoding.js            Nominatim search (BHAM-biased viewbox)
    ├── favorites.js            localStorage CRUD, seeded entries
    ├── destination.js          bottom-sheet search + favorites UI
    ├── routing.js              ORS request + route line + drag-to-add waypoints
    ├── instructions.js         turn-by-turn list, highlights upcoming step
    └── toast.js                small status messages
```

To regenerate the PNG icons from `public/icon.svg` (macOS):

```sh
cd public
sips -s format png -Z 180 icon.svg --out apple-touch-icon-180.png
sips -s format png -Z 192 icon.svg --out icon-192.png
sips -s format png -Z 512 icon.svg --out icon-512.png
```

## Status

- [x] **Phase 1** — Map with current location + recenter button
- [x] **Phase 2** — Destination search (Nominatim) + Favorites (localStorage, seeded Home / Samford / Wildforest)
- [x] **Phase 3** — Cycling route from ORS with A/B endpoint markers
- [x] **Phase 4** — Turn-by-turn instructions panel, highlights upcoming step
- [x] **Drag-to-reroute** — drag the route line to add a via, drag/long-press vias to move/remove
- [x] **PWA** — manifest + service worker, installs to iOS home screen, offline app shell + tile cache

Up next:

- [ ] Voice prompts via SpeechSynthesis
- [ ] Wake Lock (keep screen on while navigating)
- [ ] Off-route detection and automatic re-route
- [ ] Profile switch: `cycling-regular` ↔ `cycling-electric`

## Install on iPhone

1. Open the deployed GitHub Pages URL in **Safari** (must be HTTPS — the PWA install + Geolocation both require it).
2. Tap the **Share** button → scroll down → **Add to Home Screen** → Add.
3. Tap the new app icon. It launches full-screen with no Safari chrome (`display: standalone`).
4. The service worker caches the app shell + map tiles you've visited, so the basics still work briefly if cell signal drops mid-ride. (Routing and search still need network.)

> iOS evicts PWA storage after about 7 days of no use. If the app feels "fresh" after a long gap, that's why — open it now and then to keep its data warm.

## Notes

- The "Home" and "Wildforest Apartments" favorites are seeded as empty. Tap the `⋯` next to each, search for the actual address, and pick it — the location is saved to `localStorage` (`bham-cycle-favorites-v1`).
- Nominatim's public instance is rate-limited (~1 req/sec). The search box debounces 350ms, which is well under the limit for personal use.
- OpenFreeMap is community-funded with no usage limits, but if you want to swap to a self-hosted style, change `OPENFREEMAP_STYLE` in `src/map.js`.
