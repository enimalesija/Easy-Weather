// packages/providers/src/openMeteo.ts

type GeoResult = {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

async function geocodeCity(city: string): Promise<GeoResult> {
  const geoUrl =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const res = await fetch(geoUrl);
  if (!res.ok) throw new Error("Geocoding API request failed");
  const data = await res.json();

  if (!data.results || data.results.length === 0) {
    throw new Error(`No coordinates found for city: ${city}`);
  }

  const { name, country, admin1, latitude, longitude, timezone } = data.results[0];
  return { name, country, admin1, latitude, longitude, timezone };
}

export async function fetchOpenMeteo(city: string) {
  const place = await geocodeCity(city);

  // Pull rich hourly + 7-day daily forecast, auto timezone
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${place.latitude}&longitude=${place.longitude}` +
    `&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,weathercode` +
    `&daily=weathercode,temperature_2m_max,temperature_2m_min,sunrise,sunset` +
    `&current_weather=true&forecast_days=7&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather API request failed");
  const payload = await res.json();

  // Attach resolved place meta so the frontend can show it cleanly
  return {
    place,
    ...payload,
  };
}
