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
For local email delivery, also set `STATE_DIR=./state` to a writable directory.
Containers use the persistent `/data/state` volume by default.

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

| Variable                 | Required | Description                                                      |
| ------------------------ | -------- | ---------------------------------------------------------------- |
| `TODOIST_API_TOKEN`      | Yes      | Todoist API token                                                |
| `RESEND_API_KEY`         | Yes      | Resend email API key                                             |
| `DIGEST_FROM_EMAIL`      | Yes      | Sender email address                                             |
| `DIGEST_EMAIL_BLACKLIST` | No       | Comma-separated emails to skip                                   |
| `TIMEZONE`               | No       | IANA timezone for scheduling and dates; default: `Europe/Warsaw` |
| `DIGEST_CRON`            | No       | Cron schedule in `TIMEZONE`, default: `0 6 * * 1` (Monday 6am)   |
| `STATE_DIR`              | No       | Persistent delivery records; default: `/data/state`              |
| `LOG_LEVEL`              | No       | `debug` / `info` / `warn` / `error`                              |
| `LLM_BASE_URL`           | No       | OpenAI-compatible endpoint for AI week summary                   |
| `LLM_API_KEY`            | No       | API key for the LLM endpoint                                     |
| `LLM_MODEL`              | No       | Model name, default: `nemotron-cascade-2`                        |
| `LLM_TIMEOUT`            | No       | LLM timeout in seconds, default: `120`                           |
| `WEATHER_LOCATION`       | No       | City name for 7-day forecast (e.g. `Warsaw`)                     |
| `WEATHER_LATITUDE`       | No       | Explicit latitude (overrides `WEATHER_LOCATION`)                 |
| `WEATHER_LONGITUDE`      | No       | Explicit longitude (overrides `WEATHER_LOCATION`)                |
| `F1_SCHEDULE`            | No       | Set `true` to include F1 race schedule                           |
| `EVENTS_ENABLED`         | No       | Set `true` to include local events from waw4free                 |
| `EVENTS_DISTRICT`        | No       | waw4free district filter (e.g. `pragapld`)                       |

## Dates and reliable delivery

Email delivery uses the current Resend SDK with cancellation, error status codes, and response headers feeding the same bounded retry policy as Todoist. Set `NODE_ENV=production` to suppress the SDK's raw development error logging; this is already configured in the container, workflow, and example environment.

- Each run fetches a full Todoist snapshot. A sync cursor alone cannot reconstruct unchanged tasks or collaborators, so old `sync-token.json` files are ignored and may be removed.
- The digest covers **today plus the next six calendar days** in `TIMEZONE`, with overdue tasks listed separately. Email tasks, AI inputs, weather, F1 selection, and local events share this window. Date-only deadlines stay on their original calendar date; timed tasks and F1 sessions are displayed in `TIMEZONE`.
- Serve mode schedules in `TIMEZONE`, including daylight-saving changes, and prevents overlapping cron callbacks. The GitHub Actions schedule is still Monday at 06:00 **UTC**, independent of `DIGEST_CRON`.
- Todoist and Resend requests use a 15-second timeout per attempt and at most three attempts for network failures, HTTP 429, and HTTP 5xx. `Retry-After` is honored up to 30 seconds; longer waits fail explicitly for a later rerun.
- A recipient failure does not stop other recipients. The final log reports sent, skipped, and failed counts; incomplete one-shot runs exit unsuccessfully.
- Delivery identity is the sender, normalized recipient, timezone, and date window. A rerun on the same local date skips confirmed deliveries. A new local date starts a new window and is a new digest.
- Before sending, the original rendered email is saved under `STATE_DIR/deliveries/`. Pending retries reuse that payload and the same Resend idempotency key, even if task data or the AI summary changes. Confirmed deliveries remain skipped across restarts while state is retained.
- If a pending recipient's project membership changes, cached-content delivery is blocked for reconciliation rather than risk sending tasks they can no longer access.
- Resend retains idempotency keys for 24 hours. Unconfirmed local records older than 23 hours are blocked to leave a safety margin. Reconcile the delivery in Resend before changing its state: if confirmed, set its `sent` field to `true`; remove a pending record only after establishing that the email was not delivered. The logged delivery ID identifies the JSON filename.
- Keep `STATE_DIR` private and persistent: it contains rendered task data, not API credentials. Delivery files are owner-readable/writable only. Losing state loses the durable duplicate-send protection; do not publish these files as Actions artifacts or caches.

The bundled GitHub Actions workflow uses temporary state, so it has **no cross-run local delivery history**. Within Resend's 24-hour window, the stable key prevents duplicate sends, but changed email content on a fresh runner can produce an idempotency conflict that requires reconciliation. After key expiry, a fresh runner can send again. Use the container with its persistent volume when durable rerun guarantees are required.

## Development checks

```bash
bun test
bun run check
bun run audit
```

Regression tests mock external services; they do not send email or require real API credentials.
The audit checks the locked runtime and development dependency tree against published advisories. It is a version-based check, not proof that every vulnerable code path is reachable or that no undisclosed vulnerabilities exist. Dependency updates should preserve compatible major versions unless separately tested.

## Digest providers

The digest email is composed from independent, optional data sources. Each degrades gracefully — if disabled or failing, the digest sends without that section.

| Provider         | Source                | Gated by              | API key needed |
| ---------------- | --------------------- | --------------------- | -------------- |
| AI week summary  | Any OpenAI-compatible | `LLM_BASE_URL`        | Optional       |
| Weather forecast | Open-Meteo            | `WEATHER_LOCATION`    | No             |
| F1 schedule      | Jolpica (Ergast)      | `F1_SCHEDULE=true`    | No             |
| Local events     | waw4free.pl (scraper) | `EVENTS_ENABLED=true` | No             |

## License

MIT
