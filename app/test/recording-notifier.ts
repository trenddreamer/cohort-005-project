import type { Notification } from "~/lib/notifications";
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
 * Pass `failWith` to make every send reject.
 */
export function createRecordingNotifier(
  options: { failWith?: Error } = {}
): RecordingNotifier {
  const sent: RecordedNotification[] = [];
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
  };
}
