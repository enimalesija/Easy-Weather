// apps/extension/content.js

const API_BASE = "https://easy-weather-three.vercel.app";
const LS_KEY = "wg:lastCity";

/* ---------------------------------------
   Weather mapping (Open-Meteo)
--------------------------------------- */
const WEATHER_MAP = {
  0: { icon: "☀️", theme: "sunny", label: "Clear sky" },
  1: { icon: "🌤️", theme: "cloudy", label: "Mainly clear" },
  2: { icon: "⛅", theme: "cloudy", label: "Partly cloudy" },
  3: { icon: "☁️", theme: "cloudy", label: "Overcast" },
  45: { icon: "🌫️", theme: "fog", label: "Fog" },
  48: { icon: "🌫️", theme: "fog", label: "Rime fog" },
  51: { icon: "🌦️", theme: "rain", label: "Light drizzle" },
  53: { icon: "🌦️", theme: "rain", label: "Moderate drizzle" },
  55: { icon: "🌧️", theme: "rain", label: "Dense drizzle" },
  61: { icon: "🌦️", theme: "rain", label: "Light rain" },
  63: { icon: "🌧️", theme: "rain", label: "Moderate rain" },
  65: { icon: "🌧️", theme: "rain", label: "Heavy rain" },
  71: { icon: "❄️", theme: "snow", label: "Light snow" },
  73: { icon: "❄️", theme: "snow", label: "Moderate snow" },
  75: { icon: "❄️", theme: "snow", label: "Heavy snow" },
  95: { icon: "⛈️", theme: "storm", label: "Thunderstorm" },
  96: { icon: "⛈️", theme: "storm", label: "Thunderstorm w/ hail" },
  99: { icon: "⛈️", theme: "storm", label: "Severe thunderstorm" },
};

/* ---------------------------------------
   Remote GIFs (unchanged URLs)
--------------------------------------- */
function urlForTheme(theme) {
  switch (theme) {
    case "rain":
      return "https://www.gifcen.com/wp-content/uploads/2023/08/rain-gif-9.gif";
    case "snow":
      return "https://sanjuanheadwaters.org/wp-content/uploads/2023/02/snow-falling-gif.gif";
    case "storm":
      return "https://cdn.pixabay.com/animation/2025/03/20/16/33/16-33-20-645_512.gif";
    case "fog":
      return "https://i.pinimg.com/originals/03/53/cd/0353cdf9b3b43ea8e16506cde3ec94ef.gif";
    case "sunny":
      return "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT56YfDy5qmq-mfIHirK9AX-76K4DcMlTBr2Q&s";
    case "cloudy":
      return "https://i.pinimg.com/originals/b6/7f/61/b67f61a1364ea22a050d701c7bf7858f.gif";
    case "night":
      return "https://cdn.pixabay.com/animation/2023/09/06/23/18/23-18-03-337_512.gif";
    default:
      return ""; // handled with gradient fallback
  }
}

/* ---------------------------------------
   Helpers
--------------------------------------- */
function fetchWithTimeout(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal, cache: "no-store" }).finally(() =>
    clearTimeout(t)
  );
}
function el(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  if (!Array.isArray(children)) children = [children];
  children
    .filter(Boolean)
    .forEach((c) =>
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c)
    );
  return n;
}

/* ---------------------------------------
   Data fetchers
--------------------------------------- */
async function getWeather(city = "Stockholm") {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/forecast?city=${encodeURIComponent(city)}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    // Choose the hourly index closest to current time / current_weather.time
    const times = json?.hourly?.time || [];
    const refTime = json?.current_weather?.time
      ? new Date(json.current_weather.time).getTime()
      : Date.now();
    let idx = 0,
      best = Infinity;
    for (let i = 0; i < times.length; i++) {
      const d = Math.abs(new Date(times[i]).getTime() - refTime);
      if (d < best) {
        best = d;
        idx = i;
      }
    }

    const code =
      json?.hourly?.weathercode?.[idx] ??
      json?.current_weather?.weathercode ??
      0;
    const meta = WEATHER_MAP[code] || {
      icon: "❓",
      theme: "default",
      label: "Unknown",
    };

    return {
      temp: Math.round(
        json?.current_weather?.temperature ??
          json?.hourly?.temperature_2m?.[idx] ??
          0
      ),
      feels: Math.round(json?.hourly?.apparent_temperature?.[idx] ?? 0),
      humidity: json?.hourly?.relative_humidity_2m?.[idx] ?? "-",
      rain: json?.hourly?.precipitation_probability?.[idx] ?? "-",
      wind: Math.round(json?.current_weather?.windspeed ?? 0),
      city: json?.place?.name || city,
      icon: meta.icon,
      theme: meta.theme,
      label: meta.label,
    };
  } catch (e) {
    console.error("[EasyWeather] fetch failed:", e);
    return {
      temp: "?",
      feels: "?",
      humidity: "?",
      rain: "?",
      wind: "?",
      city: "Error",
      icon: "⚠️",
      theme: "default",
      label: "Error fetching",
    };
  }
}

async function detectCity() {
  return new Promise((resolve) => {
    const fallback = localStorage.getItem(LS_KEY) || "Stockholm";
    if (!("geolocation" in navigator)) return resolve(fallback);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const rev = await fetchWithTimeout(
            `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${latitude}&longitude=${longitude}&count=1&format=json&language=en`,
            8000
          );
          const rj = await rev.json();
          resolve(rj?.results?.[0]?.name || fallback);
        } catch {
          resolve(fallback);
        }
      },
      () => resolve(fallback),
      { enableHighAccuracy: true, timeout: 5000 }
    );
  });
}

/* ---------------------------------------
   Render widget (<img> as background)
--------------------------------------- */
async function renderWidget(city) {
  // Remove old
  const existing = document.getElementById("weather-god-widget");
  if (existing) existing.remove();

  // Container
  const widget = document.createElement("div");
  widget.id = "weather-god-widget";
  Object.assign(widget.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: "2147483647",
    background: "rgba(15, 23, 42, 0.65)",
    backdropFilter: "blur(15px) saturate(150%)",
    border: "1px solid rgba(255,255,255,0.15)",
    color: "#fff",
    padding: "16px",
    borderRadius: "20px",
    fontFamily: "system-ui, sans-serif",
    fontSize: "14px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
    width: "300px",
    overflow: "hidden",
    maxHeight: "120px",
    cursor: "default",
    isolation: "isolate",
  });

  // Background <img> (instead of CSS background-image)
  const bgImg = document.createElement("img");
  Object.assign(bgImg.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    objectFit: "cover",
    borderRadius: "20px",
    opacity: "0.35",
    pointerEvents: "none",
    zIndex: "0",
    display: "none", // hidden until we set a src
  });
  bgImg.alt = "";

  // Content wrapper
  const inner = document.createElement("div");
  Object.assign(inner.style, { position: "relative", zIndex: "1" });

  // Header (toggle only this)
  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    cursor: "pointer",
    userSelect: "none",
  });

  const left = document.createElement("div");
  const title = document.createElement("div");
  title.style.fontSize = "18px";
  title.style.fontWeight = "800";
  title.innerHTML = `⚡ <span id="wg-city">—</span>`;

  const tempEl = document.createElement("div");
  tempEl.id = "wg-temp";
  tempEl.style.fontSize = "38px";
  tempEl.style.fontWeight = "800";
  tempEl.style.marginTop = "4px";
  tempEl.textContent = "—°C";

  const descEl = document.createElement("div");
  descEl.id = "wg-desc";
  descEl.style.opacity = ".85";
  descEl.style.fontSize = "13px";
  descEl.textContent = "Loading…";

  left.append(title, tempEl, descEl);

  const iconEl = document.createElement("div");
  iconEl.id = "wg-icon";
  iconEl.style.fontSize = "42px";
  iconEl.textContent = "⛅";

  header.append(left, iconEl);

  // Details
  const details = document.createElement("div");
  Object.assign(details.style, {
    transition: "max-height .35s ease, opacity .25s ease",
    maxHeight: "0",
    opacity: "0",
    overflow: "hidden",
  });

  const grid = document.createElement("div");
  Object.assign(grid.style, {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "10px",
    marginTop: "8px",
  });

  function tile(text) {
    const t = document.createElement("div");
    Object.assign(t.style, {
      background: "rgba(255,255,255,.10)",
      padding: "10px",
      borderRadius: "10px",
      whiteSpace: "pre-line",
    });
    t.textContent = text;
    return t;
  }
  const tFeels = tile("🌡️ Feels like\n—");
  const tHum = tile("💧 Humidity\n—");
  const tRain = tile("☔ Rain\n—");
  const tWind = tile("🍃 Wind\n—");
  grid.append(tFeels, tHum, tRain, tWind);

  const input = Object.assign(document.createElement("input"), {
    id: "wg-city-input",
    type: "text",
    placeholder: "Change city…",
  });
  Object.assign(input.style, {
    marginTop: "12px",
    width: "100%",
    padding: "8px 10px",
    borderRadius: "8px",
    border: "none",
    outline: "none",
    fontSize: "13px",
    background: "rgba(255,255,255,0.12)",
    color: "#fff",
  });

  const btnRow = document.createElement("div");
  Object.assign(btnRow.style, {
    display: "flex",
    gap: "8px",
    marginTop: "8px",
  });

  const btnRefresh = document.createElement("button");
  btnRefresh.id = "wg-refresh";
  btnRefresh.textContent = "🔄 Refresh";
  Object.assign(btnRefresh.style, {
    flex: "1",
    padding: "8px",
    border: "none",
    borderRadius: "10px",
    background: "#facc15",
    color: "#000",
    fontWeight: "700",
    cursor: "pointer",
  });

  const btnSet = document.createElement("button");
  btnSet.id = "wg-set-city";
  btnSet.textContent = "🌍 Set City";
  Object.assign(btnSet.style, {
    flex: "1",
    padding: "8px",
    border: "none",
    borderRadius: "10px",
    background: "#3b82f6",
    color: "#fff",
    fontWeight: "700",
    cursor: "pointer",
  });

  btnRow.append(btnRefresh, btnSet);
  details.append(grid, input, btnRow);

  inner.append(header, details);

  // Skeleton
  const skeleton = document.createElement("div");
  skeleton.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
      <div style="flex:1;">
        <div style="height:18px;width:100px;background:rgba(255,255,255,0.15);border-radius:6px;animation:pulse 1.5s infinite;"></div>
        <div style="height:38px;width:80px;background:rgba(255,255,255,0.15);margin-top:8px;border-radius:8px;animation:pulse 1.5s infinite;"></div>
        <div style="height:14px;width:120px;background:rgba(255,255,255,0.15);margin-top:6px;border-radius:6px;animation:pulse 1.5s infinite;"></div>
      </div>
      <div style="height:42px;width:42px;background:rgba(255,255,255,0.15);border-radius:50%;animation:pulse 1.5s infinite;"></div>
    </div>
    <style>@keyframes pulse { 0%{opacity:.6} 50%{opacity:1} 100%{opacity:.6} }</style>
  `;

  // Assemble
  widget.append(bgImg, skeleton, inner);
  document.body.appendChild(widget);

  // Interactions
  let expanded = false;
  function setExpanded(v) {
    expanded = v;
    details.style.opacity = v ? "1" : "0";
    details.style.maxHeight = v ? "420px" : "0";
    widget.style.maxHeight = v ? "420px" : "120px";
  }
  setExpanded(false);

  header.addEventListener("click", () => setExpanded(!expanded));
  btnRefresh.addEventListener("click", (e) => {
    e.stopPropagation();
    renderWidget(localStorage.getItem(LS_KEY));
  });
  btnSet.addEventListener("click", (e) => {
    e.stopPropagation();
    const v = input.value.trim();
    if (v) {
      localStorage.setItem(LS_KEY, v);
      renderWidget(v);
    }
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      const v = input.value.trim();
      if (v) {
        localStorage.setItem(LS_KEY, v);
        renderWidget(v);
      }
    }
  });

  // Fetch & fill
  try {
    const chosenCity = city || (await detectCity());
    const data = await getWeather(chosenCity);
    localStorage.setItem(LS_KEY, data.city);

    // Content
    widget.querySelector("#wg-city").textContent = data.city;
    tempEl.textContent = `${data.temp}°C`;
    descEl.textContent = data.label;
    iconEl.textContent = data.icon;
    grid.children[0].textContent = `🌡️ Feels like\n${data.feels}°C`;
    grid.children[1].textContent = `💧 Humidity\n${data.humidity}%`;
    grid.children[2].textContent = `☔ Rain\n${data.rain}%`;
    grid.children[3].textContent = `🍃 Wind\n${data.wind} km/h`;

    // Background: <img> with theme URL or gradient fallback
    const imgURL = urlForTheme(data.theme);
    if (imgURL) {
      bgImg.src = imgURL; // let the browser fetch as a normal <img>
      bgImg.loading = "eager";
      bgImg.decoding = "async";
      bgImg.referrerPolicy = "no-referrer"; // avoid referrer-based blocks
      bgImg.style.display = ""; // show image
      widget.style.background = "rgba(15,23,42,.65)"; // keep glass layer
    } else {
      bgImg.style.display = "none";
      widget.style.background = "linear-gradient(135deg,#0f172a,#1e293b)";
    }

    // Swap skeleton → content
    skeleton.style.display = "none";
    inner.style.display = "";
  } catch (err) {
    console.error("[EasyWeather] render failed:", err);
    descEl.textContent = "Failed to fetch";
    skeleton.style.display = "none";
    inner.style.display = "";
  }
}

/* ---------------------------------------
   Boot + periodic refresh
--------------------------------------- */
renderWidget();
setInterval(() => renderWidget(localStorage.getItem(LS_KEY)), 30 * 60 * 1000);
