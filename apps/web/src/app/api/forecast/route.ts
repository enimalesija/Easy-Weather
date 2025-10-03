// apps/web/src/app/api/forecast/route.ts
import { NextRequest, NextResponse } from "next/server";

// Small helper: timed fetch with retries & exponential backoff
async function fetchRetry(
  url: string,
  opts: RequestInit & { timeoutMs?: number } = {},
  retries = 3,
  backoffMs = 500
) {
  const { timeoutMs = 10000, ...init } = opts;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        // never cache this (fast dev iteration)
        cache: "no-store",
        next: { revalidate: 0 },
        headers: {
          "user-agent": "weather-god/1.0",
          ...(init.headers || {}),
        },
      });
      clearTimeout(id);
      if (!res.ok) {
        // retry only on 5xx
        if (res.status >= 500 && attempt < retries) {
          await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, attempt)));
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (err: any) {
      clearTimeout(id);
      // retry on network errors/aborts
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, attempt)));
        continue;
      }
      throw err;
    }
  }

  // Should never here
  throw new Error("fetchRetry exhausted");
}

type Geocode = {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

function pickFirstResult(results: any[] | undefined): Geocode | null {
  if (!results || results.length === 0) return null;
  const r = results[0];
  return {
    name: r.name,
    country: r.country,
    admin1: r.admin1,
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const cityRaw = (searchParams.get("city") || "Stockholm").trim();

    // 1) Geocode the city (Open-Meteo geocoding)
    const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      cityRaw
    )}&count=1&language=en&format=json`;

    const geocodeRes = await fetchRetry(geocodeUrl, { timeoutMs: 10000 });
    const geocodeJson = await geocodeRes.json();
    const place = pickFirstResult(geocodeJson?.results) || {
      name: cityRaw,
      latitude: 59.3293,
      longitude: 18.0686,
      country: "Sweden",
      timezone: "Europe/Stockholm",
    };

    const lat = place.latitude;
    const lon = place.longitude;

    // 2) Fetch weather (hourly + daily + current)
    const weatherUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,weathercode` +
      `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset` +
      `&current_weather=true&timezone=auto`;

    const weatherRes = await fetchRetry(weatherUrl, { timeoutMs: 12000 });
    const weather = await weatherRes.json();

    // 3) Fetch Air Quality (EU AQI + PM2.5)
    // NOTE: Open-Meteo AQ needs its own endpoint
    const aqiUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&hourly=european_aqi,pm2_5&timezone=auto`;

    let air_quality: any = undefined;
    try {
      const aqiRes = await fetchRetry(aqiUrl, { timeoutMs: 12000 }, 2);
      const aqiJson = await aqiRes.json();
      // normalize to match UI shape (air_quality.european_aqi is an array, aligned to hourly.time)
      air_quality = {
        european_aqi: aqiJson?.hourly?.european_aqi || [],
        pm2_5: aqiJson?.hourly?.pm2_5 || [],
        time: aqiJson?.hourly?.time || [],
      };
    } catch {
      // AQI fetch failed — keep UI working
      air_quality = { european_aqi: [], pm2_5: [], time: [] };
    }

    // 4) Compose response to match the front-end types exactly
    const payload = {
      place,
      current_weather: weather?.current_weather || null,
      hourly: weather?.hourly || null,
      daily: weather?.daily || null,
      air_quality, // { european_aqi: number[], pm2_5: number[], time: string[] }
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (err: any) {
    // Graceful error with message
    return NextResponse.json(
      {
        error: "Upstream weather service failed.",
        detail: err?.message || String(err),
      },
      { status: 502 }
    );
  }
}
