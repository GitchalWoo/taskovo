import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";
import type { Config } from "../config";
import type { DigestOutput } from "../digest/builder";
import { logger } from "../utils/logger";
import { HttpError, TransportError, withRequestRetry } from "../utils/http";
import type { DigestWindow } from "../utils/dates";

interface DeliveryState {
  createdAt: number;
  sent: boolean;
  audience: string;
  digest: DigestOutput;
}

function parseDeliveryState(value: unknown): DeliveryState {
  if (
    typeof value !== "object" ||
    value === null ||
    !("createdAt" in value) ||
    typeof value.createdAt !== "number" ||
    !Number.isFinite(value.createdAt) ||
    !("sent" in value) ||
    typeof value.sent !== "boolean" ||
    !("audience" in value) ||
    typeof value.audience !== "string" ||
    !("digest" in value) ||
    typeof value.digest !== "object" ||
    value.digest === null ||
    !("subject" in value.digest) ||
    typeof value.digest.subject !== "string" ||
    !("text" in value.digest) ||
    typeof value.digest.text !== "string" ||
    !("html" in value.digest) ||
    typeof value.digest.html !== "string"
  ) {
    throw new Error("Invalid delivery state; reconcile it before retrying");
  }
  return {
    createdAt: value.createdAt,
    sent: value.sent,
    audience: value.audience,
    digest: { subject: value.digest.subject, text: value.digest.text, html: value.digest.html },
  };
}

async function saveDeliveryState(file: string, state: DeliveryState): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function sendDigestEmail(
  config: Config,
  digest: DigestOutput,
  recipientEmail: string,
  window: DigestWindow,
  audience = "",
): Promise<"sent" | "skipped"> {
  const to = recipientEmail.trim().toLowerCase();
  const key = createHash("sha256")
    .update(JSON.stringify([config.digestFromEmail, to, config.timezone, window.start, window.end]))
    .digest("hex");
  const directory = path.join(config.stateDir, "deliveries");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${key}.json`);
  const existing = Bun.file(file);
  const state: DeliveryState = (await existing.exists())
    ? parseDeliveryState(await existing.json())
    : { createdAt: Date.now(), sent: false, digest, audience };

  if (state.sent) {
    logger.info("Skipping previously delivered digest", { deliveryId: key });
    return "skipped";
  }
  if (state.audience !== audience) {
    throw new Error(
      `Project membership changed for delivery ${key}; reconcile it before retrying cached content`,
    );
  }
  // Leave headroom below Resend's 24-hour idempotency retention.
  if (Date.now() - state.createdAt >= 23 * 60 * 60 * 1000) {
    throw new Error(`Unconfirmed delivery ${key} is too old to retry safely; reconcile it in Resend`);
  }
  await saveDeliveryState(file, state);

  logger.info("Sending digest email", { deliveryId: key });

  const resend = new Resend(config.resendApiKey);
  const result = await withRequestRetry(async (signal) => {
    const { data, error, headers } = await resend.emails.send(
      {
        from: config.digestFromEmail,
        to: [to],
        ...state.digest,
      },
      { signal, idempotencyKey: `digest/${key}` },
    );
    if (error) {
      if (typeof error.statusCode === "number") {
        throw new HttpError(error.statusCode, "Resend", new Headers(headers ?? {}).get("retry-after"));
      }
      if (error.name === "application_error") {
        throw new TransportError("Resend transport failed");
      }
      throw new Error(`Resend rejected the email: ${error.name}`);
    }
    return data;
  }, "Resend");
  if (
    typeof result !== "object" ||
    result === null ||
    !("id" in result) ||
    typeof result.id !== "string" ||
    !result.id
  ) {
    throw new Error("Resend returned an invalid delivery confirmation");
  }
  await saveDeliveryState(file, { ...state, sent: true });
  logger.info("Digest email sent successfully", { deliveryId: key });
  return "sent";
}
