export interface Config {
  todoistApiToken: string;
  resendApiKey: string;
  digestFromEmail: string;
  timezone: string;
  digestCron: string;
  stateDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
  digestEmailBlacklist: Set<string>;
  llmBaseUrl: string | null;
  llmApiKey: string | null;
  llmModel: string;
  llmTimeout: number;
  weatherLocation: string | null;
  weatherLatitude: string | null;
  weatherLongitude: string | null;
  f1Schedule: boolean;
  eventsEnabled: boolean;
  eventsDistrict: string | null;
}

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

function parseEmailList(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function loadConfig(): Config {
  return {
    todoistApiToken: required("TODOIST_API_TOKEN"),
    resendApiKey: required("RESEND_API_KEY"),
    digestFromEmail: required("DIGEST_FROM_EMAIL"),
    timezone: process.env["TIMEZONE"] ?? "Europe/Warsaw",
    digestCron: process.env["DIGEST_CRON"] ?? "0 6 * * 1",
    stateDir: process.env["STATE_DIR"] ?? "/data/state",
    logLevel: (process.env["LOG_LEVEL"] as Config["logLevel"]) ?? "info",
    digestEmailBlacklist: parseEmailList(process.env["DIGEST_EMAIL_BLACKLIST"]),
    llmBaseUrl: process.env["LLM_BASE_URL"] ?? null,
    llmApiKey: process.env["LLM_API_KEY"] ?? null,
    llmModel: process.env["LLM_MODEL"] ?? "nemotron-cascade-2",
    llmTimeout: parseInt(process.env["LLM_TIMEOUT"] ?? "120", 10) * 1000,
    weatherLocation: process.env["WEATHER_LOCATION"] ?? null,
    weatherLatitude: process.env["WEATHER_LATITUDE"] ?? null,
    weatherLongitude: process.env["WEATHER_LONGITUDE"] ?? null,
    f1Schedule: process.env["F1_SCHEDULE"]?.toLowerCase() === "true",
    eventsEnabled: process.env["EVENTS_ENABLED"]?.toLowerCase() === "true",
    eventsDistrict: process.env["EVENTS_DISTRICT"] ?? null,
  };
}
