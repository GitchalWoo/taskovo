export interface TodoistDue {
  date: string;
  timezone: string | null;
  string: string;
  lang: string;
  isRecurring: boolean;
  datetime?: string;
}

export interface TodoistTask {
  id: string;
  content: string;
  description: string;
  projectId: string;
  priority: number;
  due: TodoistDue | null;
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

export interface SyncState {
  token: string;
}
