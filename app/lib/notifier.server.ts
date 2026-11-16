import Knock from "@knocklabs/node";
import type { Notification, NotificationUser } from "~/lib/notifications";

/**
 * The only server code that talks to Knock, in Cadence's language. Callers
 * are handed one as a parameter, the same way they are handed the database.
 * Later tickets add to this interface: issuing an Inbox token and reading
 * and saving preferences.
 */
export interface Notifier {
  /**
   * Sends one Notification. Rejects when delivery fails: callers use
   * `notify`, which turns that into one log line.
   */
  send(notification: Notification): Promise<void>;
}

/** The recipients who are not the actor: nobody hears about their own action. */
export function recipientsWithoutActor(
  notification: Notification
): NotificationUser[] {
  const actorId = notification.actor?.id;
  return notification.recipients.filter((user) => user.id !== actorId);
}

/**
 * Sends a Notification on a best-effort basis. Never rejects, so the action
 * that caused the Notification always succeeds. A failure becomes one
 * `console.error` line: the workflow key, the recipient IDs, the HTTP status
 * and the message. Never tokens, keys or excerpt text.
 */
export async function notify(
  notifier: Notifier,
  notification: Notification
): Promise<void> {
  try {
    await notifier.send(notification);
  } catch (error) {
    const recipientIds = notification.recipients
      .map((user) => user.id)
      .join(", ");
    console.error(
      `[notifier] ${notification.kind} to user ${recipientIds} failed: ` +
        `${describeStatus(error)} ${describeMessage(error)}`
    );
  }
}

function describeStatus(error: unknown): string {
  if (error instanceof Object && "status" in error) {
    if (typeof error.status === "number") return String(error.status);
  }
  return "no status";
}

function describeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

// ─── Implementations ───

/** The slice of the Knock SDK the Notifier uses, so tests can stand in. */
export type KnockWorkflows = {
  trigger(
    key: string,
    params: {
      recipients: { id: string; name: string; avatar: string | null }[];
      actor?: { id: string; name: string; avatar: string | null };
      data: Record<string, unknown>;
    }
  ): Promise<unknown>;
};

function identify(user: NotificationUser) {
  // Knock user IDs are strings; the Cadence user ID is the Knock user ID.
  return { id: String(user.id), name: user.name, avatar: user.avatarUrl };
}

export function createKnockNotifier(workflows: KnockWorkflows): Notifier {
  return {
    async send(notification) {
      const recipients = recipientsWithoutActor(notification);
      if (recipients.length === 0) return;
      await workflows.trigger(notification.kind, {
        recipients: recipients.map(identify),
        actor: notification.actor ? identify(notification.actor) : undefined,
        data: notification.data,
      });
    },
  };
}

/** Skips every Notification. Used when Knock keys are missing. */
export function createNoopNotifier(): Notifier {
  return { async send() {} };
}

// Sending is inline in the user's request, so a Knock outage must not stall
// it: one retry and a short timeout, not the SDK's two retries and 60 s.
const KNOCK_MAX_RETRIES = 1;
const KNOCK_TIMEOUT_MS = 5_000;

type Env = Record<string, string | undefined>;

/**
 * The Knock settings the Notifier needs, or null when they are missing. The
 * key must be present and non-empty: `new Knock({ apiKey: "" })` does not
 * throw, so the check has to be ours.
 */
export function knockConfigFromEnv(env: Env): { apiKey: string } | null {
  const apiKey = env.KNOCK_API_KEY?.trim();
  return apiKey ? { apiKey } : null;
}

/**
 * Picks the Knock Notifier when the keys are there, else the no-op one with a
 * single warning. Reads `env` when called, not at import, to keep this module
 * free of side effects.
 */
export function createNotifierFromEnv(env: Env): Notifier {
  const config = knockConfigFromEnv(env);
  if (!config) {
    console.warn(
      "[notifier] KNOCK_API_KEY is missing or empty: Notifications are skipped."
    );
    return createNoopNotifier();
  }
  const knock = new Knock({
    apiKey: config.apiKey,
    maxRetries: KNOCK_MAX_RETRIES,
    timeout: KNOCK_TIMEOUT_MS,
  });
  return createKnockNotifier(knock.workflows);
}

let instance: Notifier | undefined;

/** The process-wide Notifier, built on first use. Routes pass it in. */
export function getNotifier(): Notifier {
  instance ??= createNotifierFromEnv(process.env);
  return instance;
}
