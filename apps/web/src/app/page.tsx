"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import "./style.css";

/* ---------------------------------------
   Hooks & Types
--------------------------------------- */

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
    time: string;
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

/* ---------------------------------------
   Per-user silo (cookie)
--------------------------------------- */

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

/* ---------------------------------------
   Helpers
--------------------------------------- */

function cToF(c: number | undefined) {
  if (typeof c !== "number") return c as unknown as number;
  return Math.round((c * 9) / 5 + 32);
}
function formatTemp(n: number | undefined, unit: "C" | "F") {
  if (typeof n !== "number") return "—";
  const v = unit === "F" ? cToF(n) : Math.round(n);
  return `${v}°${unit}`;
}
function chooseIconByTemp(temp: number | undefined) {
  const t = temp ?? 0;
  if (t >= 22) return <Sun className="icon-8" color="#facc15" />;
  if (t >= 8) return <Cloud className="icon-8" color="#e5e7eb" />;
  if (t >= -5) return <CloudRain className="icon-8" color="#93c5fd" />;
  return <Snowflake className="icon-8" color="#a5f3fc" />;
}
function bgClassByConditions(temp: number | undefined, rainProb?: number) {
  const t = temp ?? 0;
  if ((rainProb ?? 0) >= 50) return "bg-rain";
  if (t >= 22) return "bg-warm";
  if (t <= 0) return "bg-cold";
  return "bg-default";
}

/** interpret conditions */
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
  let isNight = false;
  if (currentIso) {
    const d = new Date(currentIso);
    const h = d.getHours();
    isNight = h < 6 || h >= 20;
  }
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
      label: isNight ? "Clear Night" : "Sunny",
      theme: isNight ? "night" : "sunny",
    };
  if (isCloudy)
    return { label: isNight ? "Cloudy Night" : "Cloudy", theme: "cloudy" };
  return {
    label: isNight ? "Night" : "—",
    theme: isNight ? "night" : "default",
  };
}

/** NEW: card-only background */
function cardBackgroundStyle(theme: string): React.CSSProperties {
  const base: React.CSSProperties = {
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
      return { ...base, background: "linear-gradient(135deg,#0f172a,#1e293b)" };
  }
}
/* ---------------------------------------
   Component
--------------------------------------- */

export default function WeatherGodPage() {
  const isClient = useIsClient();

  // NEW: stable per-user id + namespaced keys
  const [userId, setUserId] = useState<string>("");
  const [LS_KEYS, setLS_KEYS] = useState(makeKeys("boot"));

  useEffect(() => {
    if (!isClient) return;
    const id = ensureUserId();
    setUserId(id);
    setLS_KEYS(makeKeys(id));
  }, [isClient]);

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

  // PWA install
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const checkStandalone = () =>
      setIsStandalone(
        (window.matchMedia &&
          window.matchMedia("(display-mode: standalone)").matches) ||
          (window as unknown as { navigator?: { standalone?: boolean } })
            ?.navigator?.standalone === true
      );
    checkStandalone();

    const handler = (e: Event) => {
      const event = e as BeforeInstallPromptEvent;
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", handler);

    const onInstalled = () => {
      setInstallPrompt(null);
      setIsStandalone(true);
    };
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Hydration-safe localStorage restore
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
      // ignore
    }
  }, [isClient, userId, LS_KEYS]);

  const debounced = useDebouncedValue(query, 250);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isClient && userId) localStorage.setItem(LS_KEYS.unit, unit);
  }, [unit, isClient, userId, LS_KEYS]);
  useEffect(() => {
    if (isClient && userId)
      localStorage.setItem(LS_KEYS.compact, compact ? "1" : "0");
  }, [compact, isClient, userId, LS_KEYS]);
  useEffect(() => {
    if (isClient && userId)
      localStorage.setItem(LS_KEYS.favorites, JSON.stringify(favorites));
  }, [favorites, isClient, userId, LS_KEYS]);
  useEffect(() => {
    if (isClient && userId)
      localStorage.setItem(
        LS_KEYS.recents,
        JSON.stringify(recents.slice(0, 8))
      );
  }, [recents, isClient, userId, LS_KEYS]);

  /* Suggestions */
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

  /* API call */
  const loadForecastByCityName = useCallback(
    async (city: string) => {
      if (!city) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/forecast?city=${encodeURIComponent(city)}`
        );
        const json: Forecast | { error?: string } = await res.json();
        if (res.ok) {
          setForecast(json as Forecast);
          setRecents((r) => {
            const n = [
              city,
              ...r.filter((x) => x.toLowerCase() !== city.toLowerCase()),
            ];
            if (isClient && userId)
              localStorage.setItem(LS_KEYS.lastCity, city);
            return n.slice(0, 8);
          });
        } else {
          const msg =
            (json as { error?: string })?.error || "Failed to fetch forecast";
          throw new Error(msg);
        }
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
  /* First load */
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
            const { latitude, longitude } = pos.coords;
            try {
              const rev = await fetch(
                `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${latitude}&longitude=${longitude}&language=en`
              );
              const rj: { results?: Array<{ name?: string }> } =
                await rev.json();

              const label =
                rj?.results?.[0]?.name ||
                last ||
                `${latitude.toFixed(2)},${longitude.toFixed(2)}` ||
                fallbackCity;

              await loadForecastByCityName(label);
              setQuery(label);
            } catch {
              const city = last || fallbackCity;
              await loadForecastByCityName(city);
              setQuery(city);
            }
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
  }, [isClient, userId, LS_KEYS.lastCity, loadForecastByCityName]);

  const hourlyChartData = useMemo(() => {
    if (!forecast?.hourly) return [];
    const take = Math.min(24, forecast.hourly.time.length);
    return Array.from({ length: take }, (_, i) => {
      const temp = forecast.hourly!.temperature_2m[i];
      const feels = forecast.hourly!.apparent_temperature[i];
      return {
        time: new Date(forecast.hourly!.time[i]).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        temp: unit === "F" ? cToF(temp) : Math.round(temp),
        feels: unit === "F" ? cToF(feels) : Math.round(feels),
        rain: forecast.hourly!.precipitation_probability[i],
      };
    });
  }, [forecast, unit]);

  // Interpret conditions for background + header label
  const conditions = useMemo(() => {
    return interpretConditions(
      forecast?.current_weather?.weathercode,
      forecast?.hourly?.precipitation_probability?.[0],
      forecast?.current_weather?.time
    );
  }, [forecast]);

  const bgClass = bgClassByConditions(
    forecast?.current_weather?.temperature ??
      forecast?.hourly?.temperature_2m?.[0],
    forecast?.hourly?.precipitation_probability?.[0]
  );

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
    if (!exists) setFavorites([forecast.place, ...favorites].slice(0, 10));
  }

  function removeFavorite(name: string, country?: string) {
    setFavorites((prev) =>
      prev.filter((f) => !(f.name === name && f.country === country))
    );
  }

  function removeRecent(city: string) {
    setRecents((prev) => {
      const nxt = prev.filter((r) => r.toLowerCase() !== city.toLowerCase());
      if (isClient && userId)
        localStorage.setItem(LS_KEYS.recents, JSON.stringify(nxt));
      return nxt;
    });
  }

  function clearRecents() {
    setRecents([]);
    if (isClient && userId)
      localStorage.setItem(LS_KEYS.recents, JSON.stringify([]));
  }

  const timeLabel =
    isClient && forecast?.current_weather?.time
      ? new Date(forecast.current_weather.time).toLocaleString()
      : "—";

  // Build a human city label "City, Country — Condition"
  const headerCityLabel = useMemo(() => {
    const name = forecast?.place?.name ?? "";
    const ctry = forecast?.place?.country ? `, ${forecast.place.country}` : "";
    const cond =
      conditions.label && conditions.label !== "—"
        ? ` — ${conditions.label}`
        : "";
    return `${name}${ctry}${cond}`;
  }, [forecast?.place?.name, forecast?.place?.country, conditions.label]);

  return (
    <div
      className={`wg-root suppress ${bgClass}`}
      style={{ position: "relative" }}
    >
      {/* Removed global overlay here */}
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
            {/* Logo */}
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

            {/* Toggle Button */}
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="wg-chip"
              title="Toggle sidebar"
              aria-label="Toggle sidebar"
            >
              <Menu className="icon-4" />
            </button>

            {/* Settings */}
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

            {/* Forecast */}
            {forecast && !loading && (
              <div
                className={`wg-card ${compact ? "wg-space-6" : "wg-space-8"}`}
                style={{ position: "relative", overflow: "hidden" }}
              >
                {/* Card background overlay */}
                <div style={cardBackgroundStyle(conditions.theme)} />

                {/* Card content sits above */}
                <div style={{ position: "relative", zIndex: 1 }}>
                  <div className="wg-forecast-header">
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 16 }}
                    >
                      {chooseIconByTemp(
                        forecast.current_weather?.temperature ??
                          forecast.hourly?.temperature_2m?.[0]
                      )}
                      <div>
                        <h2 className="wg-h2">{headerCityLabel}</h2>
                        <p style={{ color: "var(--muted)" }}>{timeLabel}</p>
                      </div>
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <p className="wg-forecast-temp">
                        {formatTemp(
                          forecast.current_weather?.temperature ??
                            forecast.hourly?.temperature_2m?.[0],
                          unit
                        )}
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
                          <Star className="icon-4" />
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  className="wg-metrics-bar"
                  style={{ position: "relative", zIndex: 1 }}
                >
                  <div className="wg-metric-col">
                    <ThermometerSun className="icon-5" />
                    <div>
                      <p className="k">Feels like</p>
                      <p className="v">
                        {formatTemp(
                          forecast.hourly?.apparent_temperature?.[0],
                          unit
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="wg-metric-col">
                    <Droplets className="icon-5" />
                    <div>
                      <p className="k">Humidity</p>
                      <p className="v">
                        {forecast.hourly?.relative_humidity_2m?.[0] ?? "—"}%
                      </p>
                    </div>
                  </div>
                  <div className="wg-metric-col">
                    <CloudRain className="icon-5" />
                    <div>
                      <p className="k">Rain chance</p>
                      <p className="v">
                        {forecast.hourly?.precipitation_probability?.[0] ?? "—"}
                        %
                      </p>
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
                        {forecast.air_quality?.european_aqi?.[0] ?? "—"} AQI
                      </p>
                    </div>
                  </div>
                </div>

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

                {forecast.daily?.time && (
                  <div style={{ position: "relative", zIndex: 1 }}>
                    <h3 className="wg-h3">7-day outlook</h3>
                    <div className="wg-daily-grid">
                      {forecast.daily.time.map((t, i) => {
                        const max =
                          forecast.daily?.temperature_2m_max?.[i] ?? 0;
                        const min =
                          forecast.daily?.temperature_2m_min?.[i] ?? 0;
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
                              {chooseIconByTemp(max)}
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
