export interface TodoistDue {
  date: string;
  timezone: string | null;
  string: string;
  lang: string;
  is_recurring: boolean;
}

export interface TodoistDuration {
  amount: number;
  unit: "minute" | "day";
}

export interface TodoistTask {
  id: string;
  content: string;
  description: string;
  projectId: string;
  priority: number;
  due: TodoistDue | null;
  duration: TodoistDuration | null;
  labels: string[];
  isCompleted: boolean;
  createdAt: string;
}

export interface TodoistProject {
  id: string;
  name: string;
}

export interface TodoistLabel {
  id: string;
  name: string;
}

export interface TodoistCollaborator {
  id: string;
  email: string;
  fullName: string;
  timezone: string;
}

export interface TodoistCollaboratorState {
  userId: string;
  projectId: string;
}

export interface SyncState {
  token: string;
}

export interface TodoistLocationReminder {
  id: string;
  item_id: string;
  name: string;
  loc_lat: string;
  loc_long: string;
  loc_trigger: string;
  radius: number;
  is_deleted: boolean;
}
