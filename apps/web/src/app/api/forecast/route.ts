// apps/web/src/app/api/forecast/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic"; // ensure no static caching in Next

/* ---------------------------------------
   Timed fetch with retries & backoff
--------------------------------------- */
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
        cache: "no-store",
        next: { revalidate: 0 },
        headers: {
          "user-agent": "weather-god/1.0",
          ...(init.headers || {}),
        },
      });
      clearTimeout(id);

      if (!res.ok) {
        // retry on transient 5xx
        if (res.status >= 500 && attempt < retries) {
          await new Promise((r) =>
            setTimeout(r, backoffMs * Math.pow(2, attempt))
          );
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
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

/* ---------------------------------------
   Types & helpers
--------------------------------------- */
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

function parseNum(n: string | null): number | null {
  if (!n) return null;
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

/* ---------------------------------------
   API handler
--------------------------------------- */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const latParam = parseNum(searchParams.get("lat"));
    const lonParam = parseNum(searchParams.get("lon"));
    const cityRaw = (searchParams.get("city") || "").trim();

    let place: Geocode | null = null;

    if (latParam != null && lonParam != null) {
      // coords path (preferred when present)
      const lat = latParam;
      const lon = lonParam;

      // best-effort reverse geocode for a nice label
      try {
        const revUrl = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=en`;
        const revRes = await fetchRetry(revUrl, { timeoutMs: 8000 }, 1);
        const revJson = await revRes.json();

        place = {
          name: revJson?.results?.[0]?.name || `${lat.toFixed(2)},${lon.toFixed(2)}`,
          country: revJson?.results?.[0]?.country,
          admin1: revJson?.results?.[0]?.admin1,
          latitude: lat,
          longitude: lon,
          timezone: revJson?.results?.[0]?.timezone, // may be undefined; filled from weather below
        };
      } catch {
        // still proceed even if reverse fails
        place = {
          name: `${lat.toFixed(2)},${lon.toFixed(2)}`,
          latitude: lat,
          longitude: lon,
          timezone: undefined,
        };
      }
    } else {
      // city path
      const city = cityRaw || "Stockholm";
      const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        city
      )}&count=1&language=en&format=json`;

      try {
        const geocodeRes = await fetchRetry(geocodeUrl, { timeoutMs: 10000 });
        const geocodeJson = await geocodeRes.json();
        place = pickFirstResult(geocodeJson?.results);
      } catch (e) {
        console.warn("Geocoding failed:", e);
      }

      if (!place) {
        // last resort — Stockholm center
        place = {
          name: city,
          latitude: 59.3293,
          longitude: 18.0686,
          country: "Sweden",
          timezone: undefined,
        };
      }
    }

    const lat = place!.latitude;
    const lon = place!.longitude;

    // Weather (timezone=auto keeps current_weather.time aligned with hourly.time)
    const weatherUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,weathercode` +
      `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,weathercode` +
      `&current_weather=true&timezone=auto`;

    const weatherRes = await fetchRetry(weatherUrl, { timeoutMs: 12000 });
    const weather = await weatherRes.json();

    // Air Quality (best-effort)
    const aqiUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&hourly=european_aqi,pm2_5&timezone=auto`;

    let air_quality: any = { european_aqi: [], pm2_5: [], time: [], current: null };
    try {
      const aqiRes = await fetchRetry(aqiUrl, { timeoutMs: 12000 }, 2);
      const aqiJson = await aqiRes.json();

      let current: { european_aqi?: number; pm2_5?: number } | null = null;
      const cwTime = weather?.current_weather?.time as string | undefined;
      const aqiTimes: string[] | undefined = aqiJson?.hourly?.time;
      if (cwTime && aqiTimes && aqiTimes.length > 0) {
        const idx = aqiTimes.indexOf(cwTime);
        if (idx >= 0) {
          current = {
            european_aqi: aqiJson?.hourly?.european_aqi?.[idx],
            pm2_5: aqiJson?.hourly?.pm2_5?.[idx],
          };
        }
      }

      air_quality = {
        european_aqi: aqiJson?.hourly?.european_aqi || [],
        pm2_5: aqiJson?.hourly?.pm2_5 || [],
        time: aqiJson?.hourly?.time || [],
        current,
      };
    } catch (e) {
      console.warn("Air quality fetch failed:", e);
    }

    // Normalize timezone onto place from the weather payload
    const resolvedTz: string | undefined = weather?.timezone;
    const finalPlace: Geocode = {
      ...place!,
      timezone: resolvedTz || place!.timezone,
    };

    // Final payload (keeps arrays exactly as Open-Meteo returns them)
    const payload = {
      place: finalPlace,
      current_weather: weather?.current_weather || null,
      hourly: weather?.hourly || null,
      daily: weather?.daily || null,
      air_quality,
    };

    return NextResponse.json(payload, {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "Forecast API failed",
        detail: err?.message || String(err),
      },
      { status: 502 }
    );
  }
}
