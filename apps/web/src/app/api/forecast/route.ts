// apps/web/src/app/api/forecast/route.ts
import { NextRequest, NextResponse } from "next/server";

/* =========================
   Types (Open-Meteo shapes)
========================= */

type GeocodeResult = {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

type GeocodeSearchResponse = {
  results?: GeocodeResult[];
};

type CurrentWeather = {
  temperature: number;
  weathercode: number;
  windspeed: number;
  time: string; // local ISO from Open-Meteo
};

type HourlyBlock = {
  time: string[];
  temperature_2m?: number[];
  apparent_temperature?: number[];
  relative_humidity_2m?: number[];
  precipitation_probability?: number[];
  weathercode?: number[];
};

type DailyBlock = {
  time: string[];
  weathercode?: number[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  sunrise?: string[];
  sunset?: string[];
};

type WeatherResponse = {
  timezone?: string; // e.g., "Europe/Stockholm"
  current_weather?: CurrentWeather;
  hourly?: HourlyBlock;
  daily?: DailyBlock;
};

type AirQualityHourly = {
  time: string[];
  european_aqi?: number[];
  pm2_5?: number[];
};

type AirQualityResponse = {
  hourly?: AirQualityHourly;
};

type Place = {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string; // normalized IANA TZ (never "auto")
};

type ApiPayload = {
  place: Place;
  timezone: string; // duplicate at root for convenience
  current_weather: CurrentWeather | null;
  hourly: HourlyBlock | null;
  daily: DailyBlock | null;
  air_quality: {
    european_aqi: number[];
    pm2_5: number[];
    time: string[];
    current: { european_aqi?: number; pm2_5?: number } | null;
  };
};

/* =========================
   Utilities
========================= */

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
      });
      clearTimeout(id);

      if (!res.ok) {
        if (res.status >= 500 && attempt < retries) {
          await new Promise((r) => setTimeout(r, backoffMs * 2 ** attempt));
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
      clearTimeout(id);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, backoffMs * 2 ** attempt));
        continue;
      }
      throw err as Error;
    }
  }

  throw new Error("fetchRetry exhausted");
}

function pickFirstResult(results?: GeocodeResult[]): GeocodeResult | null {
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

function normalizeTimezone(tz?: string): string {
  if (!tz || tz === "auto") return "UTC";
  try {
    // Throws if invalid
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/* =========================
   Handler
========================= */

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const cityRaw = (searchParams.get("city") || "").trim();
    const latParam = searchParams.get("lat");
    const lonParam = searchParams.get("lon");

    let place: Place | null = null;

    // A) Coordinates path (preferred when present)
    if (
      latParam !== null &&
      lonParam !== null &&
      !Number.isNaN(Number(latParam)) &&
      !Number.isNaN(Number(lonParam))
    ) {
      place = {
        name: cityRaw || "My location",
        latitude: Number(latParam),
        longitude: Number(lonParam),
        timezone: undefined, // will resolve from weather response
      };
    } else {
      // B) City name → geocode
      const name = cityRaw || "Stockholm";
      const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        name
      )}&count=1&language=en&format=json`;
      try {
        const geocodeRes = await fetchRetry(geocodeUrl, { timeoutMs: 10_000 });
        const geo = (await geocodeRes.json()) as GeocodeSearchResponse;
        const first = pickFirstResult(geo.results);
        if (first) {
          place = {
            name: first.name,
            country: first.country,
            admin1: first.admin1,
            latitude: first.latitude,
            longitude: first.longitude,
            timezone: first.timezone,
          };
        }
      } catch {
        // fall through → set fallback below
      }

      if (!place) {
        place = {
          name,
          latitude: 59.3293,
          longitude: 18.0686,
          country: "Sweden",
          timezone: undefined, // resolve later
        };
      }
    }

    const { latitude: lat, longitude: lon } = place;

    // Weather (include daily=weathercode)
    const weatherUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,weathercode` +
      `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,weathercode` +
      `&current_weather=true&timezone=auto`;

    const weatherRes = await fetchRetry(weatherUrl, { timeoutMs: 12_000 });
    const weather = (await weatherRes.json()) as WeatherResponse;

    // Resolve timezone: prefer API, then geocode, then UTC (never "auto")
    const resolvedTZ = normalizeTimezone(
      (weather.timezone && weather.timezone !== "auto" ? weather.timezone : undefined) ||
        place.timezone
    );
    place.timezone = resolvedTZ;

    // Air Quality (best effort)
    const aqiUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&hourly=european_aqi,pm2_5&timezone=auto`;

    let aqHourly: AirQualityHourly = { time: [], european_aqi: [], pm2_5: [] };
    try {
      const aqiRes = await fetchRetry(aqiUrl, { timeoutMs: 12_000 }, 2);
      const aqiJson = (await aqiRes.json()) as AirQualityResponse;
      aqHourly = {
        time: aqiJson.hourly?.time ?? [],
        european_aqi: aqiJson.hourly?.european_aqi ?? [],
        pm2_5: aqiJson.hourly?.pm2_5 ?? [],
      };
    } catch {
      // keep defaults
    }

    // Align aqi "current" with weather current time if possible
    const cwTime = weather.current_weather?.time;
    let aqiCurrent: { european_aqi?: number; pm2_5?: number } | null = null;
    if (cwTime && aqHourly.time.length > 0) {
      const idx = aqHourly.time.indexOf(cwTime);
      if (idx >= 0) {
        aqiCurrent = {
          european_aqi: aqHourly.european_aqi?.[idx],
          pm2_5: aqHourly.pm2_5?.[idx],
        };
      }
    }

    // Normalize daily naming edge from some tooling that may provide a mis-typed key
    if (weather.daily && !(weather.daily as DailyBlock).temperature_2m_min) {
      const dailyUnknown = weather.daily as unknown as Record<string, unknown>;
      const maybeWrong = dailyUnknown["temperature_2_ m_min"];
      if (Array.isArray(maybeWrong)) {
        (weather.daily as DailyBlock).temperature_2m_min =
          maybeWrong as number[];
      }
    }

    const payload: ApiPayload = {
      place,
      timezone: resolvedTZ,
      current_weather: weather.current_weather ?? null,
      hourly: weather.hourly ?? null,
      daily: weather.daily ?? null,
      air_quality: {
        european_aqi: aqHourly.european_aqi ?? [],
        pm2_5: aqHourly.pm2_5 ?? [],
        time: aqHourly.time ?? [],
        current: aqiCurrent,
      },
    };

    return NextResponse.json(payload, {
      status: 200,
      headers: {
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Forecast API failed", detail: message },
      { status: 502 }
    );
  }
}
