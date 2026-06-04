import nodemailer from "nodemailer";

let transporter: nodemailer.Transporter | null = null;

function getTransport() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: Number(process.env.SMTP_PORT ?? 465) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

export async function sendMail(to: string, subject: string, html: string) {
  const tx = getTransport();
  if (!tx) {
    console.warn("[email] SMTP not configured, skipping:", subject, "→", to);
    return { skipped: true };
  }
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER!;
  const info = await tx.sendMail({ from, to, subject, html });
  return { skipped: false, messageId: info.messageId };
}
