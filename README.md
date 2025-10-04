# EasyWeather — README

A polished weather experience that ships as both a **Next.js PWA** and a **browser extension**. It fetches forecasts and AQI from **Open‑Meteo**, features timezone‑aware hourly & 7‑day views, animated condition backgrounds, and a lightweight overlay widget you can inject on any site.

---

## ✨ Features

* **Next.js App (PWA)**

  * Current conditions, next‑hours strip, 24h chart, 7‑day outlook
  * Accurate icons from Open‑Meteo `weathercode`
  * Timezone‑aware hour labels (uses IANA TZ, never `auto` in the client)
  * Favorites & recents (per‑user, cookie‑scoped localStorage keys)
  * Installable PWA with offline shell & service worker
  * Animated GIF backgrounds per condition (card‑only, not full page)

* **Browser Extension**

  * Bottom‑right overlay widget with skeleton loader
  * Geolocation reverse lookup → city label
  * Manual city entry + refresh, persists last city
  * Optional animated GIF backgrounds (configurable)

* **API**

  * `/api/forecast` edge route (server) proxies Open‑Meteo
  * Supports `?city=Name` **or** `?lat=..&lon=..`
  * Merges **current**, **hourly**, **daily**, and **air quality** (EU AQI, PM2.5)
  * Normalizes questionable upstream keys & returns a valid **IANA timezone**

---

## 🗂️ Repository structure

```
apps/web/
  ├─ public/
  │   ├─ manifest.json        # PWA manifest
  │   ├─ icon-192.png
  │   ├─ icon-512.png
  │   └─ offline.html
  ├─ src/app/
  │   ├─ api/forecast/route.ts  # API route
  │   ├─ page.tsx               # Main UI
  │   └─ style.css              # App styles (classes .wg-*)
  ├─ service-worker.js
  └─ ... Next.js project files

extension/
  ├─ manifest.json or manifest_v2.json
  ├─ content.js
  ├─ background.js (optional)
  ├─ popup.html / popup.js / panel.css (optional)
  └─ icons/
```

> Your codebase may use a single repo with both the Next.js app and the extension, or separate repos. Paths in this README assume the **Next.js app** lives at `apps/web` and the **extension** lives at `extension`.

---

## ⚙️ Requirements

* Node.js 18+
* pnpm / npm / yarn (your choice)
* A modern browser for testing (Chrome, Firefox)
* HTTPS origin (for geolocation in production)

Open‑Meteo is a free, no‑key API, so you don’t need credentials.

---

## 🚀 Quick start (local dev)

### 1) Install & run the Next.js app

```bash
cd apps/web
pnpm install   # or npm install / yarn
pnpm dev       # http://localhost:3000
```

### 2) Load the extension (optional)

* **Chrome (MV2 temporary loading)**

  1. Go to `chrome://extensions` → enable **Developer mode**
  2. *Load unpacked* → select the `extension/` folder

* **Firefox**

  1. Go to `about:debugging#/runtime/this-firefox`
  2. *Load Temporary Add‑on…* → pick any file in `extension/`

The extension’s overlay widget will call your local app at `http://localhost:3000/api/forecast` by default.

---

## 🧠 Architecture at a glance

* **Client (page.tsx)** fetches from **our own API** (`/api/forecast`).
* **Server (route.ts)** calls Open‑Meteo: **geocoding**, **weather**, **air quality**.
* We return one normalized JSON payload with `place`, `timezone`, `current_weather`, `hourly`, `daily`, and `air_quality`.
* The client computes:

  * `nowIdx` (closest hourly item to current time)
  * Icons from `weathercode`
  * Hour labels using `Intl.DateTimeFormat(..., { timeZone: resolvedTZ })`
  * Animated background per conditions (rain/snow/storm/fog/sunny/cloudy/night)

---

## 🔌 API contract

### `GET /api/forecast`

**Query params:**

* `city=Stockholm` **or** `lat=59.33&lon=18.07`

**Response:**

```ts
{
  place: {
    name: string,
    country?: string,
    admin1?: string,
    latitude: number,
    longitude: number,
    timezone?: string        // IANA tz, never 'auto'
  },
  timezone: string,          // duplicated for convenience
  current_weather: {
    temperature: number,
    weathercode: number,
    windspeed: number,
    time: string             // local ISO from Open‑Meteo
  } | null,
  hourly: {
    time: string[],
    temperature_2m?: number[],
    apparent_temperature?: number[],
    relative_humidity_2m?: number[],
    precipitation_probability?: number[],
    weathercode?: number[],
  } | null,
  daily: {
    time: string[],
    weathercode?: number[],
    temperature_2m_max?: number[],
    temperature_2m_min?: number[],
    sunrise?: string[],
    sunset?: string[],
  } | null,
  air_quality: {
    european_aqi: number[],
    pm2_5: number[],
    time: string[],
    current: { european_aqi?: number; pm2_5?: number } | null
  }
}
```

**Notes**

* If Open‑Meteo returns an invalid timezone or `auto`, the API **normalizes** it to a valid IANA TZ (falls back to `UTC`).
* If the upstream ever returns a malformed key (e.g. `temperature_2_ m_min`), the API **copies** it into the proper `temperature_2m_min` at runtime.

---

## 🖥️ Frontend (page.tsx)

Key behaviors:

* Debounced geocoding suggestions (`/v1/search?name=`)
* Two fetch modes:

  * By **city string**
  * By **coordinates** (from the browser’s geolocation)
* Derivations aligned to *current hour* (`nowIdx`):

  * `nowTemp`, `nowFeels`, `nowHumidity`, `nowPrecipProb`
  * `conditions` → theme + label
  * `bgClass` for page gradient
* **Charts**: Recharts 24h temps (start at `nowIdx`), and a horizontal strip of hourly icons.
* **Favorites & Recents**: stored with per‑user cookie key `wg_uid` (`wg:${uid}:*`).
* **Card‑only GIF backgrounds**: ensure CSP allows these sources if you deploy with strict CSP (see below).

---

## 🎨 Styling & GIF backgrounds

The app uses a small CSS file (`style.css`) with utility‑like classes (`.wg-*`). Card backgrounds switch based on the computed theme:

* rain → `https://www.gifcen.com/.../rain-gif-9.gif`
* snow → `https://sanjuanheadwaters.org/.../snow-falling-gif.gif`
* storm → `https://cdn.pixabay.com/.../645_512.gif`
* fog → `https://i.pinimg.com/originals/.../fog.gif`
* sunny → Google Images thumbnail URL (demo only)
* cloudy → `https://i.pinimg.com/originals/.../clouds.gif`
* night → `https://cdn.pixabay.com/.../23-18-03-337_512.gif`

> **CSP**: If you set a strict Content‑Security‑Policy on Vercel, you must allow `img-src` for the above hosts (or self‑host the assets under `/public/anim/` and use `/_next/static/media` or `/anim/…`). Otherwise, GIFs will not render in production.

Example `next.config.js` header for CSP (simplified):

```js
// next.config.js (example)
module.exports = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "img-src 'self' data: https://cdn.pixabay.com https://i.pinimg.com https://www.gifcen.com https://sanjuanheadwaters.org",
            ].join("; ")
          },
        ],
      },
    ];
  },
};
```

---

## 📦 Service worker (PWA)

File: `apps/web/service-worker.js`

* App‑shell caching (`/`, manifest, icons, offline page)
* **Network‑first** for HTML/CSS/JS so updates appear promptly
* **Cache‑first** for images/icons

Register it in your app root or `_document` if desired. In practice, Next.js can manage a service worker via plugins too—this repo uses a simple custom SW.

---

## 🧩 Browser extension

### Manifest

* **Firefox** (Manifest v2): `browser_action`, `background.scripts`, `permissions: ["geolocation","storage"]`
* **Chrome** (Manifest v3): use `action`, `background.service_worker`, and replace `browser.*` with `chrome.*` in background code.

### Files

* `content.js` – injects the bottom‑right widget into every page
* `popup.html` / `popup.js` – optional popup UI that also calls your API
* `background.js` – optional badge text updater (use `chrome.action.*` on MV3)

**Important:** If your widget loads GIFs from third‑party sites, those hosts must be allowed by extension policies in some browsers. Because the widget runs *in the page*, the page’s CSP can also block external images. If a site blocks them, your fallback is to use a gradient or **self‑host** the GIFs and load them from your app domain (which most sites’ CSPs allow as same‑origin).

---

## 🔐 Production (Vercel) notes

* Geolocation in the browser **requires HTTPS**.
* If you see `Invalid time zone specified: auto`, ensure the API never returns `"auto"` to the client. (This repo’s `route.ts` normalizes it.)
* If your **manifest.json** responds with **401** on Vercel:

  * Make sure it’s placed under **`/public/manifest.json`**
  * Do not wrap it with auth or middleware; it must be publicly readable
* If **7‑day** isn’t showing in prod:

  * Confirm your API adds `daily=... ,weathercode` to the Open‑Meteo URL
  * Open devtools → Network → check `/api/forecast` response shape

---

## 🧪 Troubleshooting

### “Invalid time zone specified: auto”

* Your client tried to format a date with `timeZone: "auto"`. Make sure your `/api/forecast` replaces `auto` with a valid IANA TZ or `UTC`.

### “Could not detect your city” / slow reverse geocode

* Reverse geocoding is best effort and can be slow on some networks. The client falls back to the last city or a default (Stockholm). You can increase timeouts or prefer `lat/lon` fetches and display the coordinates while waiting for name lookup.

### GIFs not showing

* Page CSP likely blocked external `img-src`. Self‑host the GIFs (recommended) **or** relax CSP with allowed hosts.

### Build fails with ESLint `no-explicit-any`

* The project types avoid `any`. If you add new code, prefer `unknown` + type guards.

### Popup/Badge fails in Chrome MV3

* Use `chrome.action.*` instead of `browser.browserAction.*`.
* Background is a **service worker** (module), not a persistent page.

---

## 📈 Performance tips

* Use `cache: "no-store"` for API calls during development; add SWR or caching in production if needed.
* Keep GIF overlays **card‑only** and slightly transparent.
* Batch state updates when possible; memoize derived values (`useMemo`).

---

## ♿ Accessibility & UX

* Buttons have `aria-label`s and `title`s where useful.
* Keyboard focus styles on inputs and interactive chips.
* Color contrast is maintained on primary controls.

---

## 🔧 Commands

```bash
# Dev
pnpm dev

# Build
pnpm build

# Start (production)
pnpm start

# Lint
pnpm lint
```

---

## 📄 License

MIT (or your preferred license). Replace this section if you require different terms.

---

## 🙌 Acknowledgements

* Weather & Air Quality: **Open‑Meteo**
* Icons: **Lucide**
* Charts: **Recharts**
* Hosting: **Vercel**

If you run into issues, open devtools → **Network** tab, inspect `/api/forecast` payload, and compare it to the **API contract** above. That’s almost always the fastest path to resolution.
