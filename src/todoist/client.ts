import type { Config } from "../config";
import type {
  TodoistTask,
  TodoistLocationReminder,
  TodoistCollaborator,
  TodoistCollaboratorState,
  SyncState,
} from "./types";
import { logger } from "../utils/logger";

export interface ProjectInfo {
  name: string;
  order: number;
  parentId: string | null;
}

export interface TodoistData {
  tasks: TodoistTask[];
  projects: Map<string, ProjectInfo>; // id -> project info
  locations: Map<string, string>; // item_id -> location name
  collaborators: TodoistCollaborator[];
  collaboratorStates: TodoistCollaboratorState[];
  ownerId: string; // the authenticated user's id
  ownerLang: string; // the authenticated user's Todoist interface language (e.g. "pl", "en")
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
      resource_types: ["items", "projects", "collaborators", "collaborator_states", "user"],
    }),
  });

  if (!response.ok) {
    throw new Error(`Todoist API error: ${response.status} ${response.statusText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw Todoist Sync API response shape
  const data = (await response.json()) as Record<string, any>;

  // Save sync token for next run
  await saveSyncToken(config.stateDir, data.sync_token);

  const projects = new Map<string, ProjectInfo>();
  for (const project of data.projects ?? []) {
    projects.set(project.id, {
      name: project.name,
      order: project.child_order ?? 0,
      parentId: project.parent_id ?? null,
    });
  }

  const tasks: TodoistTask[] = (data.items ?? []).map((item: Record<string, unknown>) => ({
    id: item.id as string,
    content: item.content as string,
    description: (item.description as string) ?? "",
    projectId: item.project_id as string,
    priority: item.priority as number,
    due: item.due as TodoistTask["due"],
    duration: (item.duration as TodoistTask["duration"]) ?? null,
    labels: (item.labels as string[]) ?? [],
    isCompleted: (item.checked as boolean) ?? false,
    createdAt: item.added_at as string,
  }));

  logger.info("Fetched Todoist data", { taskCount: tasks.length, projectCount: projects.size });

  const locations = await fetchLocationReminders(config.todoistApiToken);

  const collaborators: TodoistCollaborator[] = (data.collaborators ?? []).map(
    (c: Record<string, unknown>) => ({
      id: c.id as string,
      email: c.email as string,
      fullName: c.full_name as string,
      timezone: (c.timezone as string) ?? "UTC",
    }),
  );

  const collaboratorStates: TodoistCollaboratorState[] = (data.collaborator_states ?? [])
    .filter((cs: Record<string, unknown>) => !cs.is_deleted)
    .map((cs: Record<string, unknown>) => ({
      userId: cs.user_id as string,
      projectId: cs.project_id as string,
    }));

  const ownerId = (data.user?.id as string) ?? "";
  const ownerLang = (data.user?.lang as string) ?? "en";

  logger.info("Fetched collaborators", {
    count: collaborators.length,
    stateCount: collaboratorStates.length,
  });

  return { tasks, projects, locations, collaborators, collaboratorStates, ownerId, ownerLang };
}

async function fetchLocationReminders(token: string): Promise<Map<string, string>> {
  const locations = new Map<string, string>();
  try {
    const response = await fetch("https://api.todoist.com/api/v1/location_reminders", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      logger.warn("Failed to fetch location reminders", { status: response.status });
      return locations;
    }
    const data = (await response.json()) as { results: TodoistLocationReminder[] };
    for (const loc of data.results) {
      if (!loc.is_deleted) {
        locations.set(loc.item_id, loc.name);
      }
    }
  } catch (error) {
    logger.warn("Failed to fetch location reminders", { error: String(error) });
  }
  return locations;
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
