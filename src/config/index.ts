export interface Config {
  todoistApiToken: string;
  resendApiKey: string;
  digestRecipientEmail: string;
  digestFromEmail: string;
  timezone: string;
  digestCron: string;
  stateDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export function loadConfig(): Config {
  return {
    todoistApiToken: required("TODOIST_API_TOKEN"),
    resendApiKey: required("RESEND_API_KEY"),
    digestRecipientEmail: required("DIGEST_RECIPIENT_EMAIL"),
    digestFromEmail: required("DIGEST_FROM_EMAIL"),
    timezone: process.env["TIMEZONE"] ?? "Europe/Warsaw",
    digestCron: process.env["DIGEST_CRON"] ?? "0 19 * * 0",
    stateDir: process.env["STATE_DIR"] ?? "/data/state",
    logLevel: (process.env["LOG_LEVEL"] as Config["logLevel"]) ?? "info",
  };
}
