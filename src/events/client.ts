import type { Config } from "../config";
import { logger } from "../utils/logger";

export interface LocalEvent {
  title: string;
  url: string;
  categories: string[];
  dateText: string; // raw date/time text from the page
  date: string | null; // first date found, ISO format (YYYY-MM-DD)
  district: string | null;
}

export interface LocalEvents {
  events: LocalEvent[];
  sourceUrl: string;
}

const BASE_URL = "https://waw4free.pl";

function buildUrl(config: Config): string {
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, "0");
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const yyyy = today.getFullYear();
  const dateStr = `${dd}.${mm}.${yyyy}`;

  const params = new URLSearchParams({
    wydarzenia: dateStr,
    kolejne_dni: "tak",
  });

  if (config.eventsDistrict) {
    params.set("dzielnica06", config.eventsDistrict);
  }

  return `${BASE_URL}/?${params.toString()}`;
}

/** Parse a single box element's HTML string and extract event data. */
function parseBox(boxHtml: string): LocalEvent | null {
  // Extract title + URL from box-title link
  const titleMatch = boxHtml.match(
    /<div class="box-title">\s*<a[^>]*title="([^"]*)"[^>]*href="(wydarzenie-[^"]*)"[^>]*>/,
  );
  if (!titleMatch) return null;

  const title = decodeHtmlEntities(titleMatch[1] ?? "");
  const relativeUrl = titleMatch[2] ?? "";
  const url = `${BASE_URL}/${relativeUrl}`;

  // Extract categories from b-c-* class divs
  const categories: string[] = [];
  const catRegex = /<div class="b-c-[^"]*">\s*<a[^>]*>([^<]+)<\/a>/g;
  let catMatch: RegExpExecArray | null;
  while ((catMatch = catRegex.exec(boxHtml)) !== null) {
    const cat = catMatch[1]?.trim();
    if (cat && cat !== "reklama" && cat !== "autopromocja") {
      categories.push(cat);
    }
  }

  // Extract date text from box-data
  const dataMatch = boxHtml.match(/<div class="box-data">([\s\S]*?)<\/div>/);
  let dateText = "";
  let district: string | null = null;

  if (dataMatch) {
    // Strip HTML tags, normalize whitespace
    const raw = (dataMatch[1] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Clean up common prefixes from "kolejne_dni" mode
    const cleaned = raw.replace(/^wydarzenie zaczyna się przed podaną datą i trwa do\s*/i, "do ").trim();

    // Split by last comma to separate district
    const parts = cleaned.split(",").map((p) => p.trim());
    const KNOWN_DISTRICTS = [
      "Bemowo",
      "Białołęka",
      "Bielany",
      "Mokotów",
      "Ochota",
      "Praga-Południe",
      "Praga-Północ",
      "Rembertów",
      "Śródmieście",
      "Targówek",
      "Ursus",
      "Ursynów",
      "Wawer",
      "Wesoła",
      "Wilanów",
      "Włochy",
      "Wola",
      "Żoliborz",
    ];
    const lastPart = parts[parts.length - 1] ?? "";
    if (KNOWN_DISTRICTS.some((d) => lastPart.includes(d))) {
      district = lastPart;
      dateText = parts.slice(0, -1).join(", ");
    } else {
      dateText = cleaned;
    }
  }

  // Extract first DD.MM.YYYY date for filtering/sorting
  const dateMatch = dateText.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  const date = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

  return { title, url, categories, dateText, date, district };
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

/** Scrape local events from waw4free.pl for the next 7 days. */
export async function fetchLocalEvents(config: Config): Promise<LocalEvents | null> {
  if (!config.eventsEnabled) {
    logger.debug("Local events not enabled, skipping");
    return null;
  }

  const url = buildUrl(config);

  try {
    logger.info("Fetching local events", { url: url.replace(/wydarzenia=[^&]+/, "wydarzenia=...") });

    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent": "Taskovo/1.0 (digest bot)",
        Accept: "text/html",
      },
    });

    if (!response.ok) {
      logger.warn("waw4free request failed", { status: response.status, statusText: response.statusText });
      return null;
    }

    const html = await response.text();

    // Split HTML into box segments — each event is a <div class="box">
    // Skip "re-box" (ads) and boxes without event links
    const events: LocalEvent[] = [];
    const boxRegex = /<div class="box(?:\s+polecane)?"\s*>/g;
    let match: RegExpExecArray | null;
    const boxPositions: number[] = [];

    while ((match = boxRegex.exec(html)) !== null) {
      boxPositions.push(match.index);
    }

    for (let i = 0; i < boxPositions.length; i++) {
      const start = boxPositions[i];
      const end = i + 1 < boxPositions.length ? boxPositions[i + 1] : html.length;
      const boxHtml = html.slice(start, end);

      // Skip ads/self-promotion
      if (boxHtml.includes("b-c-border") || boxHtml.includes("autopromocja")) continue;
      if (boxHtml.includes('href="wesprzyj"')) continue;

      const event = parseBox(boxHtml);
      if (event) events.push(event);
    }

    // Filter to 7-day window matching the digest range
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);

    const filtered = events.filter((e) => {
      if (!e.date) return true; // keep events with unparseable dates
      return e.date >= todayStr && e.date <= weekEndStr;
    });

    if (filtered.length === 0) {
      logger.info("No local events in the next 7 days");
      return null;
    }

    logger.info("Local events scraped", { total: events.length, filtered: filtered.length });
    return { events: filtered, sourceUrl: url };
  } catch (error) {
    logger.warn("Local events fetch failed, digest will be sent without events data", {
      error: String(error),
    });
    return null;
  }
}
