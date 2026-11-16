// Decides which toasts a batch of newly arrived Notifications raises. Pure, so
// it is tested without a browser. A toast is not a Notification: this only
// decides what is announced, never what is in the Inbox.
import type { InboxItem } from "~/lib/inbox-client";

export const MAX_TOASTS = 3;

export type ToastAction =
  /** One toast for one Notification. */
  | { type: "notification"; item: InboxItem }
  /** One toast saying `count` more Notifications arrived. */
  | { type: "overflow"; count: number };

export type ToastContext = {
  videoPlaying: boolean;
  /** Toasts currently visible. */
  toastsOnScreen: number;
};

export function createToastPlanner() {
  // Every Notification ID already handled, announced or not.
  const handled = new Set<string>();

  return {
    /** Marks Notifications already in the Inbox at page load as handled. */
    seed(ids: string[]): void {
      for (const id of ids) handled.add(id);
    },

    plan(arrived: InboxItem[], context: ToastContext): ToastAction[] {
      const fresh = arrived.filter((item) => {
        if (handled.has(item.id)) return false;
        handled.add(item.id);
        return true;
      });
      if (context.videoPlaying) return [];

      const toastable = fresh.filter((i) => i.row.kind !== "new-enrollment");
      const room = Math.max(0, MAX_TOASTS - context.toastsOnScreen);
      const actions: ToastAction[] = toastable
        .slice(0, room)
        .map((item) => ({ type: "notification", item }));
      const overflow = toastable.length - actions.length;
      if (overflow > 0) actions.push({ type: "overflow", count: overflow });
      return actions;
    },
  };
}
