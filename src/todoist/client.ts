import type { Config } from "../config";
import type { TodoistTask, TodoistProject, SyncState } from "./types";
import { logger } from "../utils/logger";

export interface TodoistData {
  tasks: TodoistTask[];
  projects: Map<string, string>; // id -> name
}

export async function fetchTodoistData(config: Config): Promise<TodoistData> {
  const syncToken = await loadSyncToken(config.stateDir);

  logger.info("Fetching data from Todoist Sync API", { syncToken: syncToken ? "incremental" : "full" });

  const response = await fetch("https://api.todoist.com/api/v1/sync", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.todoistApiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sync_token: syncToken ?? "*",
      resource_types: ["items", "projects"],
    }),
  });

  if (!response.ok) {
    throw new Error(`Todoist API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as Record<string, any>;

  // Save sync token for next run
  await saveSyncToken(config.stateDir, data.sync_token);

  const projects = new Map<string, string>();
  for (const project of data.projects ?? []) {
    projects.set(project.id, project.name);
  }

  const tasks: TodoistTask[] = (data.items ?? []).map((item: Record<string, unknown>) => ({
    id: item.id as string,
    content: item.content as string,
    description: (item.description as string) ?? "",
    projectId: item.project_id as string,
    priority: item.priority as number,
    due: item.due as TodoistTask["due"],
    labels: (item.labels as string[]) ?? [],
    isCompleted: (item.checked as boolean) ?? false,
    createdAt: item.added_at as string,
  }));

  logger.info("Fetched Todoist data", { taskCount: tasks.length, projectCount: projects.size });

  return { tasks, projects };
}

async function loadSyncToken(stateDir: string): Promise<string | null> {
  const path = `${stateDir}/sync-token.json`;
  try {
    const file = Bun.file(path);
    if (await file.exists()) {
      const state: SyncState = await file.json();
      return state.token;
    }
  } catch {
    logger.debug("No existing sync token found, will do full sync");
  }
  return null;
}

async function saveSyncToken(stateDir: string, token: string): Promise<void> {
  const path = `${stateDir}/sync-token.json`;
  try {
    await Bun.write(path, JSON.stringify({ token } satisfies SyncState, null, 2));
    logger.debug("Saved sync token");
  } catch (error) {
    logger.warn("Failed to save sync token", { error: String(error) });
  }
}
