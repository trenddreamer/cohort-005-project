import Knock from "@knocklabs/node";
import type { Notification, NotificationUser } from "~/lib/notifications";
import {
  PREFERENCE_KINDS,
  type PreferenceKind,
  type Preferences,
} from "~/lib/notification-preferences";

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

  /**
   * Reads a person's switches. Every kind is present; one they never saved,
   * or a person Knock has never seen, is on.
   */
  getPreferences(userId: number): Promise<Preferences>;

  /**
   * Saves one switch, merging into the saved set so the other switches stay
   * as they were. Only a kind that can be switched off is accepted:
   * "access-ended" is not a `PreferenceKind`.
   */
  setPreference(
    userId: number,
    kind: PreferenceKind,
    enabled: boolean
  ): Promise<void>;
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

/** The slice of the Knock SDK the Notifier uses for preferences. */
export type KnockUsers = {
  getPreferences(
    userId: string,
    preferenceSetId: string
  ): Promise<{ workflows?: Record<string, unknown> | null }>;
  setPreferences(
    userId: string,
    preferenceSetId: string,
    body: {
      __persistence_strategy__: "merge";
      workflows: Record<string, { channel_types: { in_app_feed: boolean } }>;
    }
  ): Promise<unknown>;
};

const PREFERENCE_SET_ID = "default";

/** Knock treats anything not explicitly `false` as on. */
function isSwitchedOn(workflow: unknown): boolean {
  if (workflow === false) return false;
  if (workflow instanceof Object && "channel_types" in workflow) {
    const channelTypes = workflow.channel_types;
    if (channelTypes instanceof Object && "in_app_feed" in channelTypes) {
      return channelTypes.in_app_feed !== false;
    }
  }
  return true;
}

function allOn(): Preferences {
  return Object.fromEntries(
    PREFERENCE_KINDS.map((kind) => [kind, true])
  ) as Preferences;
}

function identify(user: NotificationUser) {
  // Knock user IDs are strings; the Cadence user ID is the Knock user ID.
  return { id: String(user.id), name: user.name, avatar: user.avatarUrl };
}

export function createKnockNotifier(
  workflows: KnockWorkflows,
  users: KnockUsers
): Notifier {
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
    async getPreferences(userId) {
      let workflowPreferences: Record<string, unknown> | null | undefined;
      try {
        const set = await users.getPreferences(
          String(userId),
          PREFERENCE_SET_ID
        );
        workflowPreferences = set.workflows;
      } catch (error) {
        // Knock has never seen this person: nothing saved, so everything on.
        if (describeStatus(error) === "404") return allOn();
        throw error;
      }
      const preferences = allOn();
      for (const kind of PREFERENCE_KINDS) {
        preferences[kind] = isSwitchedOn(workflowPreferences?.[kind]);
      }
      return preferences;
    },
    async setPreference(userId, kind, enabled) {
      await users.setPreferences(String(userId), PREFERENCE_SET_ID, {
        // Without merge Knock replaces the whole set, dropping other switches.
        __persistence_strategy__: "merge",
        workflows: { [kind]: { channel_types: { in_app_feed: enabled } } },
      });
    },
  };
}

/** Skips every Notification. Used when Knock keys are missing. */
export function createNoopNotifier(): Notifier {
  return {
    async send() {},
    async getPreferences() {
      return allOn();
    },
    async setPreference() {},
  };
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
  return createKnockNotifier(knock.workflows, knock.users);
}

let instance: Notifier | undefined;

/** The process-wide Notifier, built on first use. Routes pass it in. */
export function getNotifier(): Notifier {
  instance ??= createNotifierFromEnv(process.env);
  return instance;
}
