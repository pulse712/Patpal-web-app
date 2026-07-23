const WELCOME_SENT_KEY = "patpal-welcome-sent";

/** Prevent duplicate welcome emails across signup paths (instant vs email verify). */
export function shouldSendWelcomeEmail(userId: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    const sent = JSON.parse(localStorage.getItem(WELCOME_SENT_KEY) ?? "[]") as string[];
    return !sent.includes(userId);
  } catch {
    return true;
  }
}

export function markWelcomeEmailSent(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    const sent = JSON.parse(localStorage.getItem(WELCOME_SENT_KEY) ?? "[]") as string[];
    if (!sent.includes(userId)) {
      sent.push(userId);
      localStorage.setItem(WELCOME_SENT_KEY, JSON.stringify(sent.slice(-20)));
    }
  } catch {
    /* ignore */
  }
}

export async function sendWelcomeOnce(opts: {
  userId: string;
  name: string;
  email: string;
  send: (data: { name: string; email: string }) => Promise<unknown>;
}): Promise<void> {
  if (!shouldSendWelcomeEmail(opts.userId)) return;
  markWelcomeEmailSent(opts.userId);
  await opts.send({ name: opts.name, email: opts.email }).catch(() => {});
}
