import { loadConfig } from "./config";
import { setLogLevel, logger } from "./utils/logger";
import { fetchTodoistData } from "./todoist/client";
import { buildDigest } from "./digest/builder";
import { sendDigestEmail } from "./email/sender";
import { Cron } from "croner";

async function runDigest(dryRun: boolean): Promise<void> {
  const start = Date.now();
  logger.info("Starting weekly digest run", { dryRun });

  const config = loadConfig();

  const { tasks, projects, locations } = await fetchTodoistData(config);
  const digest = buildDigest(tasks, projects, config.timezone, locations);

  if (dryRun) {
    logger.info("Dry run — skipping email send");
    console.log(`\n--- ${digest.subject} ---\n`);
    console.log(digest.text);
    console.log();
  } else {
    await sendDigestEmail(config, digest);
  }

  const duration = Date.now() - start;
  logger.info("Digest run completed", { durationMs: duration });
}

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  const serveMode = process.argv.includes("--serve");
  const dryRun = process.argv.includes("--dry-run");

  if (serveMode) {
    logger.info("Starting in serve mode", { cron: config.digestCron });
    const job = new Cron(config.digestCron, async () => {
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

main();
