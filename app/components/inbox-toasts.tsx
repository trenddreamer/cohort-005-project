import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useInbox } from "~/components/inbox-provider";
import { EMPTY_INBOX_STATE } from "~/lib/inbox-client";
import { createToastPlanner } from "~/lib/toast-plan";
import { isVideoPlaying } from "~/lib/video-playing";

const TOAST_DURATION_MS = 5000;

/**
 * Announces Notifications that arrive while the page is open. Renders nothing;
 * the toasts are drawn by the app's sonner `<Toaster />`. Dismissing a toast
 * never reads the Notification: only "View" does.
 */
export function InboxToasts() {
  const { connected, state, markAsRead, setOpen, onArrival } = useInbox();
  const navigate = useNavigate();
  const planner = useRef(createToastPlanner());
  // Notification toasts only; the summary toast is tracked by its count.
  const onScreen = useRef(new Set<string | number>());
  const overflowCount = useRef(0);
  const seeded = useRef(false);

  // Latest callbacks, so the arrival subscription below is set up once.
  const latest = useRef({ markAsRead, setOpen, navigate });
  latest.current = { markAsRead, setOpen, navigate };

  // Whatever the Inbox first loads was there at page load: no toasts for it.
  // The placeholder state before the first fetch is not a loaded Inbox.
  const ready =
    connected && state !== EMPTY_INBOX_STATE && state.status === "ready";
  useEffect(() => {
    if (ready && !seeded.current) {
      seeded.current = true;
      planner.current.seed(state.items.map((item) => item.id));
    }
  }, [ready, state.items]);

  useEffect(() => {
    function track(id: string | number) {
      onScreen.current.add(id);
      return () => void onScreen.current.delete(id);
    }

    return onArrival((items) => {
      const actions = planner.current.plan(items, {
        videoPlaying: isVideoPlaying(),
        toastsOnScreen: onScreen.current.size,
        overflowCount: overflowCount.current,
      });
      for (const action of actions) {
        if (action.type === "notification") {
          const { item } = action;
          const release = track(item.id);
          toast(item.row.title, {
            id: item.id,
            description: item.row.detail ?? undefined,
            duration: TOAST_DURATION_MS,
            onDismiss: release,
            onAutoClose: release,
            action: {
              label: "View",
              onClick: () => {
                release();
                latest.current.markAsRead(item.id);
                latest.current.navigate(item.row.href);
              },
            },
          });
        } else {
          const id = "inbox-overflow";
          // The planner's count is the running total: it replaces the toast.
          overflowCount.current = action.count;
          const release = () => void (overflowCount.current = 0);
          toast(
            `You have ${action.count} more new notification${
              action.count === 1 ? "" : "s"
            }`,
            {
              id,
              duration: TOAST_DURATION_MS,
              onDismiss: release,
              onAutoClose: release,
              action: {
                label: "Open inbox",
                onClick: () => {
                  release();
                  latest.current.setOpen(true);
                },
              },
            }
          );
        }
      }
    });
  }, [onArrival]);

  return null;
}
