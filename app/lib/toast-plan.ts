// Decides which toasts a batch of newly arrived Notifications raises. Pure, so
// it is tested without a browser. A toast is not a Notification: this only
// decides what is announced, never what is in the Inbox.
import type { InboxItem } from "~/lib/inbox-client";

export const MAX_TOASTS = 3;

export type ToastAction =
  /** One toast for one Notification. */
  | { type: "notification"; item: InboxItem }
  /**
   * One summary toast saying `count` more Notifications arrived. `count` is
   * the running total, so it replaces the summary already on screen.
   */
  | { type: "overflow"; count: number };

export type ToastContext = {
  videoPlaying: boolean;
  /** Notification toasts currently visible, not counting the summary. */
  toastsOnScreen: number;
  /** The count the summary toast on screen shows, or 0 when there is none. */
  overflowCount: number;
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
      // A later burst adds to the summary already on screen. It is one toast
      // (same ID), so at most 3 Notification toasts plus the summary show.
      const overflow = toastable.length - actions.length;
      if (overflow > 0) {
        actions.push({
          type: "overflow",
          count: context.overflowCount + overflow,
        });
      }
      return actions;
    },
  };
}
