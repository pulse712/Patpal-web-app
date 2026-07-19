// Server-only email utility using Resend.
// Never import this from client code.
// Usage: const { sendEmail } = await import("@/lib/email.server");

import { Resend } from "resend";

const FROM = "Pat My Back <noreply@patmyback.com>";
const APP_URL = process.env.APP_URL ?? "https://patmyback.com";

function getResend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Missing RESEND_API_KEY environment variable.");
  return new Resend(key);
}

// ─── Low-level send ──────────────────────────────────────────────────────────
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}) {
  const key = process.env.RESEND_API_KEY;
  if (!key || key.includes("YOUR_")) {
    console.warn("[Email] RESEND_API_KEY not set — skipping email to:", opts.to);
    return;
  }
  const resend = getResend();
  const { error } = await resend.emails.send({ from: FROM, ...opts });
  if (error) console.error("[Email] Send error:", error);
}

// ─── Shared layout ───────────────────────────────────────────────────────────
function layout(body: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pat My Back</title>
</head>
<body style="margin:0;padding:0;background:#f4f7f6;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#0EA5A0;padding:28px 32px;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">
              Pat My Back 🤝
            </h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            ${body}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
              Pat My Back · <a href="${APP_URL}" style="color:#0EA5A0;text-decoration:none;">${APP_URL.replace("https://", "")}</a><br/>
              You're receiving this because you have an account with us.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Helper: teal button ──────────────────────────────────────────────────────
function btn(text: string, href: string) {
  return `<a href="${href}" style="display:inline-block;margin-top:20px;padding:12px 28px;background:#0EA5A0;color:#ffffff;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;">${text}</a>`;
}

// ─── Template: Payment / credit receipt ──────────────────────────────────────
export async function sendPaymentReceipt(opts: {
  to: string;
  name: string;
  amountDollars: string; // e.g. "10.00"
  minutes: number;
  newBalanceMinutes: number;
  receiptUrl?: string;
  date: string;
}) {
  const html = layout(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#111827;">Payment confirmed ✅</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hi ${opts.name}, your payment was successful.</p>

    <table width="100%" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;">Amount paid</td>
        <td style="padding:12px 16px;font-size:15px;font-weight:700;color:#111827;text-align:right;">$${opts.amountDollars}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;border-top:1px solid #e5e7eb;">Minutes added</td>
        <td style="padding:12px 16px;font-size:15px;font-weight:700;color:#0EA5A0;text-align:right;">+${opts.minutes} min</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;border-top:1px solid #e5e7eb;">New balance</td>
        <td style="padding:12px 16px;font-size:15px;font-weight:700;color:#111827;text-align:right;">${opts.newBalanceMinutes} min</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;border-top:1px solid #e5e7eb;">Date</td>
        <td style="padding:12px 16px;font-size:14px;color:#374151;text-align:right;">${opts.date}</td>
      </tr>
    </table>

    ${opts.receiptUrl ? btn("View receipt", opts.receiptUrl) : btn("Go to wallet", `${APP_URL}/wallet`)}
  `);

  await sendEmail({ to: opts.to, subject: "Your Pat My Back payment receipt", html });
}

// ─── Template: Session summary ────────────────────────────────────────────────
export async function sendSessionSummary(opts: {
  to: string;
  name: string;
  palName: string;
  kind: string; // "audio" | "video" | "chat"
  durationMinutes: number;
  costDollars: string;
  remainingMinutes: number;
  date: string;
}) {
  const kindLabel = opts.kind === "video" ? "Video call" : opts.kind === "audio" ? "Audio call" : "Chat session";

  const html = layout(`
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#111827;">Session complete 🎉</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hi ${opts.name}, here's a summary of your recent session.</p>

    <table width="100%" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;">Session type</td>
        <td style="padding:12px 16px;font-size:14px;font-weight:600;color:#111827;text-align:right;">${kindLabel}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;border-top:1px solid #e5e7eb;">Pat Pal</td>
        <td style="padding:12px 16px;font-size:14px;font-weight:600;color:#111827;text-align:right;">${opts.palName}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;border-top:1px solid #e5e7eb;">Duration</td>
        <td style="padding:12px 16px;font-size:15px;font-weight:700;color:#0EA5A0;text-align:right;">${opts.durationMinutes} min</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;border-top:1px solid #e5e7eb;">Cost</td>
        <td style="padding:12px 16px;font-size:15px;font-weight:700;color:#111827;text-align:right;">$${opts.costDollars}</td>
      </tr>
      <tr style="background:#f9fafb;">
        <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;border-top:1px solid #e5e7eb;">Remaining balance</td>
        <td style="padding:12px 16px;font-size:14px;color:#374151;text-align:right;">${opts.remainingMinutes} min</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;border-top:1px solid #e5e7eb;">Date</td>
        <td style="padding:12px 16px;font-size:14px;color:#374151;text-align:right;">${opts.date}</td>
      </tr>
    </table>

    ${btn("Book another session", `${APP_URL}/browse`)}

    <p style="margin-top:24px;font-size:13px;color:#9ca3af;">
      Need help? Reply to this email or visit our <a href="${APP_URL}" style="color:#0EA5A0;">support page</a>.
    </p>
  `);

  await sendEmail({ to: opts.to, subject: `Your session with ${opts.palName} — summary`, html });
}

// ─── Template: Welcome email ──────────────────────────────────────────────────
export async function sendWelcomeEmail(opts: { to: string; name: string }) {
  const html = layout(`
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#111827;">Welcome to Pat My Back 👋</h2>
    <p style="margin:0 0 16px;color:#6b7280;font-size:15px;">
      Hi ${opts.name}! We're so glad you're here. Pat My Back connects you with real, vetted supporters — 
      available for chat, audio, and video by the minute.
    </p>
    <p style="margin:0 0 24px;color:#6b7280;font-size:15px;">
      Browse available Pat Pals, top up your wallet, and start a conversation whenever you need someone in your corner.
    </p>
    ${btn("Find a Pat Pal", `${APP_URL}/browse`)}
    <p style="margin-top:24px;font-size:13px;color:#9ca3af;">
      Questions? Just reply to this email — we'd love to hear from you.
    </p>
  `);

  await sendEmail({ to: opts.to, subject: "Welcome to Pat My Back 🤝", html });
}
