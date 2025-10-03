const API_BASE = "http://localhost:3000"; 

async function fetchForecast(city) {
  const url = `${API_BASE}/api/forecast?city=${encodeURIComponent(city)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Backend forecast error");
  return res.json();
}

async function resolveCityName(lat, lon) {
  try {
    const rev = await fetch(
      `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=en`
    );
    const rj = await rev.json();
    return rj?.results?.[0]?.name || `${lat.toFixed(2)},${lon.toFixed(2)}`;
  } catch {
    return `${lat.toFixed(2)},${lon.toFixed(2)}`;
  }
}

async function updateBadge() {
  let cityName = "Stockholm"; // fallback
  try {
    // Try geolocation
    if ("geolocation" in navigator) {
      await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const { latitude, longitude } = pos.coords;
            cityName = await resolveCityName(latitude, longitude);
            resolve();
          },
          () => resolve(), // fallback if denied
          { enableHighAccuracy: true, timeout: 5000 }
        );
      });
    }

    // Fetch weather
    const data = await fetchForecast(cityName);
    const temp = Math.round(data?.current_weather?.temperature ?? 0);

    // Badge text
    chrome.action.setBadgeText({ text: `${temp}°` });

    // Badge color: hot = red, cold = blue, mild = yellow
    let color = "#facc15"; // yellow
    if (temp >= 25) color = "#ef4444"; // hot → red
    else if (temp <= 0) color = "#3b82f6"; // cold → blue
    chrome.action.setBadgeBackgroundColor({ color });

    // Tooltip
    chrome.action.setTitle({ title: `${cityName}: ${temp}°C` });

  } catch (e) {
    console.error("[EasyWeather] updateBadge error:", e);
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
    chrome.action.setTitle({ title: "EasyWeather — error fetching" });
  }
}

// Update immediately
updateBadge();

// Refresh every 30 min
setInterval(updateBadge, 30 * 60 * 1000);

// Also refresh when the extension is clicked or installed
chrome.action.onClicked.addListener(updateBadge);
chrome.runtime.onInstalled.addListener(updateBadge);
