# Taskovo

Taskovo is a personal automation system built around Todoist. It reads your tasks, groups them by project, and sends you a clean weekly digest over email so you know what's coming without opening the app.

It runs as a single container on any Linux box. No database, no cloud dependencies beyond Todoist and Resend for email delivery. Configuration lives in env vars and a couple of YAML files. The whole thing fits in under 200MB of RAM.

The longer-term goal is a local rule engine that reacts to task changes, classifies incoming items with a small on-device AI model, and pulls data from external services into Todoist automatically. For now, it just sends a really good weekly email.

## Usage

```bash
bun install
```

Copy `.env.example` to `.env` and fill in your API keys.

```bash
# Preview digest in terminal
bun run src/index.ts --dry-run

# Send digest email
bun run src/index.ts

# Run on a schedule (cron mode)
bun run src/index.ts --serve
```
