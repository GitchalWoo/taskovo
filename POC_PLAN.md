# Taskovo POC — Weekly Digest

## Goal
Prove the core loop works: connect to Todoist, read tasks, produce a useful output, deliver it via email. No rule engine, no AI, no adapters — just the data pipeline end-to-end.

## Outcome
Every Sunday evening (or on manual trigger), Taskovo:
1. Fetches all tasks due in the upcoming week from Todoist
2. Groups them by day (Mon–Sun)
3. Formats a human-readable weekly digest
4. Sends it as an email via Resend

Example output:
```
Subject: Your week ahead — 31 Mar – 6 Apr

⚠ Overdue
  • Submit tax forms (was due 28 Mar) [p1]
  • Reply to landlord (was due 29 Mar)

Work
  • Submit quarterly report — Mon 31 Mar [p1]
  • Team standup — Tue 1 Apr, 09:00
  • Project deadline: Taskovo MVP — Fri 4 Apr [p1]

Health
  • Dentist appointment — Mon 31 Mar, 10:00

Personal
  • Pick up dry cleaning — Tue 1 Apr
  • Night out with friends — Thu 3 Apr, 19:00
  • Buy birthday gift for Mom — Fri 4 Apr
  • Grocery shopping — Sat 5 Apr
  • Meal prep — Sun 6 Apr
```

## Components to Build

### 1. Project Scaffold
- `bun init` with TypeScript
- Folder structure:
  ```
  src/
    index.ts              # Entry point — orchestrator
    todoist/
      client.ts           # Todoist Sync API client
      types.ts            # Task, Project, Label types
    digest/
      builder.ts          # Groups tasks by day, formats digest
    email/
      sender.ts           # Resend client wrapper
    config/
      index.ts            # Load .env, validate required vars
    utils/
      logger.ts           # Structured JSON logger to stdout
  config/
    .env.example          # Template for required env vars
  Dockerfile
  docker-compose.yml
  ```

### 2. Todoist Client (`src/todoist/client.ts`)
- Call Sync API: `POST /api/v1/sync` with `sync_token=*` and `resource_types=["items","projects","labels"]`
- Parse response: extract tasks, projects, labels
- Filter: tasks with due dates in the upcoming 7 days
- Store `sync_token` in a JSON file for future incremental sync (not needed for POC, but build the pattern)
- Auth: Bearer token from `TODOIST_API_TOKEN` env var
- Error handling: throw typed errors, caller decides what to do

### 3. Digest Builder (`src/digest/builder.ts`)
- Input: array of tasks (with due dates, project names, priorities)
- Group by project
- Within each project, sort by due date, then by time (if present), then priority
- Each task shows: title + due day + time (if set) + priority (if > p4/normal)
- Overdue section at the top: tasks due before today that aren't completed
- Format as plain text + HTML (for email)
- Handle edge cases:
  - Tasks with date but no time
  - Tasks with no project (use "Inbox")
  - Projects with no tasks due this week — omit entirely

### 4. Email Sender (`src/email/sender.ts`)
- Resend SDK: `new Resend(RESEND_API_KEY)`
- Send email with:
  - From: configurable (e.g., `taskovo@yourdomain.com`)
  - To: configurable (`DIGEST_RECIPIENT_EMAIL`)
  - Subject: `Your week ahead — {date range}`
  - Body: HTML version of the digest (with plain text fallback)
- Error handling: log failure, optionally create a Todoist task about the failure

### 5. Config (`src/config/index.ts`)
- Required env vars:
  - `TODOIST_API_TOKEN` — Todoist personal API token
  - `RESEND_API_KEY` — Resend API key
  - `DIGEST_RECIPIENT_EMAIL` — who gets the digest
  - `DIGEST_FROM_EMAIL` — sender address (must be verified in Resend)
- Optional:
  - `TIMEZONE` — default `Europe/Warsaw`
  - `DIGEST_CRON` — cron expression, default `0 19 * * 0` (Sunday 7pm)
  - `STATE_DIR` — path to JSON state files, default `/data/state`
  - `LOG_LEVEL` — `debug`, `info`, `warn`, `error`

### 6. Infrastructure
- **Dockerfile**: multi-stage, `oven/bun:1-alpine` for build + runtime
- **docker-compose.yml**: service + volume mount for state + `.env` file
- **State directory**: mounted volume at `/data/state/`, contains:
  - `sync-token.json` — `{ "token": "..." }`

### Security (Open Source Repo)
- **`.gitignore`**: must include `.env`, `state/`, `*.json` state files, `node_modules/`
- **`.env.example`**: committed with placeholder values only (`TODOIST_API_TOKEN=your_token_here`)
- **`.dockerignore`**: excludes `.env`, `.git/`, `state/`, `node_modules/`
- **Logger**: never logs env var values, API tokens, or email addresses
- **Config loader**: validates env vars exist at startup, logs only var names (not values)
- **Tests**: use mock/fixture data only — no real Todoist data, no real emails
- **No hardcoded strings**: all domains, emails, tokens come from env vars

### 7. Entry Point (`src/index.ts`)
Two modes:
- **`bun run src/index.ts`** — run once, send digest, exit (for testing / manual trigger)
- **`bun run src/index.ts --serve`** — start cron scheduler, run digest on schedule, stay alive

## Implementation Order

| Step | What | Proves | Status |
|------|------|--------|--------|
| 1 | Scaffold project, install deps, Dockerfile | Bun + Docker work together | ✅ Done |
| 2 | Config loader + logger | Env vars load, structured logging works | ✅ Done |
| 3 | Todoist client — fetch all tasks | API connection, auth, data parsing | ✅ Written, needs live test |
| 4 | Digest builder — group + format | Business logic, timezone handling | ✅ Written, needs live test |
| 5 | Email sender — send via Resend | Outbound email works | ✅ Written, needs live test |
| 6 | Wire it all in index.ts (run-once mode) | End-to-end pipeline | ✅ Written, needs live test |
| 7 | Add cron scheduler (--serve mode) | Long-running container mode | ✅ Written, needs live test |
| 8 | Docker build + compose up | Full containerized deployment | Not started |

### Progress Notes
- **Steps 1–7 scaffolded in one pass** — all source files created, typecheck passes (`bun x tsc --noEmit` clean)
- Code is written but **not tested against live APIs** — steps 3–7 need `.env` with real credentials and manual/integration testing
- Dependencies installed: `@doist/todoist-api-typescript`, `croner`, `resend`, `yaml`
- Todoist client uses raw Sync API (`fetch`) rather than the SDK — intentional to match the POC plan's sync approach
- Next: set up `.env` with real credentials, run one-shot mode, verify end-to-end pipeline, then Docker build

## Not In Scope (POC)
- Rule engine
- Local AI model
- Integration adapters
- Incremental sync (we do full sync each time — fine for weekly digest)
- Todoist write-back (no task creation/modification)
- Authentication flow (use personal API token directly)
- Multiple recipients
- Task processing state (@taskovo-processed labels)

## Success Criteria
1. `docker compose up` starts the container
2. On schedule (or manual trigger), it fetches tasks from Todoist
3. A well-formatted digest email arrives in the inbox
4. Logs show structured JSON output with timing and task counts
5. Container survives restarts (stateless enough for POC)

## Open Questions for POC
— All resolved, ready to build.
