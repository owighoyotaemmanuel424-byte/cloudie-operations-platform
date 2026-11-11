/**
 * Server-side email transport for Cloudie.
 *
 * Priority order:
 *   1. VLY integration gateway (VLY_INTEGRATION_KEY) — the platform's
 *      managed email provider, billed through the deployment token.
 *   2. SMTP via nodemailer (SMTP_HOST / SMTP_USER / SMTP_PASS / SMTP_PORT).
 *   3. Nothing configured — callers receive `{ ok: false, configured: false }`
 *      and must NOT pretend an email was delivered.
 *
 * This module is imported by the Hono backend (Node). It never reaches the
 * browser bundle and never logs secret values.
 */
import nodemailer from "nodemailer";

export type SendResult = {
  ok: boolean;
  configured: boolean;
  provider: string;
  error?: string;
};

export function emailConfigured(): boolean {
  if (process.env.VLY_INTEGRATION_KEY?.trim()) return true;
  if (process.env.SMTP_HOST?.trim()) return true;
  return false;
}

export async function sendEmail(input: {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
}): Promise<SendResult> {
  const recipients = Array.isArray(input.to) ? input.to : [input.to];
  const subject = input.subject;
  const html = input.html;
  const text = input.text ?? (html ? html.replace(/<[^>]+>/g, "") : "");

  // 1. VLY integration gateway.
  const vlyKey = process.env.VLY_INTEGRATION_KEY?.trim();
  if (vlyKey) {
    try {
      const mod = (await import("@vly-ai/integrations")) as any;
      const factory = mod.createVlyIntegrations ?? mod.default?.createVlyIntegrations;
      const vly = factory({ deploymentToken: vlyKey, debug: process.env.NODE_ENV !== "production" });
      const result = await vly.email.send({ to: recipients, subject, html, text });
      if (result?.success) return { ok: true, configured: true, provider: "vly" };
      return { ok: false, configured: true, provider: "vly", error: result?.error || "VLY email send failed" };
    } catch (error) {
      return { ok: false, configured: true, provider: "vly", error: error instanceof Error ? error.message : "VLY email error" };
    }
  }

  // 2. SMTP via nodemailer.
  const smtpHost = process.env.SMTP_HOST?.trim();
  if (smtpHost) {
    try {
      const port = Number(process.env.SMTP_PORT ?? 587);
      const secure = process.env.SMTP_SECURE === "true" || port === 465;
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port,
        secure,
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
          : undefined,
      });
      await transporter.sendMail({
        from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "noreply@cloudie.africa",
        to: recipients.join(", "),
        subject,
        text,
        html,
      });
      return { ok: true, configured: true, provider: "smtp" };
    } catch (error) {
      return { ok: false, configured: true, provider: "smtp", error: error instanceof Error ? error.message : "SMTP send failed" };
    }
  }

  return { ok: false, configured: false, provider: "none", error: "No email transport configured" };
}

export async function sendEmailBatch(
  messages: { to: string; subject: string; html?: string; text?: string }[],
): Promise<{ sent: number; failed: number; errors: string[] }> {
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  // Send sequentially to stay within provider rate limits; recipients are deduped upstream.
  for (const message of messages) {
    const result = await sendEmail({ to: message.to, subject: message.subject, html: message.html, text: message.text });
    if (result.ok) sent += 1;
    else {
      failed += 1;
      if (result.error) errors.push(result.error);
    }
  }
  return { sent, failed, errors };
}
