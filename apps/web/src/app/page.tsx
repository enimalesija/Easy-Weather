"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Sun,
  Cloud,
  CloudRain,
  Snowflake,
  MapPin,
  Star,
  StarOff,
  LocateFixed,
  Settings,
  Menu,
  Wind,
  Droplets,
  ThermometerSun,
  CloudFog,
  Trash2,
  Download,
  Zap,
} from "lucide-react";
import "./style.css";

/* =======================================
   Network utils
======================================= */

async function fetchWithTimeout(url: string, ms = 12000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw err instanceof Error ? err : new Error("Request failed");
  } finally {
    clearTimeout(id);
  }
}

/* =======================================
   Hooks & storage helpers
======================================= */

function useDebouncedValue<T>(value: T, delay = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}
function useIsClient() {
  const [isClient, setIsClient] = useState(false);
  useEffect(() => setIsClient(true), []);
  return isClient;
}
function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}
function setCookie(name: string, value: string, days = 365) {
  if (typeof document === "undefined") return;
  const exp = new Date();
  exp.setTime(exp.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${encodeURIComponent(
    value
  )}; expires=${exp.toUTCString()}; path=/; SameSite=Lax`;
}
function nanoid(len = 22) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++)
    out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
function ensureUserId(): string {
  if (typeof window === "undefined") return "srv";
  let id = getCookie("wg_uid");
  if (!id) {
    id = nanoid(22);
    setCookie("wg_uid", id);
  }
  return id;
}
function keyFor(userId: string, base: string) {
  return `wg:${userId}:${base}`;
}
function makeKeys(userId: string) {
  return {
    favorites: keyFor(userId, "favorites"),
    recents: keyFor(userId, "recents"),
    unit: keyFor(userId, "unit"),
    compact: keyFor(userId, "compact"),
    lastCity: keyFor(userId, "lastCity"),
  } as const;
}

/* =======================================
   Types
======================================= */

type Suggestion = {
  id?: number;
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

type Forecast = {
  place: Suggestion;
  current_weather?: {
    temperature: number;
    weathercode: number;
    windspeed: number;
    time: string; // ISO-like (Open-Meteo local time string)
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
    weathercode: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    sunrise: string[];
    sunset: string[];
  };
  air_quality?: {
    european_aqi?: number[];
    pm2_5?: number[];
    time?: string[];
    current?: { european_aqi?: number; pm2_5?: number } | null;
  };
};

type OMGeocodeResult = {
  id?: number;
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/* =======================================
   Weather helpers
======================================= */

function cToF(c: number | undefined) {
  if (typeof c !== "number") return c as unknown as number;
  return Math.round((c * 9) / 5 + 32);
}
function formatTemp(n: number | undefined, unit: "C" | "F") {
  if (typeof n !== "number") return "—";
  const v = unit === "F" ? cToF(n) : Math.round(n);
  return `${v}°${unit}`;
}
function bgClassByConditions(temp: number | undefined, rainProb?: number) {
  const t = temp ?? 0;
  if ((rainProb ?? 0) >= 50) return "bg-rain";
  if (t >= 22) return "bg-warm";
  if (t <= 0) return "bg-cold";
  return "bg-default";
}
function isNightFromISO(iso?: string) {
  if (!iso) return false;
  const d = new Date(iso);
  const h = d.getHours();
  return h < 6 || h >= 20;
}
function interpretConditions(
  weathercode?: number,
  precipProb?: number,
  currentIso?: string
): {
  label: string;
  theme:
    | "rain"
    | "snow"
    | "storm"
    | "fog"
    | "sunny"
    | "cloudy"
    | "night"
    | "default";
} {
  const p = precipProb ?? 0;
  const code = weathercode ?? -1;
  const night = isNightFromISO(currentIso);

  const isThunder = code === 95 || code === 96 || code === 99;
  const isRain =
    (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || p >= 50;
  const isSnow = (code >= 71 && code <= 77) || code === 85 || code === 86;
  const isFog = code === 45 || code === 48;
  const isCloudy = code === 2 || code === 3;
  const isClear = code === 0 || code === 1;

  if (isThunder) return { label: "Stormy", theme: "storm" };
  if (isSnow) return { label: "Snowy", theme: "snow" };
  if (isRain) return { label: "Rainy", theme: "rain" };
  if (isFog) return { label: "Foggy", theme: "fog" };
  if (isClear)
    return {
      label: night ? "Clear Night" : "Sunny",
      theme: night ? "night" : "sunny",
    };
  if (isCloudy)
    return { label: night ? "Cloudy Night" : "Cloudy", theme: "cloudy" };
  return { label: night ? "Night" : "—", theme: night ? "night" : "default" };
}
function iconForWeather(code?: number, isoTime?: string) {
  const night = isNightFromISO(isoTime);
  if (code === 95 || code === 96 || code === 99)
    return <Zap className="icon-8" color="#fde047" />;
  if ((code ?? -1) >= 71 && (code ?? -1) <= 77)
    return <Snowflake className="icon-8" color="#a5f3fc" />;
  if (code === 85 || code === 86)
    return <Snowflake className="icon-8" color="#a5f3fc" />;
  if ((code ?? -1) >= 51 && (code ?? -1) <= 67)
    return <CloudRain className="icon-8" color="#93c5fd" />;
  if ((code ?? -1) >= 80 && (code ?? -1) <= 82)
    return <CloudRain className="icon-8" color="#93c5fd" />;
  if (code === 45 || code === 48)
    return <CloudFog className="icon-8" color="#cbd5e1" />;
  if (code === 0 || code === 1)
    return <Sun className="icon-8" color={night ? "#93c5fd" : "#facc15"} />;
  if (code === 2 || code === 3)
    return <Cloud className="icon-8" color="#e5e7eb" />;
  return <Cloud className="icon-8" color="#e5e7eb" />;
}

/** closest hourly bucket to "now" */
function closestHourlyIndex(times: string[] | undefined, targetIso?: string) {
  if (!times || times.length === 0) return -1;
  const target = targetIso ? new Date(targetIso).getTime() : Date.now();
  let bestIdx = 0;
  let bestDiff = Math.abs(new Date(times[0]).getTime() - target);
  for (let i = 1; i < times.length; i++) {
    const diff = Math.abs(new Date(times[i]).getTime() - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/* =======================================
   Timezone-aware formatting
======================================= */

/** Prefer the forecast/place timezone; fallback to browser TZ */
/** Prefer the forecast/place timezone; fallback to browser TZ */
function getForecastTZ(
  forecast?: ({ place?: { timezone?: string } } & { timezone?: string }) | null
): string {
  return (
    forecast?.place?.timezone ||
    forecast?.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
}


/** Format an hour in forecast TZ, 24h clock */
function formatHourLabel(isoLike: string, tz: string) {
  const d = new Date(isoLike);
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: undefined,
    hour12: false,
    timeZone: tz,
  }).format(d);
}

/** Format full date/time in forecast TZ */
function formatDateTimeLabel(isoLike?: string, tz?: string) {
  if (!isoLike) return "—";
  const d = new Date(isoLike);
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).format(d);
}

/* =======================================
   Component
======================================= */

export default function WeatherGodPage() {
  const isClient = useIsClient();

  // Storage keys
  const [userId, setUserId] = useState<string>("");
  const [LS_KEYS, setLS_KEYS] = useState(makeKeys("boot"));
  useEffect(() => {
    if (!isClient) return;
    const id = ensureUserId();
    setUserId(id);
    setLS_KEYS(makeKeys(id));
  }, [isClient]);

  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [unit, setUnit] = useState<"C" | "F">("C");
  const [compact, setCompact] = useState<boolean>(false);
  const [favorites, setFavorites] = useState<Suggestion[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);

  /* PWA events */
  useEffect(() => {
    const checkStandalone = () =>
      setIsStandalone(
        (window.matchMedia &&
          window.matchMedia("(display-mode: standalone)").matches) ||
          (window as unknown as { navigator?: { standalone?: boolean } })
            ?.navigator?.standalone === true
      );
    checkStandalone();

    const onPrompt = (e: Event) => {
      const ev = e as BeforeInstallPromptEvent;
      ev.preventDefault();
      setInstallPrompt(ev);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
      setIsStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  /* Hydrate localStorage */
  useEffect(() => {
    if (!isClient || !userId) return;
    try {
      const u = (localStorage.getItem(LS_KEYS.unit) as "C" | "F") || "C";
      const c = localStorage.getItem(LS_KEYS.compact) === "1";
      const f = JSON.parse(
        localStorage.getItem(LS_KEYS.favorites) || "[]"
      ) as Suggestion[];
      const r = JSON.parse(
        localStorage.getItem(LS_KEYS.recents) || "[]"
      ) as string[];
      setUnit(u);
      setCompact(c);
      setFavorites(Array.isArray(f) ? f : []);
      setRecents(Array.isArray(r) ? r : []);
    } catch {
      /* ignore */
    }
  }, [isClient, userId, LS_KEYS]);

  /* Suggestions */
  const debounced = useDebouncedValue(query, 250);
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      setError(null);
      if (!debounced || debounced.trim().length < 2) {
        if (active) setSuggestions([]);
        return;
      }
      try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
          debounced
        )}&count=8&language=en&format=json`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed fetching suggestions");
        const data: { results?: OMGeocodeResult[] } = await res.json();
        if (!active) return;
        setSuggestions(
          (data.results || []).map((r) => ({
            id: r.id,
            name: r.name,
            country: r.country,
            admin1: r.admin1,
            latitude: r.latitude,
            longitude: r.longitude,
            timezone: r.timezone,
          }))
        );
      } catch (e: unknown) {
        if (!active) return;
        const msg = e instanceof Error ? e.message : "Suggestion error";
        setSuggestions([]);
        setError(msg);
      }
    })();
    return () => {
      active = false;
    };
  }, [debounced]);

  /* Backend calls */
  const loadForecastByCityName = useCallback(
    async (city: string) => {
      if (!city) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetchWithTimeout(
          `/api/forecast?city=${encodeURIComponent(city)}`,
          12000
        );
        const json: Forecast | { error?: string } = await res.json();
        if ("error" in json)
          throw new Error(json.error || "Failed to fetch forecast");
        setForecast(json as Forecast);
        setRecents((r) => {
          const n = [
            city,
            ...r.filter((x) => x.toLowerCase() !== city.toLowerCase()),
          ];
          if (isClient && userId) localStorage.setItem(LS_KEYS.lastCity, city);
          return n.slice(0, 8);
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setForecast(null);
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [LS_KEYS.lastCity, isClient, userId]
  );

  const loadForecastByCoords = useCallback(
    async (lat: number, lon: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchWithTimeout(
          `/api/forecast?lat=${lat}&lon=${lon}`,
          12000
        );
        const json: Forecast | { error?: string } = await res.json();
        if ("error" in json)
          throw new Error(json.error || "Failed to fetch forecast");
        setForecast(json as Forecast);
        const label =
          (json as Forecast)?.place?.name ||
          `${lat.toFixed(2)},${lon.toFixed(2)}`;
        setQuery(label);
        if (isClient && userId) localStorage.setItem(LS_KEYS.lastCity, label);
        setRecents((r) =>
          [
            label,
            ...r.filter((x) => x.toLowerCase() !== label.toLowerCase()),
          ].slice(0, 8)
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setForecast(null);
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [LS_KEYS.lastCity, isClient, userId]
  );

  /* First load: prefer geolocation → backend coords */
  useEffect(() => {
    if (!isClient || !userId) return;
    (async () => {
      const fallbackCity = "Stockholm";
      try {
        const last = localStorage.getItem(LS_KEYS.lastCity);
        if (!("geolocation" in navigator)) {
          const city = last || fallbackCity;
          await loadForecastByCityName(city);
          setQuery(city);
          return;
        }
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            await loadForecastByCoords(
              pos.coords.latitude,
              pos.coords.longitude
            );
          },
          async () => {
            const city = last || fallbackCity;
            await loadForecastByCityName(city);
            setQuery(city);
          },
          { enableHighAccuracy: true, timeout: 8000 }
        );
      } catch {
        await loadForecastByCityName(fallbackCity);
        setQuery(fallbackCity);
      }
    })();
  }, [
    isClient,
    userId,
    LS_KEYS.lastCity,
    loadForecastByCityName,
    loadForecastByCoords,
  ]);

  async function handleMyLocation() {
    if (!("geolocation" in navigator)) {
      setError("Geolocation not supported.");
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await loadForecastByCoords(pos.coords.latitude, pos.coords.longitude);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Location lookup failed.";
          setError(msg);
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        setError((err && "message" in err ? String((err as { message?: string }).message) : null) || "Location denied.");
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  function selectSuggestion(s: Suggestion) {
    const label = `${s.name}${s.country ? `, ${s.country}` : ""}`;
    setQuery(label);
    setSuggestions([]);
    void loadForecastByCityName(s.name);
  }
  function addFavoriteFromForecast() {
    if (!forecast?.place) return;
    const exists = favorites.some(
      (f) =>
        f.name === forecast.place.name &&
        f.country === forecast.place.country &&
        Math.abs(f.latitude - forecast.place.latitude) < 0.0001 &&
        Math.abs(f.longitude - forecast.place.longitude) < 0.0001
    );
    if (!exists) {
      const next = [forecast.place, ...favorites].slice(0, 10);
      setFavorites(next);
      if (isClient && userId)
        localStorage.setItem(LS_KEYS.favorites, JSON.stringify(next));
    }
  }
  function removeFavorite(name: string, country?: string) {
    const next = favorites.filter(
      (f) => !(f.name === name && f.country === country)
    );
    setFavorites(next);
    if (isClient && userId)
      localStorage.setItem(LS_KEYS.favorites, JSON.stringify(next));
  }
  function removeRecent(city: string) {
    const nxt = recents.filter((r) => r.toLowerCase() !== city.toLowerCase());
    setRecents(nxt);
    if (isClient && userId)
      localStorage.setItem(LS_KEYS.recents, JSON.stringify(nxt));
  }
  function clearRecents() {
    setRecents([]);
    if (isClient && userId)
      localStorage.setItem(LS_KEYS.recents, JSON.stringify([]));
  }

  /* ===== Derived values aligned to "now" ===== */
  const hourlyTZ = getForecastTZ(forecast);

  const nowIdx = useMemo(() => {
    return closestHourlyIndex(
      forecast?.hourly?.time,
      forecast?.current_weather?.time
    );
  }, [forecast?.hourly?.time, forecast?.current_weather?.time]);

  const nowTemp =
    forecast?.current_weather?.temperature ??
    (nowIdx >= 0 ? forecast?.hourly?.temperature_2m?.[nowIdx] : undefined);

  const nowCode =
    nowIdx >= 0
      ? forecast?.hourly?.weathercode?.[nowIdx]
      : forecast?.current_weather?.weathercode;

  const nowPrecipProb =
    nowIdx >= 0
      ? forecast?.hourly?.precipitation_probability?.[nowIdx]
      : undefined;
  const nowFeels =
    nowIdx >= 0 ? forecast?.hourly?.apparent_temperature?.[nowIdx] : undefined;
  const nowHumidity =
    nowIdx >= 0 ? forecast?.hourly?.relative_humidity_2m?.[nowIdx] : undefined;

  const conditions = useMemo(() => {
    return interpretConditions(
      nowCode,
      nowPrecipProb,
      forecast?.current_weather?.time
    );
  }, [nowCode, nowPrecipProb, forecast?.current_weather?.time]);

  const bgClass = bgClassByConditions(nowTemp, nowPrecipProb);

  // ***** CHART DATA: start at nowIdx (next 24 hours) *****
  const hourlyChartData = useMemo(() => {
    if (!forecast?.hourly) return [];
    const len = forecast.hourly.time.length;
    const start = Math.max(0, nowIdx);
    const end = Math.min(len, start + 24);
    const out: Array<{ time: string; temp: number; feels: number; rain: number }> = [];
    for (let i = start; i < end; i++) {
      const temp = forecast.hourly.temperature_2m[i];
      const feels = forecast.hourly.apparent_temperature[i];
      const tISO = forecast.hourly.time[i];
      out.push({
        time: formatHourLabel(tISO, hourlyTZ),
        temp: unit === "F" ? cToF(temp) : Math.round(temp),
        feels: unit === "F" ? cToF(feels) : Math.round(feels),
        rain: forecast.hourly.precipitation_probability[i],
      });
    }
    return out;
  }, [forecast, unit, hourlyTZ, nowIdx]);

  const timeLabel = formatDateTimeLabel(
    forecast?.current_weather?.time,
    hourlyTZ
  );

  const headerCityLabel = useMemo(() => {
    const name = forecast?.place?.name ?? "";
    const ctry = forecast?.place?.country ? `, ${forecast.place.country}` : "";
    const cond =
      conditions.label && conditions.label !== "—"
        ? ` — ${conditions.label}`
        : "";
    return `${name}${ctry}${cond}`;
  }, [forecast?.place?.name, forecast?.place?.country, conditions.label]);

  /* =======================================
     Card background
  ======================================= */
  function cardBackgroundStyle(theme: string): CSSProperties {
    const base: CSSProperties = {
      position: "absolute",
      inset: 0,
      backgroundPosition: "center",
      backgroundSize: "cover",
      backgroundRepeat: "no-repeat",
      borderRadius: 16,
      opacity: 0.35,
      zIndex: 0,
      pointerEvents: "none",
    };
    switch (theme) {
      case "rain":
        return {
          ...base,
          backgroundImage:
            "url('https://www.gifcen.com/wp-content/uploads/2023/08/rain-gif-9.gif')",
        };
      case "snow":
        return {
          ...base,
          backgroundImage:
            "url('https://sanjuanheadwaters.org/wp-content/uploads/2023/02/snow-falling-gif.gif')",
        };
      case "storm":
        return {
          ...base,
          backgroundImage:
            "url('https://cdn.pixabay.com/animation/2025/03/20/16/33/16-33-20-645_512.gif')",
        };
      case "fog":
        return {
          ...base,
          backgroundImage:
            "url('https://i.pinimg.com/originals/03/53/cd/0353cdf9b3b43ea8e16506cde3ec94ef.gif')",
        };
      case "sunny":
        return {
          ...base,
          backgroundImage:
            "url('https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT56YfDy5qmq-mfIHirK9AX-76K4DcMlTBr2Q&s')",
        };
      case "cloudy":
        return {
          ...base,
          backgroundImage:
            "url('https://i.pinimg.com/originals/b6/7f/61/b67f61a1364ea22a050d701c7bf7858f.gif')",
        };
      case "night":
        return {
          ...base,
          backgroundImage:
            "url('https://cdn.pixabay.com/animation/2023/09/06/23/18/23-18-03-337_512.gif')",
        };
      default:
        return {
          ...base,
          background: "linear-gradient(135deg,#0f172a,#1e293b)",
        };
    }
  }

  /* =======================================
     Render
  ======================================= */

  return (
    <div
      className={`wg-root suppress ${bgClass}`}
      style={{ position: "relative" }}
    >
      <motion.div
        className="wg-aurora"
        style={{ position: "relative", zIndex: 1 }}
      />
      <div className="wg-shell" style={{ position: "relative", zIndex: 1 }}>
        {/* Sidebar */}
        <aside className={`wg-sidebar ${sidebarOpen ? "open" : "closed"}`}>
          <div
            className="wg-row"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 16,
            }}
          >
            {sidebarOpen && (
              <Image
                src="/logo.png"
                alt="Easy Weather Logo"
                width={144}
                height={38}
                style={{ height: 38, width: "auto" }}
                priority
              />
            )}
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="wg-chip"
              title="Toggle sidebar"
              aria-label="Toggle sidebar"
            >
              <Menu className="icon-4" />
            </button>
            {sidebarOpen && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  opacity: 0.8,
                  fontSize: 14,
                }}
              >
                <Settings className="icon-4" /> <span>Settings</span>
              </div>
            )}
          </div>

          {/* Units */}
          {sidebarOpen && (
            <div className="wg-side-card">
              <p className="wg-side-title">Units</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setUnit("C")}
                  className="wg-chip"
                  style={{
                    background:
                      unit === "C" ? "var(--accent)" : "var(--white-10)",
                    color: unit === "C" ? "#000" : "#fff",
                  }}
                >
                  °C
                </button>
                <button
                  onClick={() => setUnit("F")}
                  className="wg-chip"
                  style={{
                    background:
                      unit === "F" ? "var(--accent)" : "var(--white-10)",
                    color: unit === "F" ? "#000" : "#fff",
                  }}
                >
                  °F
                </button>
              </div>
            </div>
          )}

          {/* Favorites */}
          <div className="wg-side-card wg-favorites">
            {sidebarOpen && isClient ? (
              <>
                <p className="wg-side-title">Favorites</p>
                {favorites.length === 0 && (
                  <p className="wg-muted">No favorites yet.</p>
                )}
                <div className="wg-side-list">
                  {favorites.map((f) => (
                    <div
                      key={`${f.name}-${f.latitude}-${f.longitude}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <button
                        onClick={() => void loadForecastByCityName(f.name)}
                        className="wg-link"
                        style={{ color: "#fff", textAlign: "left" }}
                      >
                        {f.name}
                        {f.country ? `, ${f.country}` : ""}
                      </button>
                      <button
                        className="wg-chip"
                        onClick={() => removeFavorite(f.name, f.country)}
                        title="Remove favorite"
                        style={{ padding: 6 }}
                      >
                        <StarOff className="icon-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : !sidebarOpen ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Star className="icon-5" />
              </div>
            ) : (
              <p className="wg-muted">Loading…</p>
            )}
          </div>

          {/* Recents */}
          {sidebarOpen && (
            <div className="wg-side-card">
              <div className="wg-row" style={{ marginBottom: 6 }}>
                <p className="wg-side-title" style={{ margin: 0 }}>
                  Recent
                </p>
                {recents.length > 0 && (
                  <button
                    className="wg-chip"
                    onClick={clearRecents}
                    title="Clear all"
                    style={{ padding: "4px 8px" }}
                  >
                    <Trash2 className="icon-4" /> Clear
                  </button>
                )}
              </div>
              {isClient ? (
                recents.length === 0 ? (
                  <p className="wg-muted">No recent searches.</p>
                ) : (
                  <div className="wg-side-list wg-recents-scroll">
                    {recents.map((r) => (
                      <div
                        key={r}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <button
                          onClick={() => void loadForecastByCityName(r)}
                          className="wg-link"
                          style={{ color: "#fff", textAlign: "left" }}
                        >
                          {r}
                        </button>
                        <button
                          onClick={() => removeRecent(r)}
                          className="wg-chip"
                          title="Remove"
                          style={{ padding: 6 }}
                        >
                          <Trash2 className="icon-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <p className="wg-muted">Loading…</p>
              )}
            </div>
          )}

          {/* Install App */}
          {installPrompt && !isStandalone && (
            <button
              onClick={async () => {
                await installPrompt.prompt();
                await installPrompt.userChoice;
                setInstallPrompt(null);
              }}
              className="wg-btn-cta wg-install"
              title="Install as an app (PWA)"
              aria-label="Install App"
            >
              <Download className="icon-4" />
              Install App
            </button>
          )}
        </aside>

        {/* Main */}
        <main className="wg-container">
          <div className="wg-container-inner">
            {/* Search */}
            <div style={{ position: "relative", marginBottom: 20 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ position: "relative", flex: 1 }}>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search city (e.g., Stockholm)…"
                    className="wg-input"
                    aria-label="Search city"
                  />
                  {suggestions.length > 0 && (
                    <div ref={listRef} className="wg-suggest">
                      {suggestions.map((s) => (
                        <button
                          key={`${s.name}-${s.latitude}-${s.longitude}`}
                          onClick={() => selectSuggestion(s)}
                          className="wg-suggest-item"
                        >
                          <MapPin className="icon-4" color="#6b7280" />
                          <span style={{ fontWeight: 600 }}>{s.name}</span>
                          <span className="wg-faint">
                            {s.admin1 ? `${s.admin1}, ` : ""}
                            {s.country || ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={handleMyLocation}
                  className="wg-chip"
                  title="Use my location"
                  aria-label="Use my location"
                  style={{ flexShrink: 0 }}
                >
                  <LocateFixed className="icon-4" /> My Location
                </button>
              </div>
              {error && (
                <p style={{ marginTop: 8, color: "#fecaca", fontSize: 13 }}>
                  {error}
                </p>
              )}
            </div>

            {/* Alerts */}
            {((forecast && forecast.hourly?.precipitation_probability) ||
              forecast?.current_weather?.windspeed) && (
              <div className="wg-grid-2" style={{ marginBottom: 20 }}>
                {forecast?.hourly?.precipitation_probability
                  ?.slice(0, 6)
                  .some((p) => p >= 50) && (
                  <div className="wg-alert wg-alert-blue">
                    <CloudRain className="icon-5" />
                    <p>Increased rain probability in the next few hours.</p>
                  </div>
                )}
                {(forecast?.current_weather?.windspeed ?? 0) >= 35 && (
                  <div className="wg-alert wg-alert-cyan">
                    <Wind className="icon-5" />
                    <p>Gusty winds right now. Secure loose items.</p>
                  </div>
                )}
              </div>
            )}

            {/* Loading */}
            {loading && (
              <p className="wg-pulse" style={{ fontSize: 18 }}>
                Summoning ⚡...
              </p>
            )}

            {/* Forecast */}
            {forecast && !loading && (
              <div
                className={`wg-card ${compact ? "wg-space-6" : "wg-space-8"}`}
                style={{ position: "relative", overflow: "hidden" }}
              >
                {/* Card-only animated background */}
                <div style={cardBackgroundStyle(conditions.theme)} />

                {/* Header */}
                <div style={{ position: "relative", zIndex: 1 }}>
                  <div className="wg-forecast-header">
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 16 }}
                    >
                      {iconForWeather(nowCode, forecast?.current_weather?.time)}
                      <div>
                        <h2 className="wg-h2">{headerCityLabel}</h2>
                        <p style={{ color: "var(--muted)" }}>{timeLabel}</p>
                      </div>
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <p className="wg-forecast-temp">
                        {formatTemp(nowTemp, unit)}
                      </p>
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          justifyContent: "flex-end",
                          marginTop: 8,
                        }}
                      >
                        <button
                          onClick={addFavoriteFromForecast}
                          className="wg-chip"
                          title="Add to favorites"
                        >
                          <Star className="icon-4" /> Save
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Metrics (aligned to now) */}
                <div
                  className="wg-metrics-bar"
                  style={{ position: "relative", zIndex: 1 }}
                >
                  <div className="wg-metric-col">
                    <ThermometerSun className="icon-5" />
                    <div>
                      <p className="k">Feels like</p>
                      <p className="v">{formatTemp(nowFeels, unit)}</p>
                    </div>
                  </div>
                  <div className="wg-metric-col">
                    <Droplets className="icon-5" />
                    <div>
                      <p className="k">Humidity</p>
                      <p className="v">{nowHumidity ?? "—"}%</p>
                    </div>
                  </div>
                  <div className="wg-metric-col">
                    <CloudRain className="icon-5" />
                    <div>
                      <p className="k">Rain chance</p>
                      <p className="v">{nowPrecipProb ?? "—"}%</p>
                    </div>
                  </div>
                  <div className="wg-metric-col">
                    <Wind className="icon-5" />
                    <div>
                      <p className="k">Wind</p>
                      <p className="v">
                        {Math.round(forecast.current_weather?.windspeed ?? 0)}{" "}
                        km/h
                      </p>
                    </div>
                  </div>
                  <div className="wg-metric-col">
                    <CloudFog className="icon-5" />
                    <div>
                      <p className="k">Air Quality</p>
                      <p className="v">
                        {forecast.air_quality?.current?.european_aqi ??
                          forecast.air_quality?.european_aqi?.[0] ??
                          "—"}{" "}
                        AQI
                      </p>
                    </div>
                  </div>
                </div>

                {/* Next hours (starts at now) */}
                {forecast.hourly?.time && forecast.hourly?.weathercode && (
                  <div style={{ position: "relative", zIndex: 1 }}>
                    <h3 className="wg-h3">Next hours</h3>
                    <div
                      style={{
                        display: "grid",
                        gridAutoFlow: "column",
                        gridAutoColumns: "minmax(70px,1fr)",
                        gap: 8,
                        overflowX: "auto",
                        paddingBottom: 4,
                      }}
                    >
                      {(() => {
                        const times = forecast.hourly!.time;
                        const codes = forecast.hourly!.weathercode;
                        const temps = forecast.hourly!.temperature_2m;
                        const start = Math.max(0, nowIdx);
                        const end = Math.min(times.length, start + 16);
                        const items = [];
                        for (let i = start; i < end; i++) {
                          const t = times[i];
                          const code = codes[i];
                          const tempC = temps[i];
                          items.push(
                            <div
                              key={`${t}-${i}`}
                              className="wg-daily-card"
                              style={{ textAlign: "center" }}
                            >
                              <div
                                style={{
                                  margin: "6px 0",
                                  display: "flex",
                                  justifyContent: "center",
                                }}
                              >
                                {iconForWeather(code, t)}
                              </div>
                              <div style={{ fontSize: 12, opacity: 0.8 }}>
                                {formatHourLabel(t, hourlyTZ)}
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 700 }}>
                                {formatTemp(tempC, unit)}
                              </div>
                            </div>
                          );
                        }
                        return items;
                      })()}
                    </div>
                  </div>
                )}

                {/* 24h chart (starts at now) */}
                <div style={{ position: "relative", zIndex: 1 }}>
                  <h3 className="wg-h3">Next 24 hours</h3>
                  <div
                    style={{
                      height: 256,
                      width: "100%",
                      background: "var(--black-20)",
                      padding: 8,
                      borderRadius: 12,
                    }}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={hourlyChartData}>
                        <XAxis dataKey="time" />
                        <YAxis />
                        <Tooltip />
                        <Line
                          type="monotone"
                          dataKey="temp"
                          stroke="#facc15"
                          strokeWidth={3}
                        />
                        <Line
                          type="monotone"
                          dataKey="feels"
                          stroke="#60a5fa"
                          strokeWidth={2}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* 7-day outlook */}
                {forecast.daily?.time && forecast.daily?.weathercode && (
                  <div style={{ position: "relative", zIndex: 1 }}>
                    <h3 className="wg-h3">7-day outlook</h3>
                    <div className="wg-daily-grid">
                      {forecast.daily.time.map((t, i) => {
                        const max =
                          forecast.daily?.temperature_2m_max?.[i] ?? 0;
                        const min =
                          forecast.daily?.temperature_2m_min?.[i] ?? 0;
                        const code = forecast.daily?.weathercode?.[i];
                        return (
                          <div key={t} className="wg-daily-card">
                            <p style={{ fontSize: 13, color: "var(--muted)" }}>
                              {new Date(t).toLocaleDateString(undefined, {
                                weekday: "short",
                              })}
                            </p>
                            <div
                              style={{
                                margin: "8px 0",
                                display: "flex",
                                justifyContent: "center",
                              }}
                            >
                              {iconForWeather(code, t)}
                            </div>
                            <p style={{ fontSize: 13 }}>
                              <span style={{ fontWeight: 700 }}>
                                {formatTemp(max, unit)}
                              </span>{" "}
                              / {formatTemp(min, unit)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
