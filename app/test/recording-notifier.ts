import type { Notification } from "~/lib/notifications";
import {
  PREFERENCE_KINDS,
  type Preferences,
} from "~/lib/notification-preferences";
import { recipientsWithoutActor, type Notifier } from "~/lib/notifier.server";

export type RecordedNotification = {
  kind: Notification["kind"];
  recipientIds: number[];
  actor: Notification["actor"];
  data: Notification["data"];
};

export type RecordingNotifier = Notifier & {
  /** Everything sent, in order, with the actor already dropped from recipients. */
  sent: RecordedNotification[];
};

/**
 * A Notifier for tests: records what would have been sent and calls nothing.
 * Pass `failWith` to make every send reject. Keeps a preference store per
 * user: a save merges into it, and a kind never saved is on.
 */
export function createRecordingNotifier(
  options: { failWith?: Error } = {}
): RecordingNotifier {
  const sent: RecordedNotification[] = [];
  const saved = new Map<number, Partial<Preferences>>();
  return {
    sent,
    async send(notification) {
      if (options.failWith) throw options.failWith;
      sent.push({
        kind: notification.kind,
        recipientIds: recipientsWithoutActor(notification).map((u) => u.id),
        actor: notification.actor,
        data: notification.data,
      });
    },
    async getPreferences(userId) {
      const preferences = Object.fromEntries(
        PREFERENCE_KINDS.map((kind) => [kind, true])
      ) as Preferences;
      return { ...preferences, ...saved.get(userId) };
    },
    async setPreference(userId, kind, enabled) {
      saved.set(userId, { ...saved.get(userId), [kind]: enabled });
    },
  };
}
