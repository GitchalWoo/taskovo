import type { TodoistDue } from "../todoist/types";

export interface DigestWindow {
  start: string;
  end: string;
}

export function localDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function digestWindow(timezone: string, now = new Date()): DigestWindow {
  const start = localDate(now, timezone);
  const end = new Date(`${start}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start, end: end.toISOString().slice(0, 10) };
}

export function inWindow(date: string, window: DigestWindow): boolean {
  return date >= window.start && date <= window.end;
}

export function dueInstant(due: TodoistDue, timezone: string): Date {
  if (!due.date.includes("T")) return new Date(`${due.date}T00:00:00Z`);
  if (/(Z|[+-]\d{2}:\d{2})$/i.test(due.date)) return new Date(due.date);

  // Todoist floating times are wall-clock times, not the server's local time.
  const wallTime = new Date(`${due.date}Z`).getTime();
  let instant = wallTime;
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: due.timezone ?? timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)!.value);
    const represented =
      Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second")) +
      (((instant % 1000) + 1000) % 1000);
    const adjustment = wallTime - represented;
    if (adjustment === 0) return new Date(instant);
    instant += adjustment;
  }
  throw new Error("Todoist due time does not exist in its timezone");
}

export function dueLocalDate(due: TodoistDue, timezone: string): string {
  return due.date.includes("T") ? localDate(dueInstant(due, timezone), timezone) : due.date;
}
