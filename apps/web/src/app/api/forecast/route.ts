// apps/web/src/app/api/forecast/route.ts
import { NextRequest, NextResponse } from "next/server";

/* ----------------------------- Types ----------------------------- */

type Geocode = {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

type OpenMeteoGeocodeResult = {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

type OpenMeteoGeocodeResponse = {
  results?: OpenMeteoGeocodeResult[];
};

type WeatherCurrent = {
  temperature: number;
  weathercode: number;
  windspeed: number;
  time: string;
};

type WeatherHourly = {
  time: string[];
  temperature_2m: number[];
  apparent_temperature: number[];
  relative_humidity_2m: number[];
  precipitation_probability: number[];
  weathercode: number[];
};

type WeatherDaily = {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  sunrise: string[];
  sunset: string[];
};

type OpenMeteoWeatherResponse = {
  current_weather?: WeatherCurrent | null;
  hourly?: WeatherHourly | null;
  daily?: WeatherDaily | null;
};

type AirQualityHourly = {
  time: string[];
  european_aqi: number[];
  pm2_5: number[];
};

type OpenMeteoAQIResponse = {
  hourly?: Partial<AirQualityHourly> | null;
};

type AirQualityPayload = {
  european_aqi: number[];
  pm2_5: number[];
  time: string[];
  current: { european_aqi: number; pm2_5: number } | null;
};

type ForecastPayload = {
  place: Geocode;
  current_weather: WeatherCurrent | null | undefined;
  hourly: WeatherHourly | null | undefined;
  daily: WeatherDaily | null | undefined;
  air_quality: AirQualityPayload;
};

/* --------------------- Timed fetch with retries ------------------ */

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
        cache: "no-store",
        next: { revalidate: 0 },
        headers: {
          "user-agent": "weather-god/1.0",
          ...(init.headers || {}),
        },
      });
      clearTimeout(id);

      if (!res.ok) {
        if (res.status >= 500 && attempt < retries) {
          await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, attempt)));
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      return res;
    } catch (err: unknown) {
      clearTimeout(id);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, attempt)));
        continue;
      }
      throw err;
    }
  }

  // Should never reach here
  throw new Error("fetchRetry exhausted");
}

/* ---------------------------- Helpers ---------------------------- */

function pickFirstResult(results: OpenMeteoGeocodeResult[] | undefined): Geocode | null {
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

/* ------------------------------ Route ---------------------------- */

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const cityRaw = (searchParams.get("city") || "Stockholm").trim();

    // 1) Geocode
    const geocodeUrl =
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityRaw)}` +
      `&count=1&language=en&format=json`;

    let place: Geocode | null = null;
    try {
      const geocodeRes = await fetchRetry(geocodeUrl, { timeoutMs: 10000 });
      const geocodeJson: OpenMeteoGeocodeResponse = await geocodeRes.json();
      place = pickFirstResult(geocodeJson?.results);
    } catch (e: unknown) {
      // Keep going with fallback
      // eslint-disable-next-line no-console
      console.warn("Geocoding failed:", e instanceof Error ? e.message : String(e));
    }

    if (!place) {
      place = {
        name: cityRaw,
        latitude: 59.3293,
        longitude: 18.0686,
        country: "Sweden",
        timezone: "auto",
      };
    }

    const { latitude: lat, longitude: lon } = place;

    // 2) Weather
    const weatherUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,weathercode` +
      `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset` +
      `&current_weather=true&timezone=auto`;

    const weatherRes = await fetchRetry(weatherUrl, { timeoutMs: 12000 });
    const weather: OpenMeteoWeatherResponse = await weatherRes.json();

    // 3) Air Quality
    const aqiUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&hourly=european_aqi,pm2_5&timezone=auto`;

    let air_quality: AirQualityPayload = {
      european_aqi: [],
      pm2_5: [],
      time: [],
      current: null,
    };

    try {
      const aqiRes = await fetchRetry(aqiUrl, { timeoutMs: 12000 }, 2);
      const aqiJson: OpenMeteoAQIResponse = await aqiRes.json();

      const hourly = aqiJson?.hourly;
      const aqi = (hourly?.european_aqi ?? []) as number[];
      const pm25 = (hourly?.pm2_5 ?? []) as number[];
      const time = (hourly?.time ?? []) as string[];

      const currentTime = weather?.current_weather?.time;
      const current =
        currentTime && time.length > 0
          ? (() => {
              const idx = time.indexOf(currentTime);
              if (idx >= 0) {
                return {
                  european_aqi: aqi[idx] ?? aqi[0],
                  pm2_5: pm25[idx] ?? pm25[0],
                };
              }
              return null;
            })()
          : null;

      air_quality = {
        european_aqi: aqi,
        pm2_5: pm25,
        time,
        current,
      };
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.warn("Air quality fetch failed:", e instanceof Error ? e.message : String(e));
    }

    // 4) Response
    const payload: ForecastPayload = {
      place,
      current_weather: weather?.current_weather ?? null,
      hourly: weather?.hourly ?? null,
      daily: weather?.daily ?? null,
      air_quality,
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Forecast API failed", detail },
      { status: 502 }
    );
  }
}
