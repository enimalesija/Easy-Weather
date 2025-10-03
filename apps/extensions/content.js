// apps/extension/content.js

const API_BASE = "https://easy-weather-three.vercel.app";
const LS_KEY = "wg:lastCity";

async function getWeather(city = "Stockholm") {
  try {
    const res = await fetch(`${API_BASE}/api/forecast?city=${encodeURIComponent(city)}`);
    if (!res.ok) throw new Error("Bad response");
    const json = await res.json();

    const temp = Math.round(json?.current_weather?.temperature ?? 0);

    // Pick emoji by temperature
    let icon = "☁️";
    if (temp >= 25) icon = "☀️";
    else if (temp >= 15) icon = "⛅";
    else if (temp >= 5) icon = "🌧️";
    else icon = "❄️";

    return {
      temp,
      feels: Math.round(json?.hourly?.apparent_temperature?.[0] ?? 0),
      humidity: json?.hourly?.relative_humidity_2m?.[0] ?? "-",
      rain: json?.hourly?.precipitation_probability?.[0] ?? "-",
      wind: Math.round(json?.current_weather?.windspeed ?? 0),
      city: json?.place?.name || city,
      icon,
    };
  } catch (e) {
    console.error("Weather fetch failed", e);
    return {
      temp: "?",
      feels: "?",
      humidity: "?",
      rain: "?",
      wind: "?",
      city: "Error",
      icon: "⚠️",
    };
  }
}

async function detectCity() {
  // Try geolocation first
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      const saved = localStorage.getItem(LS_KEY);
      return resolve(saved || "Stockholm");
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const rev = await fetch(
            `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${latitude}&longitude=${longitude}&language=en`
          );
          const rj = await rev.json();
          const label = rj?.results?.[0]?.name || localStorage.getItem(LS_KEY) || "Stockholm";
          resolve(label);
        } catch {
          resolve(localStorage.getItem(LS_KEY) || "Stockholm");
        }
      },
      () => resolve(localStorage.getItem(LS_KEY) || "Stockholm"),
      { enableHighAccuracy: true, timeout: 5000 }
    );
  });
}

async function renderWidget(city) {
  // remove old widget
  const existing = document.getElementById("weather-god-widget");
  if (existing) existing.remove();

  const chosenCity = city || (await detectCity());
  const data = await getWeather(chosenCity);

  // Save last used city
  localStorage.setItem(LS_KEY, data.city);

  const widget = document.createElement("div");
  widget.id = "weather-god-widget";
  Object.assign(widget.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: "999999",
    background: "rgba(15, 23, 42, 0.9)",
    backdropFilter: "blur(10px)",
    color: "#fff",
    padding: "20px",
    borderRadius: "20px",
    fontFamily: "system-ui, sans-serif",
    fontSize: "14px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    cursor: "pointer",
    userSelect: "none",
    width: "280px",
    transition: "all 0.35s ease",
    overflow: "hidden",
    maxHeight: "110px",
  });

  widget.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between;">
      <div>
        <div style="font-size:18px; font-weight:700;">⚡ ${data.city}</div>
        <div style="font-size:34px; font-weight:800; margin-top:4px;">${data.temp}°C</div>
      </div>
      <div style="font-size:40px;">${data.icon}</div>
    </div>

    <div id="wg-details" style="margin-top:16px; opacity:0; max-height:0; overflow:hidden; transition:all 0.3s ease;">
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:13px;">
        <div style="background:#1e293b; padding:10px; border-radius:10px;">🌡️ Feels like<br><b>${data.feels}°C</b></div>
        <div style="background:#1e293b; padding:10px; border-radius:10px;">💧 Humidity<br><b>${data.humidity}%</b></div>
        <div style="background:#1e293b; padding:10px; border-radius:10px;">☔ Rain<br><b>${data.rain}%</b></div>
        <div style="background:#1e293b; padding:10px; border-radius:10px;">🍃 Wind<br><b>${data.wind} km/h</b></div>
      </div>
      <input id="wg-city-input" type="text" placeholder="Change city..." style="
        margin-top:12px; width:100%; padding:8px; border-radius:8px; border:none; outline:none; font-size:13px;
      " />
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button id="wg-refresh" style="flex:1; padding:8px; border:none; border-radius:10px; background:#facc15; color:#000; font-weight:600; cursor:pointer;">🔄 Refresh</button>
        <button id="wg-set-city" style="flex:1; padding:8px; border:none; border-radius:10px; background:#60a5fa; color:#fff; font-weight:600; cursor:pointer;">🌍 Set City</button>
      </div>
    </div>
  `;

  let expanded = false;
  const details = widget.querySelector("#wg-details");

  widget.addEventListener("click", (e) => {
    if (["wg-refresh", "wg-set-city", "wg-city-input"].includes(e.target.id)) return;
    expanded = !expanded;
    if (expanded) {
      details.style.opacity = "1";
      details.style.maxHeight = "500px";
      widget.style.maxHeight = "380px";
    } else {
      details.style.opacity = "0";
      details.style.maxHeight = "0";
      widget.style.maxHeight = "110px";
    }
  });

  widget.querySelector("#wg-refresh").addEventListener("click", (e) => {
    e.stopPropagation();
    renderWidget(localStorage.getItem(LS_KEY));
  });

  widget.querySelector("#wg-set-city").addEventListener("click", (e) => {
    e.stopPropagation();
    const input = widget.querySelector("#wg-city-input").value.trim();
    if (input) {
      localStorage.setItem(LS_KEY, input);
      renderWidget(input);
    }
  });

  document.body.appendChild(widget);
}

// First run
renderWidget();

// Auto-refresh every 30 min
setInterval(() => renderWidget(localStorage.getItem(LS_KEY)), 30 * 60 * 1000);
