import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

// Without SMTP config, emails are logged instead of sent — handy for local development.
const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : nodemailer.createTransport({ jsonTransport: true });

export async function sendMail({ to, subject, text, html }) {
  const info = await transport.sendMail({ from: env.MAIL_FROM, to, subject, text, html });
  if (!env.SMTP_HOST) logger.info('Email (dev, not sent)', { to, subject });
  return info.messageId;
}
