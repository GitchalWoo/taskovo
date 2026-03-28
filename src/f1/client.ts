import type { Config } from "../config";
import { logger } from "../utils/logger";

export interface F1Session {
  name: string; // "FP1", "FP2", "FP3", "Qualifying", "Sprint Qualifying", "Sprint", "Race"
  date: string; // ISO date (YYYY-MM-DD)
  time: string; // UTC time (HH:MM:SSZ)
}

export interface F1Event {
  raceName: string;
  circuitName: string;
  locality: string;
  country: string;
  round: number;
  sessions: F1Session[];
}

export interface F1Schedule {
  season: string;
  events: F1Event[];
}

/** Jolpica (Ergast successor) API response shape — subset we care about */
interface SessionTiming {
  date: string;
  time: string;
}

interface JolpicaRace {
  round: string;
  raceName: string;
  Circuit: {
    circuitName: string;
    Location: { locality: string; country: string };
  };
  date: string;
  time: string;
  FirstPractice?: SessionTiming;
  SecondPractice?: SessionTiming;
  ThirdPractice?: SessionTiming;
  Qualifying?: SessionTiming;
  SprintQualifying?: SessionTiming;
  Sprint?: SessionTiming;
}

interface JolpicaResponse {
  MRData: {
    RaceTable: {
      season: string;
      Races: JolpicaRace[];
    };
  };
}

const SESSION_ORDER: Record<string, number> = {
  FP1: 1,
  "Sprint Qualifying": 2,
  FP2: 3,
  Sprint: 4,
  FP3: 5,
  Qualifying: 6,
  Race: 7,
};

function extractSessions(race: JolpicaRace): F1Session[] {
  const sessions: F1Session[] = [];

  if (race.FirstPractice) sessions.push({ name: "FP1", ...race.FirstPractice });
  if (race.SprintQualifying) sessions.push({ name: "Sprint Qualifying", ...race.SprintQualifying });
  if (race.SecondPractice) sessions.push({ name: "FP2", ...race.SecondPractice });
  if (race.Sprint) sessions.push({ name: "Sprint", ...race.Sprint });
  if (race.ThirdPractice) sessions.push({ name: "FP3", ...race.ThirdPractice });
  if (race.Qualifying) sessions.push({ name: "Qualifying", ...race.Qualifying });
  sessions.push({ name: "Race", date: race.date, time: race.time });

  // Sort by date+time, then by canonical session order for same date
  sessions.sort((a, b) => {
    const dtA = `${a.date}T${a.time}`;
    const dtB = `${b.date}T${b.time}`;
    if (dtA !== dtB) return dtA.localeCompare(dtB);
    return (SESSION_ORDER[a.name] ?? 99) - (SESSION_ORDER[b.name] ?? 99);
  });

  return sessions;
}

/** Fetch the current F1 season schedule and return events with any session in the next 7 days. */
export async function fetchF1Schedule(config: Config): Promise<F1Schedule | null> {
  if (!config.f1Schedule) {
    logger.debug("F1 schedule not enabled, skipping");
    return null;
  }

  const url = "https://api.jolpi.ca/ergast/f1/current.json";

  try {
    logger.info("Fetching F1 season schedule");

    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });

    if (!response.ok) {
      logger.warn("F1 API request failed", { status: response.status, statusText: response.statusText });
      return null;
    }

    const data = (await response.json()) as JolpicaResponse;
    const { season, Races } = data.MRData.RaceTable;

    const now = new Date();
    const nowDate = now.toISOString().slice(0, 10);
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndDate = weekEnd.toISOString().slice(0, 10);

    const upcoming: F1Event[] = [];

    for (const race of Races) {
      const sessions = extractSessions(race);
      // Include event if ANY session falls within today → +7 days
      const hasUpcoming = sessions.some((s) => s.date >= nowDate && s.date <= weekEndDate);
      if (!hasUpcoming) continue;

      upcoming.push({
        raceName: race.raceName,
        circuitName: race.Circuit.circuitName,
        locality: race.Circuit.Location.locality,
        country: race.Circuit.Location.country,
        round: parseInt(race.round, 10),
        sessions,
      });
    }

    if (upcoming.length === 0) {
      logger.info("No F1 events in the next 7 days");
      return null;
    }

    logger.info("F1 events found in next 7 days", {
      count: upcoming.length,
      events: upcoming.map((e) => e.raceName),
    });
    return { season, events: upcoming };
  } catch (error) {
    logger.warn("F1 schedule fetch failed, digest will be sent without F1 data", { error: String(error) });
    return null;
  }
}
