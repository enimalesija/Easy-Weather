const BASE = "http://localhost:3000"; // change to your deployed URL later
const q = document.getElementById("q");
const go = document.getElementById("go");
const me = document.getElementById("me");
const out = document.getElementById("out");

const LS_KEY = "easyweather:lastCity";

async function call(city) {
  try {
    out.innerHTML = `<div class="card">Summoning ⚡...</div>`;

    const res = await fetch(`${BASE}/api/forecast?city=${encodeURIComponent(city)}`);
    const json = await res.json();

    if (!res.ok) {
      throw new Error(json.error || "Unknown error");
    }

    const temp = Math.round(
      json?.current_weather?.temperature ??
      json?.hourly?.temperature_2m?.[0] ??
      0
    );

    out.innerHTML = `
      <div class="card">
        <div class="city">${json?.place?.name || city}</div>
        <div class="temp">${temp}°C now</div>
      </div>
    `;

    // Save last city
    localStorage.setItem(LS_KEY, city);

    // Update badge too
    chrome.runtime.sendMessage({ action: "updateBadge", city });

  } catch (err) {
    console.error("[Popup] call() failed:", err);
    out.innerHTML = `<div class="card error">Error: ${err.message}</div>`;
  }
}

go.addEventListener("click", () => {
  if (!q.value.trim()) return;
  call(q.value.trim());
});

me.addEventListener("click", () => {
  if (!("geolocation" in navigator)) {
    out.innerHTML = `<div class="card error">Geolocation not supported.</div>`;
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const { latitude, longitude } = pos.coords;
        const rev = await fetch(
          `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${latitude}&longitude=${longitude}&language=en`
        );
        const rj = await rev.json();
        const label =
          rj?.results?.[0]?.name ||
          `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
        call(label);
      } catch (e) {
        out.innerHTML = `<div class="card error">Reverse geocode failed. Using coords.</div>`;
        call(`${pos.coords.latitude.toFixed(2)},${pos.coords.longitude.toFixed(2)}`);
      }
    },
    (err) => {
      out.innerHTML = `<div class="card error">Location error: ${err.message}</div>`;
    },
    { enableHighAccuracy: true, timeout: 5000 }
  );
});

// On load → try last city
document.addEventListener("DOMContentLoaded", () => {
  const last = localStorage.getItem(LS_KEY);
  if (last) {
    q.value = last;
    call(last);
  }
});
