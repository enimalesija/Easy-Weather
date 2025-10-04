// apps/web/src/app/api/forecast/route.ts
import { NextRequest, NextResponse } from "next/server";

/* ---------------------------------------
   Types
--------------------------------------- */
type GeocodeResult = {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

type OpenMeteoGeocodeJSON = {
  results?: Array<{
    name: string;
    country?: string;
    admin1?: string;
    latitude: number;
    longitude: number;
    timezone?: string;
  }>;
};

type OpenMeteoForecastJSON = {
  current_weather?: {
    temperature: number;
    weathercode: number;
    windspeed: number;
    time: string; // local time from API
  };
  hourly?: {
    time: string[];
    temperature_2m: number[];
    apparent_temperature: number[];
    relative_humidity_2m: number[];
    precipitation_probability: number[];
    weathercode: number[];
  };
  daily?: {
    time: string[];
    weathercode: number[];                      // <-- we ensure this exists now
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    sunrise: string[];
    sunset: string[];
  };
};

type OpenMeteoAQIJSON = {
  hourly?: {
    time: string[];
    european_aqi?: number[];
    pm2_5?: number[];
  };
};

type ForecastPayload = {
  place: GeocodeResult;
  current_weather: OpenMeteoForecastJSON["current_weather"] | null;
  hourly: OpenMeteoForecastJSON["hourly"] | null;
  daily: OpenMeteoForecastJSON["daily"] | null;
  air_quality: {
    european_aqi: number[];
    pm2_5: number[];
    time: string[];
    current: { european_aqi?: number; pm2_5?: number } | null;
  };
};

/* ---------------------------------------
   Small helper: timed fetch + retries
--------------------------------------- */
async function fetchRetry(
  url: string,
  opts: RequestInit & { timeoutMs?: number } = {},
  retries = 3,
  backoffMs = 500
): Promise<Response> {
  const { timeoutMs = 10_000, ...init } = opts;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        cache: "no-store",
        headers: {
          "user-agent": "weather-god/1.0",
          ...(init.headers || {}),
        },
        // next: { revalidate: 0 } — not necessary with cache:"no-store"
      });
      clearTimeout(id);
      if (!res.ok) {
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
      throw err as Error;
    }
  }
  throw new Error("fetchRetry exhausted");
}

/* ---------------------------------------
   Utilities
--------------------------------------- */
function pickFirstResult(results?: OpenMeteoGeocodeJSON["results"]): GeocodeResult | null {
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

/* ---------------------------------------
   GET
--------------------------------------- */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Inputs: either city OR explicit lat/lon
    const cityRaw = (searchParams.get("city") || "").trim();
    const latParam = searchParams.get("lat");
    const lonParam = searchParams.get("lon");

    let place: GeocodeResult | null = null;

    if (latParam && lonParam && !Number.isNaN(+latParam) && !Number.isNaN(+lonParam)) {
      // If coords provided, skip geocode
      place = {
        name: cityRaw || "My location",
        latitude: Number(latParam),
        longitude: Number(lonParam),
        country: undefined,
        timezone: "auto",
      };
    } else {
      const city = cityRaw || "Stockholm";

      // Geocode the city
      const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        city
      )}&count=1&language=en&format=json`;

      try {
        const geocodeRes = await fetchRetry(geocodeUrl, { timeoutMs: 10_000 });
        const geocodeJson = (await geocodeRes.json()) as OpenMeteoGeocodeJSON;
        place = pickFirstResult(geocodeJson.results);
      } catch {
        // swallow — we’ll fallback below
      }

      // Fallback if geocoding failed
      if (!place) {
        place = {
          name: city,
          latitude: 59.3293,
          longitude: 18.0686,
          country: "Sweden",
          timezone: "auto",
        };
      }
    }

    const lat = place.latitude;
    const lon = place.longitude;

    // Weather: ensure daily=weathercode is requested
    const weatherUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,weathercode` +
      `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,weathercode` + // <-- added weathercode
      `&current_weather=true&timezone=auto`;

    const weatherRes = await fetchRetry(weatherUrl, { timeoutMs: 12_000 });
    const weatherJson = (await weatherRes.json()) as OpenMeteoForecastJSON;

    // Air Quality
    const aqiUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&hourly=european_aqi,pm2_5&timezone=auto`;

    let air_quality: ForecastPayload["air_quality"] = {
      european_aqi: [],
      pm2_5: [],
      time: [],
      current: null,
    };

    try {
      const aqiRes = await fetchRetry(aqiUrl, { timeoutMs: 12_000 }, 2);
      const aqiJson = (await aqiRes.json()) as OpenMeteoAQIJSON;

      const times = aqiJson.hourly?.time ?? [];
      const aqi = aqiJson.hourly?.european_aqi ?? [];
      const pm25 = aqiJson.hourly?.pm2_5 ?? [];

      // Align "current" AQI to current weather time if possible
      let current: { european_aqi?: number; pm2_5?: number } | null = null;
      const cwTime = weatherJson.current_weather?.time;
      if (cwTime && times.length) {
        const idx = times.indexOf(cwTime);
        if (idx >= 0) {
          current = {
            european_aqi: aqi[idx],
            pm2_5: pm25[idx],
          };
        }
      }

      air_quality = {
        european_aqi: aqi,
        pm2_5: pm25,
        time: times,
        current,
      };
    } catch {
      // keep defaults
    }

    const payload: ForecastPayload = {
      place,
      current_weather: weatherJson.current_weather ?? null,
      hourly: weatherJson.hourly ?? null,
      daily: weatherJson.daily ?? null,
      air_quality,
    };

    return new NextResponse(JSON.stringify(payload), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new NextResponse(JSON.stringify({ error: "Forecast API failed", detail: msg }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
