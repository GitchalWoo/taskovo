# Taskovo — Life Automation System

## Copilot Rules
- **Never create memory files.** This file (`.github/copilot-instructions.md`) is the only context — update it directly.
- **Always update this file** when non-obvious changes happen (API quirks discovered, workarounds, architectural decisions, gotchas).
- **Always update this file after implementation changes** — remove outdated information, add new decisions, and ensure context reflects the current state of the codebase.
- **Never store trivial information in context** — no file structures, no technology names deducible from `package.json`/`tsconfig.json`, no repetition of config values. Store only the *why* behind decisions, not the *what* that's already in the code.

## Vision
Taskovo is a personal life automation tooling system. It orchestrates tasks, notifications, and decision-making by combining external SaaS integrations with a local embedded AI model. The system is designed to run containerized on any Linux device or Docker-based automation platform.

Todoist serves as both the primary data source AND the persistence/state layer. Think of it as a "processing inbox" — tasks flow in (manually, from integrations, from cron rules), and Taskovo's rule engine picks them up, processes them, and produces outputs (new tasks, notifications, label changes, completions).

## Core Architecture

### Data Source & State: Todoist (Polling)
- Primary knowledge base, task source, AND persistence layer
- **Todoist API v1** (`api.todoist.com/api/v1/`) — unified Sync + REST API
- Sync endpoint (`POST /api/v1/sync`) for efficient reads (single call returns all data) and batched writes
- Incremental sync via `sync_token` — first call with `*`, subsequent calls get only changes
- Writes batched via Sync commands (up to 100 commands per request), with UUID-based idempotency
- REST endpoints for individual CRUD operations when batching isn't needed
- **Rate limits**: 1000 partial syncs / 15min, 100 full syncs / 15min — 60s polling uses ~15 requests/15min, well within limits
- Polling interval configurable (default: every 60s)
- **SDKs available**: Official Python SDK, Official TypeScript SDK
- State tracking: use Todoist labels/comments to mark processed items (e.g., label `@taskovo-processed`)
- Labels are plain strings on tasks (e.g., `labels: ["Food", "Shopping"]`)
- Todoist is also the error sink — if something fails, create a task about it
- Sync token stored in local JSON file for incremental sync across restarts
- API auth: Bearer token via Authorization header

### Notifications: Resend
- Outbound communication to other participants via Resend SaaS (email-based notifications)
- Used to notify people about events, task assignments, reminders, escalations
- Templates for different notification types

### Rule Engine
- Locally configured rule engine with multiple rulesets
- Rules defined in local config files (YAML)
- Each ruleset targets tasks via flexible filters: project, label (present OR absent), content, due date, priority, or any combination
- A rule can match "all tasks without any label" (inbox processing) or "tasks with label X in project Y" — the filter is the rule's concern
- Two trigger types:
  - **Reactive rules**: fire when a matching task is detected (new, changed, or matching criteria)
  - **Cron rules**: fire on schedule (e.g., "every Monday at 9am")
- Actions: create tasks, modify tasks, send notifications, invoke AI, add labels/comments
- No stateful workflows (use n8n for complex orchestration)
- Rules are composable: a rule's output (e.g., a new task) can be input for another rule
- Rule AI mode:
  - **Explicit rules**: pure condition → action, no AI involved
  - **Implicit AI rules**: AI pre-processes tasks (classify, extract, label) before other rules evaluate
  - Both coexist — implicit AI runs as a first pass, then explicit rules fire on enriched data

### Rule Engine — Use Cases
1. **Birthday prep**: Task contains "birthday" → create new task dated 14 days before: "Buy gift for {person}"
2. **External integration ingest**: Finax API returns overdue invoice → create high-priority task in Todoist
3. **Cross-project triggers**: Task created in "Project-X/Triggers" project → picked up by automation ruleset
4. **Inbox processing**: Uncategorized tasks in inbox → AI classifies → moves to correct project/adds labels
5. **Cron reminders**: "Every Monday → create task: review weekly goals"
6. **Notification rules**: Task with label `@notify-wife` due today → send email via Resend
7. **Weekly digest**: Cron rule (e.g., Sunday evening) → gather all tasks due this week → AI summarizes → send email digest ("Night out on Friday, dentist Tuesday, project deadline Wednesday")

### Embedded Local AI Model
- Local inference via llama.cpp (HTTP server mode) — lightest overhead
- Super-small model: DeepSeek R1 1.5B quantized (Q4_K_M, ~1GB RAM)
- Configurable: user can opt into larger models if hardware allows
- Used for SIMPLE tasks only:
  - Task classification (personal/work/urgent/category)
  - Short text generation (notification drafts, task descriptions)
  - Label suggestion based on task content
  - Simple extraction (extract date, person name, amount from task text)
- NOT used for: complex reasoning, long-context summarization, multi-step planning
- Fallback: rules work without AI — AI enriches but is not required

### External Integration Adapters
- Each integration is a YAML-configured polling adapter
- Adapters are declarative: define endpoint, auth, polling schedule, and a mapping of response → Todoist task
- Adapters run on their own cron schedule, independent of the Todoist polling loop
- Output is always Todoist tasks (adapters are "task producers")
- Adapter config includes deduplication key (to avoid creating duplicate tasks on re-poll)
- Adapter state (last poll timestamp, seen IDs) stored in a JSON file (mounted volume)
- Built-in adapters: HTTP/REST generic adapter (covers most APIs)
- Custom adapters: user can write a small script/plugin for complex response parsing
- Example — Finax adapter:
  ```yaml
  adapters:
    - name: finax-overdue
      type: http
      schedule: "0 9 * * *"  # daily at 9am
      request:
        url: "https://api.finax.com/invoices?status=overdue"
        method: GET
        headers:
          Authorization: "Bearer {{env.FINAX_API_KEY}}"
      mapping:
        foreach: "$.invoices"
        task:
          content: "Overdue invoice: {{item.client}} — {{item.amount}} PLN"
          project: "Finance"
          priority: 4
          labels: ["@finax", "@overdue"]
          due: today
      dedup_key: "{{item.invoice_id}}"
  ```

## Tech Stack
- **Language**: TypeScript
- **Runtime**: Bun (native TS, fast startup, built-in test runner, built-in .env support)
- **Container**: Docker, multi-stage — `oven/bun:1-alpine` for build, slim for runtime
- **AI Runtime**: llama.cpp server (lightweight, C++ binary, GGUF models)
- **Config format**: YAML for rules and adapters, .env for secrets
- **Secrets**: `.env` file (Todoist API token, Resend API key, etc.) — loaded natively by Bun
- **Local state**: JSON files only (no databases) — sync cursors, cron timestamps, adapter dedup state
- **State storage**: Docker volume mount (e.g., `/data/state/`)
- **Logging**: stdout (structured JSON, suitable for `docker logs`)
- **Testing**: `bun test` (built-in, Jest-compatible)
- **Deployment**: Any Linux device, Docker-based automation platforms
- **Hardware target**: 8GB RAM max (model + app + OS must fit)
- **Key dependencies**: `@doist/todoist-api-typescript` (official SDK), `resend` (official SDK), `yaml` (YAML parsing), `croner` (cron scheduling)

## Key Design Principles
- **OPEN SOURCE REPO — all code is public. Zero secrets in code, config files, logs, or commit history.**
- Container-first: everything runs in Docker
- Privacy-first: local AI model, no data leaves the device unless explicitly configured
- Todoist-as-primary-state: Todoist labels/comments track processing state; local JSON files only for cursors/dedup
- No databases: zero SQL, zero embedded DB — only JSON files for minimal local state
- Simple configuration: rules in YAML files, secrets in .env
- Graceful degradation: AI is optional enrichment, rules work without it
- Error-to-Todoist: failures create tasks so you see them in your normal workflow
- Lightweight: must run on 8GB RAM including the AI model
- Extensible: new integrations = new polling adapters that produce tasks

## Security Requirements (Open Source)
- **`.env` is in `.gitignore` — NEVER committed**. Only `.env.example` with placeholder values.
- **No secrets in code**: API tokens, emails, domain names — all via env vars
- **No secrets in logs**: logger must redact/mask any token or key that appears in output
- **No secrets in Docker image**: multi-stage build, `.dockerignore` excludes `.env`, `state/`, `node_modules/`
- **No personal data in repo**: no real email addresses, task content, or Todoist data in tests or examples
- **State files excluded**: `/data/state/` is a runtime volume, never in the repo
- **Git hooks**: consider pre-commit hook to scan for accidental secret patterns
- **Config validation**: fail fast at startup if required env vars are missing (don't log the values)

## Language Decision (Decided: TypeScript + Bun)

Chose TypeScript/Bun for:
- Official SDKs for both Todoist and Resend
- Native TypeScript execution (no build step for dev)
- Type safety for rule engine validation
- Built-in test runner, .env loading, file I/O utilities
- Alpine-based container ~100MB (lighter than Node.js)
- Strong developer familiarity (JS is second strongest language)

## Processing Flow

```
[Polling Loop]
    │
    ├── Todoist Sync API → fetch changes
    │
    ├── [Rule Engine]
    │     ├── Match tasks against reactive rules
    │     ├── Execute cron rules on schedule
    │     │
    │     ├── Actions:
    │     │   ├── Create/modify/complete Todoist tasks
    │     │   ├── Send notification via Resend
    │     │   ├── Invoke local AI for classification/generation
    │     │   └── Add labels/comments to tasks
    │     │
    │     └── Mark processed tasks (label @taskovo-processed)
    │
    ├── [Integration Adapters] (future)
    │     ├── Finax poller → creates tasks
    │     └── Other API pollers → create tasks
    │
    └── [Error Handler]
          └── Create Todoist task with error details
```

## Development Notes (Non-Obvious)

### Environment
- Bun PATH requires `$HOME/.bun/bin`
- Container runtime is **podman** (not docker), use `podman-compose`
- Dockerfile needs fully-qualified image refs (`docker.io/oven/bun:1-alpine`) for podman
- `/data/state` must be `chown bun:bun` before `USER bun` in Dockerfile
- `/data/state` ENOENT warning is expected locally — path only exists in container

### Todoist API Quirks
- Uses raw fetch against Sync API v1, not the SDK
- `due.date` field contains time when present (has "T" in string) — there's no separate `datetime` field in V1
- `is_recurring` is snake_case (matching raw API), not camelCase
- `priority` values: 4=p1(highest), 3=p2, 2=p3, 1=normal
- `child_order` on projects gives sidebar sort order; `parent_id` for nesting
- Location reminders: Sync `reminders_location` returns undefined; use REST `GET /api/v1/location_reminders` instead — returns `{ results: [...] }` with `item_id` linking to tasks
- `duration` field: `{ amount, unit: "minute" | "day" }`, nullable
- Sync `user` resource type returns the **raw API token** in the response — never log or persist the `user` object in production

### Todoist Collaborators & Per-Person Digests
- Sync resource types `collaborators` + `collaborator_states` return all people across all shared projects in one call
- `collaborators` returns: `{ id, email, full_name, timezone }` — emails ARE available
- `collaborator_states` maps `user_id` → `project_id` (with `is_deleted`, `state` fields)
- REST alternative: `GET /api/v1/projects/{id}/collaborators` returns `{ results: [{ id, name, email }] }` per project
- Digest recipients are auto-discovered from collaborators — no hardcoded recipient email
- Owner (authenticated user) gets all tasks; other collaborators get only tasks from their shared projects
- `DIGEST_EMAIL_BLACKLIST` env var: comma-separated emails to exclude from receiving digests
- Tasks have `responsible_uid` and `assigned_by_uid` fields linking to collaborator IDs — not used for digest filtering (project membership is the filter), but available for future assignment-based rules
