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
  hasTime: boolean;
  priority: number;
  projectName: string;
  isOverdue: boolean;
  isRecurring: boolean;
  description: string;
  durationMinutes: number | null;
}

export function buildDigest(
  tasks: TodoistTask[],
  projects: Map<string, ProjectInfo>,
  timezone: string,
  locations?: Map<string, string>,
): DigestOutput {
  const now = new Date();
  const rangeStart = startOfDay(now);
  const rangeEnd = daysFromNow(now, 7);

  const subject = `Your week ahead — ${formatDateRange(rangeStart, rangeEnd)}`;

  const grouped = tasks
    .filter((t) => !t.isCompleted && t.due)
    .map((t): GroupedTask => {
      const dateStr = t.due!.date;
      const hasTime = dateStr.includes("T");
      const dueDate = new Date(dateStr);
      const durationMinutes = t.duration
        ? t.duration.unit === "minute" ? t.duration.amount : t.duration.amount * 24 * 60
        : null;
      const locationName = locations?.get(t.id);
      const desc = locationName
        ? (t.description ? `${locationName} — ${t.description}` : locationName)
        : t.description;
      return {
        content: t.content,
        dueDate,
        dueString: formatTaskDue(dueDate, hasTime, timezone),
        hasTime,
        priority: t.priority,
        projectName: projects.get(t.projectId)?.name ?? "Inbox",
        isOverdue: dueDate < startOfDay(now),
        isRecurring: t.due!.is_recurring,
        description: desc,
        durationMinutes,
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
  const sortedByProject = new Map(
    [...byProject.entries()].sort((a, b) =>
      (projectOrder.get(a[0]) ?? Infinity) - (projectOrder.get(b[0]) ?? Infinity)
    ),
  );

  const text = formatText(overdue, sortedByProject);
  const html = formatHtml(overdue, sortedByProject);

  return { subject, text, html };
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

function formatTaskLine(task: GroupedTask): string {
  let line = task.content;
  if (task.dueString) line += ` — ${task.dueString}`;
  if (task.durationMinutes) line += ` (${formatDuration(task.durationMinutes)})`;
  if (PRIORITY_FLAGS[task.priority]) line += ` ${PRIORITY_FLAGS[task.priority]}`;
  if (task.isRecurring) line += ` 🔁`;
  if (task.description) line += `\n      📍 ${task.description}`;
  return line;
}

function formatText(overdue: GroupedTask[], byProject: Map<string, GroupedTask[]>): string {
  const sections: string[] = [];

  if (overdue.length > 0) {
    sections.push("⚠ Overdue");
    for (const task of overdue) {
      sections.push(`  • ${formatTaskLine(task)}`);
    }
    sections.push("");
  }

  for (const [project, tasks] of byProject) {
    sections.push(project);
    for (const task of tasks) {
      sections.push(`  • ${formatTaskLine(task)}`);
    }
    sections.push("");
  }

  return sections.join("\n").trim();
}

function formatTaskHtml(task: GroupedTask): string {
  let line = escapeHtml(task.content);
  if (task.dueString) line += ` &mdash; ${escapeHtml(task.dueString)}`;
  if (task.durationMinutes) line += ` (${formatDuration(task.durationMinutes)})`;
  if (PRIORITY_FLAGS[task.priority]) line += ` ${PRIORITY_FLAGS[task.priority]}`;
  if (task.isRecurring) line += ` 🔁`;
  if (task.description) line += `<br><span style="color: #666; font-size: 0.9em;">📍 ${escapeHtml(task.description)}</span>`;
  return line;
}

function formatHtml(overdue: GroupedTask[], byProject: Map<string, GroupedTask[]>): string {
  const sections: string[] = [];
  sections.push("<div style=\"font-family: sans-serif; max-width: 600px;\">");

  if (overdue.length > 0) {
    sections.push("<h3 style=\"color: #e53e3e;\">⚠ Overdue</h3><ul>");
    for (const task of overdue) {
      sections.push(`<li>${formatTaskHtml(task)}</li>`);
    }
    sections.push("</ul>");
  }

  for (const [project, tasks] of byProject) {
    sections.push(`<h3>${escapeHtml(project)}</h3><ul>`);
    for (const task of tasks) {
      sections.push(`<li>${formatTaskHtml(task)}</li>`);
    }
    sections.push("</ul>");
  }

  sections.push("</div>");
  return sections.join("\n");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

function formatDateRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  return `${start.toLocaleDateString("en-GB", opts)} – ${end.toLocaleDateString("en-GB", opts)}`;
}

function formatTaskDue(date: Date, hasTime: boolean, _timezone: string): string {
  const dayOpts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
  const dayStr = date.toLocaleDateString("en-GB", dayOpts);
  if (!hasTime) return dayStr;
  const timeStr = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${dayStr}, ${timeStr}`;
}
