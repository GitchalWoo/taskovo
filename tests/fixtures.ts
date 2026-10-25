import type { Config } from "../src/config";
import type { TodoistTask } from "../src/todoist/types";
import { spyOn } from "bun:test";

export function fetchMock(implementation: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>) {
  return spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(implementation, { preconnect: globalThis.fetch.preconnect }),
  );
}

export function config(overrides: Partial<Config> = {}): Config {
  return {
    todoistApiToken: "test-todoist-token",
    resendApiKey: "test-resend-key",
    digestFromEmail: "digest@example.com",
    timezone: "Europe/Warsaw",
    digestCron: "0 6 * * 1",
    stateDir: "/unused-test-state",
    logLevel: "error",
    digestEmailBlacklist: new Set(),
    llmBaseUrl: null,
    llmApiKey: null,
    llmModel: "test-model",
    llmTimeout: 1000,
    weatherLocation: null,
    weatherLatitude: null,
    weatherLongitude: null,
    f1Schedule: false,
    eventsEnabled: false,
    eventsDistrict: null,
    ...overrides,
  };
}

export function task(date: string, overrides: Partial<TodoistTask> = {}): TodoistTask {
  return {
    id: "task-1",
    content: "Example task",
    description: "",
    projectId: "project-1",
    priority: 1,
    due: { date, timezone: null, string: "", lang: "en", is_recurring: false },
    duration: null,
    labels: [],
    isCompleted: false,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function todoistSnapshot() {
  return {
    full_sync: true,
    sync_token: "unused-sync-token",
    items: [
      {
        id: "task-1",
        content: "Example task",
        project_id: "project-1",
        priority: 1,
        checked: false,
        due: { date: "2026-10-25", timezone: null, string: "", lang: "en", is_recurring: false },
      },
    ],
    projects: [{ id: "project-1", name: "Example project", child_order: 0, parent_id: null }],
    collaborators: [
      { id: "owner", email: "owner@example.com", full_name: "Example owner" },
      { id: "collaborator", email: "collaborator@example.com", full_name: "Example collaborator" },
    ],
    collaborator_states: [{ user_id: "collaborator", project_id: "project-1", is_deleted: false }],
    user: { id: "owner", lang: "en" },
  };
}
