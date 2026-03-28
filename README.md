# Taskovo

Taskovo is a personal automation system built around Todoist. It reads your tasks, groups them by project, and sends a personalised weekly digest to each project collaborator via email.

Each person receives only tasks from projects they have access to. The account owner gets a full digest across all projects (shared and private). Collaborators get only their shared projects.

It runs as a single container on any Linux box. No database, no cloud dependencies beyond Todoist and Resend for email delivery. Configuration lives in env vars. The whole thing fits in under 200MB of RAM.

The longer-term goal is a local rule engine that reacts to task changes, classifies incoming items with a small on-device AI model, and pulls data from external services into Todoist automatically. For now, it sends a personalised weekly email to everyone on your shared projects.

## Usage

```bash
bun install
```

Copy `.env.example` to `.env` and fill in your API keys.

```bash
# Preview all per-person digests in terminal
bun run src/index.ts --dry-run

# Send digest emails to all collaborators
bun run src/index.ts

# Run on a schedule (cron mode)
bun run src/index.ts --serve
```

## How recipients are determined

Recipients are auto-discovered from the Todoist Sync API:

1. All project **collaborators** and their emails are fetched via `collaborators` + `collaborator_states` resource types
2. Each collaborator receives tasks from projects they belong to
3. The account owner receives all tasks (shared + private projects)
4. To exclude someone, add their email to `DIGEST_EMAIL_BLACKLIST` in `.env`

## Configuration

| Variable                 | Required | Description                                       |
| ------------------------ | -------- | ------------------------------------------------- |
| `TODOIST_API_TOKEN`      | Yes      | Todoist API token                                 |
| `RESEND_API_KEY`         | Yes      | Resend email API key                              |
| `DIGEST_FROM_EMAIL`      | Yes      | Sender email address                              |
| `DIGEST_EMAIL_BLACKLIST` | No       | Comma-separated emails to skip                    |
| `TIMEZONE`               | No       | Default: `Europe/Warsaw`                          |
| `DIGEST_CRON`            | No       | Cron schedule, default: `0 19 * * 0` (Sunday 7pm) |
| `STATE_DIR`              | No       | Sync token storage, default: `/data/state`        |
| `LOG_LEVEL`              | No       | `debug` / `info` / `warn` / `error`               |

## License

MIT
