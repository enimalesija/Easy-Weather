// apps/web/src/app/api/forecast/route.ts
import { NextRequest, NextResponse } from "next/server";

// Small helper: timed fetch with retries & exponential backoff
async function fetchRetry(
  url: string,
  opts: RequestInit & { timeoutMs?: number } = {},
  retries = 3,
  backoffMs = 500
): Promise<Response> {
  const { timeoutMs = 10000, ...init } = opts;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        cache: "no-store", // never cache
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
          await new Promise((r) =>
            setTimeout(r, backoffMs * Math.pow(2, attempt))
          );
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (err: unknown) {
      clearTimeout(id);
      if (attempt < retries) {
        await new Promise((r) =>
          setTimeout(r, backoffMs * Math.pow(2, attempt))
        );
        continue;
      }
      throw err;
    }
  }

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

function pickFirstResult(results: unknown): Geocode | null {
  if (!Array.isArray(results) || results.length === 0) return null;
  const r = results[0] as Record<string, unknown>;
  return {
    name: String(r.name ?? ""),
    country: r.country as string | undefined,
    admin1: r.admin1 as string | undefined,
    latitude: Number(r.latitude ?? 0),
    longitude: Number(r.longitude ?? 0),
    timezone: r.timezone as string | undefined,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const cityRaw = (searchParams.get("city") || "Stockholm").trim();

    // 1) Geocode the city
    const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      cityRaw
    )}&count=1&language=en&format=json`;

    const geocodeRes = await fetchRetry(geocodeUrl, { timeoutMs: 10000 });
    const geocodeJson: { results?: Record<string, unknown>[] } =
      await geocodeRes.json();
    const place =
      pickFirstResult(geocodeJson?.results) || {
        name: cityRaw,
        latitude: 59.3293,
        longitude: 18.0686,
        country: "Sweden",
        timezone: "Europe/Stockholm",
      };

    const lat = place.latitude;
    const lon = place.longitude;

    // 2) Fetch weather
    const weatherUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,weathercode` +
      `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset` +
      `&current_weather=true&timezone=auto`;

    const weatherRes = await fetchRetry(weatherUrl, { timeoutMs: 12000 });
    const weather: {
      current_weather?: unknown;
      hourly?: unknown;
      daily?: unknown;
    } = await weatherRes.json();

    // 3) Fetch Air Quality
    const aqiUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&hourly=european_aqi,pm2_5&timezone=auto`;

    let air_quality: {
      european_aqi: number[];
      pm2_5: number[];
      time: string[];
    };

    try {
      const aqiRes = await fetchRetry(aqiUrl, { timeoutMs: 12000 }, 2);
      const aqiJson: {
        hourly?: { european_aqi?: number[]; pm2_5?: number[]; time?: string[] };
      } = await aqiRes.json();

      air_quality = {
        european_aqi: aqiJson.hourly?.european_aqi ?? [],
        pm2_5: aqiJson.hourly?.pm2_5 ?? [],
        time: aqiJson.hourly?.time ?? [],
      };
    } catch {
      air_quality = { european_aqi: [], pm2_5: [], time: [] };
    }

    // 4) Response
    const payload = {
      place,
      current_weather: weather.current_weather ?? null,
      hourly: weather.hourly ?? null,
      daily: weather.daily ?? null,
      air_quality,
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "Upstream weather service failed.",
        detail: message,
      },
      { status: 502 }
    );
  }
}
