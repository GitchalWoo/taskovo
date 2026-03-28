import type { Config } from "../config";
import { logger } from "../utils/logger";

export interface WeatherDay {
  date: string; // ISO date string (YYYY-MM-DD)
  tempMax: number; // °C
  tempMin: number; // °C
  code: number; // WMO weather code
  condition: string; // human-readable condition
}

export interface WeatherForecast {
  locationName: string | null; // resolved city name (from geocoding), null when using raw lat/lon
  days: WeatherDay[];
}

interface Coordinates {
  latitude: string;
  longitude: string;
}

interface GeocodingResult {
  coords: Coordinates;
  name: string;
}

/** Open-Meteo daily forecast response shape (subset) */
interface OpenMeteoDailyResponse {
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    weather_code: number[];
  };
}

/** Open-Meteo geocoding response shape */
interface GeocodingResponse {
  results?: { latitude: number; longitude: number; name: string; country: string }[];
}

/** WMO Weather interpretation codes → short labels.
 *  Full spec: https://open-meteo.com/en/docs#weathervariables */
const WMO_CODES: Record<string, Record<number, string>> = {
  en: {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    56: "Light freezing drizzle",
    57: "Freezing drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Freezing rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Light showers",
    81: "Showers",
    82: "Heavy showers",
    85: "Light snow showers",
    86: "Snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm w/ light hail",
    99: "Thunderstorm w/ hail",
  },
  pl: {
    0: "Bezchmurnie",
    1: "Prawie bezchmurnie",
    2: "Częściowe zachmurzenie",
    3: "Pochmurno",
    45: "Mgła",
    48: "Szadź",
    51: "Lekka mżawka",
    53: "Mżawka",
    55: "Silna mżawka",
    56: "Lekka marznąca mżawka",
    57: "Marznąca mżawka",
    61: "Lekki deszcz",
    63: "Deszcz",
    65: "Silny deszcz",
    66: "Lekki marznący deszcz",
    67: "Marznący deszcz",
    71: "Lekki śnieg",
    73: "Śnieg",
    75: "Silny śnieg",
    77: "Ziarna śniegu",
    80: "Lekkie przelotne opady",
    81: "Przelotne opady",
    82: "Silne przelotne opady",
    85: "Lekkie opady śniegu",
    86: "Opady śniegu",
    95: "Burza",
    96: "Burza z lekkim gradem",
    99: "Burza z gradem",
  },
};

function wmoToCondition(code: number): string {
  return WMO_CODES["en"]![code] ?? "Unknown";
}

/** Return a copy of the forecast with conditions translated to the given language. */
export function localizeWeather(forecast: WeatherForecast, lang: string): WeatherForecast {
  const codes = WMO_CODES[lang] ?? WMO_CODES["en"]!;
  return {
    ...forecast,
    days: forecast.days.map((d) => ({ ...d, condition: codes[d.code] ?? d.condition })),
  };
}

/** Geocode a city name to coordinates via Open-Meteo's free geocoding API. */
async function geocode(location: string): Promise<GeocodingResult | null> {
  const params = new URLSearchParams({ name: location, count: "1", format: "json" });
  const url = `https://geocoding-api.open-meteo.com/v1/search?${params}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    logger.warn("Geocoding request failed", { status: response.status });
    return null;
  }

  const data = (await response.json()) as GeocodingResponse;
  const result = data.results?.[0];
  if (!result) {
    logger.warn("Geocoding returned no results", { location });
    return null;
  }

  logger.info("Geocoded location", {
    query: location,
    resolved: `${result.name}, ${result.country}`,
    lat: result.latitude,
    lon: result.longitude,
  });

  return {
    coords: { latitude: String(result.latitude), longitude: String(result.longitude) },
    name: result.name,
  };
}

interface ResolvedLocation {
  coords: Coordinates;
  locationName: string | null;
}

/** Resolve coordinates from config: explicit lat/lon takes priority, then geocode from city name. */
async function resolveLocation(config: Config): Promise<ResolvedLocation | null> {
  if (config.weatherLatitude && config.weatherLongitude) {
    return {
      coords: { latitude: config.weatherLatitude, longitude: config.weatherLongitude },
      locationName: null,
    };
  }

  if (config.weatherLocation) {
    const result = await geocode(config.weatherLocation);
    if (!result) return null;
    return { coords: result.coords, locationName: result.name };
  }

  return null;
}

export async function fetchWeekForecast(config: Config): Promise<WeatherForecast | null> {
  const resolved = await resolveLocation(config);
  if (!resolved) {
    logger.debug("Weather not configured, skipping forecast");
    return null;
  }

  const { coords, locationName } = resolved;
  const baseUrl = "https://api.open-meteo.com/v1/forecast";
  const params = new URLSearchParams({
    latitude: coords.latitude,
    longitude: coords.longitude,
    daily: "temperature_2m_max,temperature_2m_min,weather_code",
    timezone: config.timezone,
    forecast_days: "7",
  });

  const url = `${baseUrl}?${params}`;

  try {
    logger.info("Fetching 7-day weather forecast", { lat: coords.latitude, lon: coords.longitude });

    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      logger.warn("Weather API request failed", { status: response.status, statusText: response.statusText });
      return null;
    }

    const data = (await response.json()) as OpenMeteoDailyResponse;
    const { time, temperature_2m_max, temperature_2m_min, weather_code } = data.daily;

    const days: WeatherDay[] = time.map((date, i) => ({
      date,
      tempMax: Math.round(temperature_2m_max[i]!),
      tempMin: Math.round(temperature_2m_min[i]!),
      code: weather_code[i]!,
      condition: wmoToCondition(weather_code[i]!),
    }));

    logger.info("Weather forecast fetched", { days: days.length });
    return { locationName, days };
  } catch (error) {
    logger.warn("Weather fetch failed, digest will be sent without forecast", { error: String(error) });
    return null;
  }
}
