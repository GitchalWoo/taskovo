import { Resend } from "resend";
import type { Config } from "../config";
import type { DigestOutput } from "../digest/builder";
import { logger } from "../utils/logger";

export async function sendDigestEmail(
  config: Config,
  digest: DigestOutput,
  recipientEmail: string,
): Promise<void> {
  const resend = new Resend(config.resendApiKey);

  logger.info("Sending digest email", { to: "[redacted]" });

  const { error } = await resend.emails.send({
    from: config.digestFromEmail,
    to: recipientEmail,
    subject: digest.subject,
    html: digest.html,
    text: digest.text,
  });

  if (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }

  logger.info("Digest email sent successfully");
}
