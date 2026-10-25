import { loadConfig, type Config } from "./config";
import { setLogLevel, logger } from "./utils/logger";
import { fetchTodoistData } from "./todoist/client";
import type { TodoistTask, TodoistCollaborator, TodoistCollaboratorState } from "./todoist/types";
import { buildDigest } from "./digest/builder";
import { sendDigestEmail } from "./email/sender";
import { generateWeekSummary } from "./ai/client";
import { fetchWeekForecast, localizeWeather } from "./weather/client";
import { fetchF1Schedule } from "./f1/client";
import { fetchLocalEvents } from "./events/client";
import { Cron } from "croner";
import { digestWindow, dueLocalDate, inWindow } from "./utils/dates";

interface RecipientDigest {
  email: string;
  name: string;
  tasks: TodoistTask[];
  audience: string;
}

/** Build a per-person task list based on project membership.
 *  - Owner gets ALL tasks (shared + private projects).
 *  - Collaborators get only tasks from shared projects they belong to. */
function buildRecipientLists(
  tasks: TodoistTask[],
  collaborators: TodoistCollaborator[],
  collaboratorStates: TodoistCollaboratorState[],
  ownerId: string,
): RecipientDigest[] {
  // Map: userId -> set of project IDs they can see
  const projectsByUser = new Map<string, Set<string>>();
  for (const cs of collaboratorStates) {
    const existing = projectsByUser.get(cs.userId) ?? new Set();
    existing.add(cs.projectId);
    projectsByUser.set(cs.userId, existing);
  }

  const recipients: RecipientDigest[] = [];

  for (const collab of collaborators) {
    if (collab.id === ownerId) {
      // Owner gets everything
      recipients.push({ email: collab.email, name: collab.fullName, tasks, audience: `owner:${ownerId}` });
    } else {
      // Collaborator gets only tasks from their shared projects
      const allowedProjects = projectsByUser.get(collab.id);
      if (!allowedProjects || allowedProjects.size === 0) continue;
      const filtered = tasks.filter((t) => allowedProjects.has(t.projectId));
      if (filtered.length === 0) continue;
      recipients.push({
        email: collab.email,
        name: collab.fullName,
        tasks: filtered,
        audience: JSON.stringify([...allowedProjects].sort()),
      });
    }
  }

  return recipients;
}

export async function runDigest(dryRun: boolean, config = loadConfig()): Promise<void> {
  const start = Date.now();
  logger.info("Starting weekly digest run", { dryRun });

  const window = digestWindow(config.timezone, new Date(start));

  const [todoistData, forecast, f1Schedule, localEvents] = await Promise.all([
    fetchTodoistData(config),
    fetchWeekForecast(config, window),
    fetchF1Schedule(config, window),
    fetchLocalEvents(config, window),
  ]);
  const { tasks, projects, locations, collaborators, collaboratorStates, ownerId, ownerLang } = todoistData;
  const localizedForecast = forecast ? localizeWeather(forecast, ownerLang) : null;

  const allRecipients = buildRecipientLists(tasks, collaborators, collaboratorStates, ownerId);
  const recipients = allRecipients.filter((r) => !config.digestEmailBlacklist.has(r.email.toLowerCase()));

  if (recipients.length < allRecipients.length) {
    const skipped = allRecipients.filter((r) => config.digestEmailBlacklist.has(r.email.toLowerCase()));
    logger.info("Blacklisted recipients skipped", { skipped: skipped.map((r) => r.name) });
  }

  logger.info("Built per-person digests", {
    recipientCount: recipients.length,
    recipients: recipients.map((r) => r.name),
  });

  let sent = 0;
  let skipped = 0;
  const failures: unknown[] = [];
  for (const recipient of recipients) {
    try {
      // Build task summary inputs for LLM (non-completed tasks with due dates in the next 7 days)
      const summaryTasks = recipient.tasks
        .filter((t) => !t.isCompleted && t.due)
        .filter((t) => {
          return inWindow(dueLocalDate(t.due!, config.timezone), window);
        })
        .map((t) => ({
          content: t.content,
          dueDate: t.due!.date,
          project: projects.get(t.projectId)?.name ?? "Inbox",
          priority: t.priority,
        }));

      const weekSummary = await generateWeekSummary(config, summaryTasks, ownerLang, localizedForecast);

      const digest = buildDigest(
        recipient.tasks,
        projects,
        config.timezone,
        locations,
        ownerLang,
        weekSummary,
        localizedForecast,
        f1Schedule,
        localEvents,
        window,
      );

      if (dryRun) {
        console.log(`\n--- ${recipient.name} (${recipient.email}) ---`);
        console.log(`--- ${digest.subject} ---`);
        console.log(`Tasks: ${recipient.tasks.length}\n`);
        console.log(digest.text);
        console.log();
      } else {
        const outcome = await sendDigestEmail(config, digest, recipient.email, window, recipient.audience);
        if (outcome === "sent") sent++;
        else skipped++;
      }
    } catch (error) {
      failures.push(error);
      logger.error("Recipient digest failed", { recipient: recipient.name, error: String(error) });
    }
  }

  const duration = Date.now() - start;
  logger.info("Digest run completed", {
    durationMs: duration,
    recipientCount: recipients.length,
    sent,
    skipped,
    failed: failures.length,
    dryRun,
  });
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Digest delivery failed for ${failures.length} of ${recipients.length} recipients`,
    );
  }
}

export function createDigestJob(config: Config, callback: () => Promise<void>): Cron {
  return new Cron(config.digestCron, { timezone: config.timezone, protect: true }, callback);
}

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  const serveMode = process.argv.includes("--serve");
  const dryRun = process.argv.includes("--dry-run");

  if (serveMode) {
    logger.info("Starting in serve mode", { cron: config.digestCron });
    const job = createDigestJob(config, async () => {
      try {
        await runDigest(false);
      } catch (error) {
        logger.error("Digest run failed", { error: String(error) });
      }
    });
    logger.info("Cron job scheduled", { nextRun: job.nextRun()?.toISOString() });

    // Keep process alive
    process.on("SIGINT", () => {
      logger.info("Shutting down");
      job.stop();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      logger.info("Shutting down");
      job.stop();
      process.exit(0);
    });
  } else {
    logger.info("Running in one-shot mode", { dryRun });
    try {
      await runDigest(dryRun);
    } catch (error) {
      logger.error("Digest run failed", { error: String(error) });
      process.exit(1);
    }
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    logger.error("Startup failed", { error: String(error) });
    process.exitCode = 1;
  });
}
