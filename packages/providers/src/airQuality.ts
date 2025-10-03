export async function fetchAirQuality(lat: number, lon: number) {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=european_aqi,pm2_5,pm10,carbon_monoxide,ozone&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Air Quality API request failed");
  }
  return res.json();
}
