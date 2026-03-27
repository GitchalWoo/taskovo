import type { TodoistTask } from "../todoist/types";

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
}

export function buildDigest(
  tasks: TodoistTask[],
  projects: Map<string, string>,
  timezone: string,
): DigestOutput {
  const now = new Date();
  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(weekStart);

  const subject = `Your week ahead — ${formatDateRange(weekStart, weekEnd)}`;

  const grouped = tasks
    .filter((t) => !t.isCompleted && t.due)
    .map((t): GroupedTask => {
      const dueDate = new Date(t.due!.datetime ?? t.due!.date);
      return {
        content: t.content,
        dueDate,
        dueString: formatTaskDue(dueDate, !!t.due!.datetime, timezone),
        hasTime: !!t.due!.datetime,
        priority: t.priority,
        projectName: projects.get(t.projectId) ?? "Inbox",
        isOverdue: dueDate < startOfDay(now),
      };
    })
    .filter((t) => t.isOverdue || (t.dueDate >= startOfDay(now) && t.dueDate <= weekEnd));

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

  const text = formatText(overdue, byProject);
  const html = formatHtml(overdue, byProject);

  return { subject, text, html };
}

function compareTasks(a: GroupedTask, b: GroupedTask): number {
  const dateDiff = a.dueDate.getTime() - b.dueDate.getTime();
  if (dateDiff !== 0) return dateDiff;
  return b.priority - a.priority; // higher priority first (4 = p1, 1 = p4)
}

function formatTaskLine(task: GroupedTask): string {
  let line = task.content;
  if (task.dueString) line += ` — ${task.dueString}`;
  if (task.priority > 1) line += ` [p${5 - task.priority}]`;
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

function formatHtml(overdue: GroupedTask[], byProject: Map<string, GroupedTask[]>): string {
  const sections: string[] = [];
  sections.push("<div style=\"font-family: sans-serif; max-width: 600px;\">");

  if (overdue.length > 0) {
    sections.push("<h3 style=\"color: #e53e3e;\">⚠ Overdue</h3><ul>");
    for (const task of overdue) {
      sections.push(`<li>${escapeHtml(formatTaskLine(task))}</li>`);
    }
    sections.push("</ul>");
  }

  for (const [project, tasks] of byProject) {
    sections.push(`<h3>${escapeHtml(project)}</h3><ul>`);
    for (const task of tasks) {
      sections.push(`<li>${escapeHtml(formatTaskLine(task))}</li>`);
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

function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday as start of week
  d.setDate(d.getDate() + diff);
  return d;
}

function endOfWeek(weekStart: Date): Date {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
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
