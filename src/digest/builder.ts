import nunjucks from "nunjucks";
import path from "path";
import fs from "fs";
import type { TodoistTask } from "../todoist/types";
import type { ProjectInfo } from "../todoist/client";

export interface DigestOutput {
  subject: string;
  text: string;
  html: string;
}

interface GroupedTask {
  content: string;
  dueDate: Date;
  dueString: string;
  priority: number;
  projectName: string;
  isOverdue: boolean;
  isRecurring: boolean;
  description: string;
  location: string | null;
  durationFormatted: string | null;
  flag: string | null;
}

/** Template data passed to Nunjucks */
interface TemplateData {
  dateRange: string;
  overdue: GroupedTask[];
  projects: { name: string; tasks: GroupedTask[] }[];
}

const TEMPLATES_DIR = path.join(import.meta.dir, "templates");
const DEFAULT_LANG = "en";

function resolveTemplateDir(lang: string): string {
  const langDir = path.join(TEMPLATES_DIR, lang);
  if (fs.existsSync(langDir)) return langDir;
  return path.join(TEMPLATES_DIR, DEFAULT_LANG);
}

export function buildDigest(
  tasks: TodoistTask[],
  projects: Map<string, ProjectInfo>,
  timezone: string,
  locations?: Map<string, string>,
  lang: string = DEFAULT_LANG,
): DigestOutput {
  const now = new Date();
  const rangeStart = startOfDay(now);
  const rangeEnd = daysFromNow(now, 7);

  const locale = langToLocale(lang);
  const dateRange = formatDateRange(rangeStart, rangeEnd, locale);

  const grouped = tasks
    .filter((t) => !t.isCompleted && t.due)
    .map((t): GroupedTask => {
      const dateStr = t.due!.date;
      const hasTime = dateStr.includes("T");
      const dueDate = new Date(dateStr);
      const durationMinutes = t.duration
        ? t.duration.unit === "minute"
          ? t.duration.amount
          : t.duration.amount * 24 * 60
        : null;
      const locationName = locations?.get(t.id) ?? null;
      return {
        content: t.content,
        dueDate,
        dueString: formatTaskDue(dueDate, hasTime, timezone, locale),
        priority: t.priority,
        projectName: projects.get(t.projectId)?.name ?? "Inbox",
        isOverdue: dueDate < startOfDay(now),
        isRecurring: t.due!.is_recurring,
        description: t.description,
        location: locationName,
        durationFormatted: durationMinutes ? formatDuration(durationMinutes) : null,
        flag: PRIORITY_FLAGS[t.priority] ?? null,
      };
    })
    .filter((t) => t.isOverdue || (t.dueDate >= rangeStart && t.dueDate <= rangeEnd));

  // Group by project, overdue first
  const overdue = grouped.filter((t) => t.isOverdue).sort(compareTasks);
  const byProject = new Map<string, GroupedTask[]>();

  for (const task of grouped.filter((t) => !t.isOverdue)) {
    const existing = byProject.get(task.projectName) ?? [];
    existing.push(task);
    byProject.set(task.projectName, existing);
  }

  // Sort tasks within each project
  for (const tasks of byProject.values()) {
    tasks.sort(compareTasks);
  }

  // Sort projects by Todoist order
  const projectOrder = buildProjectOrder(projects);
  const sortedEntries = [...byProject.entries()].sort(
    (a, b) => (projectOrder.get(a[0]) ?? Infinity) - (projectOrder.get(b[0]) ?? Infinity),
  );

  const templateData: TemplateData = {
    dateRange,
    overdue,
    projects: sortedEntries.map(([name, tasks]) => ({ name, tasks })),
  };

  const templateDir = resolveTemplateDir(lang);
  const nunjucksEnv = nunjucks.configure(templateDir, { autoescape: true });

  const rawHtml = nunjucksEnv.render("digest.html.njk", templateData);
  const text = nunjucksEnv.render("digest.text.njk", templateData);
  const subject = nunjucksEnv.render("digest.subject.njk", templateData).trim();

  return { subject, text: text.trim(), html: rawHtml };
}

/** Build a flat sort-order map: projectName -> global order.
 *  Top-level projects sort by their child_order.
 *  Sub-projects sort after their parent, by their own child_order. */
function buildProjectOrder(projects: Map<string, ProjectInfo>): Map<string, number> {
  const entries = [...projects.values()];
  const topLevel = entries.filter((p) => !p.parentId).sort((a, b) => a.order - b.order);

  const order = new Map<string, number>();
  let idx = 0;

  for (const parent of topLevel) {
    order.set(parent.name, idx++);
    // Insert children right after parent
    const children = entries
      .filter((p) => p.parentId && projects.get(p.parentId)?.name === parent.name)
      .sort((a, b) => a.order - b.order);
    for (const child of children) {
      order.set(child.name, idx++);
    }
  }

  return order;
}

function compareTasks(a: GroupedTask, b: GroupedTask): number {
  const dateDiff = a.dueDate.getTime() - b.dueDate.getTime();
  if (dateDiff !== 0) return dateDiff;
  return b.priority - a.priority; // higher priority first (4 = p1, 1 = p4)
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}min` : `${h}h`;
}

const PRIORITY_FLAGS: Record<number, string> = {
  4: "🔴", // p1
  3: "🟠", // p2
  2: "🔵", // p3
};

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysFromNow(date: Date, days: number): Date {
  const d = startOfDay(date);
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 59, 999);
  return d;
}

const LANG_LOCALE_MAP: Record<string, string> = {
  en: "en-GB",
  pl: "pl-PL",
};

function langToLocale(lang: string): string {
  return LANG_LOCALE_MAP[lang] ?? "en-GB";
}

function formatDateRange(start: Date, end: Date, locale: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  return `${start.toLocaleDateString(locale, opts)} – ${end.toLocaleDateString(locale, opts)}`;
}

function formatTaskDue(date: Date, hasTime: boolean, _timezone: string, locale: string): string {
  const dayOpts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
  const dayStr = date.toLocaleDateString(locale, dayOpts);
  if (!hasTime) return dayStr;
  const timeStr = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return `${dayStr}, ${timeStr}`;
}
