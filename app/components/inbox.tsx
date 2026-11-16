import { useEffect, useRef, type ElementType } from "react";
import { useNavigate } from "react-router";
import {
  Ban,
  Bell,
  BellOff,
  CircleCheck,
  CircleX,
  MessageSquare,
  MessageSquareReply,
  ReceiptText,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { cn, formatRelativeTime } from "~/lib/utils";
import { UserAvatar } from "~/components/user-avatar";
import { useInbox } from "~/components/inbox-provider";
import type { InboxItem } from "~/lib/inbox-client";
import type { NotificationKind } from "~/lib/notifications";

const kindMeta: Record<NotificationKind, { icon: ElementType; tone: string }> =
  {
    "refund-request-approved": {
      icon: CircleCheck,
      tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    },
    "refund-request-declined": {
      icon: CircleX,
      tone: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    },
    "open-refund-request": {
      icon: ReceiptText,
      tone: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    },
    "comment-reply": {
      icon: MessageSquareReply,
      tone: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    },
    "lesson-comment": {
      icon: MessageSquare,
      tone: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    },
    "new-enrollment": {
      icon: UserPlus,
      tone: "bg-primary/15 text-primary",
    },
    "seat-claimed": {
      icon: UsersRound,
      tone: "bg-primary/15 text-primary",
    },
    "access-ended": {
      icon: Ban,
      tone: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
    },
  };

/** The actor's avatar with a small kind icon, or a coloured kind icon alone. */
function RowAvatar({ item }: { item: InboxItem }) {
  const { icon: Icon, tone } = kindMeta[item.row.kind];
  const { actor } = item.row;
  if (!actor) {
    return (
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          tone
        )}
      >
        <Icon className="size-4" />
      </div>
    );
  }
  return (
    <div className="relative shrink-0">
      <UserAvatar name={actor.name} avatarUrl={actor.avatarUrl} />
      <div
        className={cn(
          "absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-background ring-2 ring-background",
          tone
        )}
      >
        <Icon className="size-2.5" />
      </div>
    </div>
  );
}

function UnreadCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
      {count > 9 ? "9+" : count}
    </span>
  );
}

/** The icon at the right of the sidebar header, with the unread count. */
export function InboxButton() {
  const { state, isOpen, setOpen } = useInbox();
  return (
    <button
      type="button"
      data-inbox-button=""
      aria-label={
        state.unreadCount > 0 ? `Inbox, ${state.unreadCount} unread` : "Inbox"
      }
      aria-expanded={isOpen}
      title="Inbox"
      onClick={() => setOpen(!isOpen)}
      className={cn(
        "relative ml-auto rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        isOpen && "bg-sidebar-accent text-sidebar-accent-foreground"
      )}
    >
      <Bell className="size-4" />
      <UnreadCount count={state.unreadCount} />
    </button>
  );
}

function InboxRowButton({ item }: { item: InboxItem }) {
  const { markAsRead, setOpen } = useInbox();
  const navigate = useNavigate();
  const unread = item.readAt === null;
  const { row } = item;

  function open() {
    if (unread) markAsRead(item.id);
    setOpen(false);
    void navigate(row.href);
  }

  return (
    <button
      type="button"
      onClick={open}
      className={cn(
        "flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60",
        unread && "bg-primary/5"
      )}
    >
      <RowAvatar item={item} />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm leading-snug",
            unread ? "font-semibold" : "text-muted-foreground"
          )}
        >
          {row.title}
        </p>
        {row.detail && (
          <p className="mt-0.5 text-xs text-muted-foreground">{row.detail}</p>
        )}
        {row.excerpt && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            “{row.excerpt}”
          </p>
        )}
        <p
          className="mt-1 text-[11px] text-muted-foreground/70"
          suppressHydrationWarning
        >
          {formatRelativeTime(item.insertedAt)}
        </p>
      </div>
      {unread && (
        <span
          aria-label="Unread"
          className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
        />
      )}
    </button>
  );
}

/** The dropdown beside the sidebar. Renders nothing while closed. */
export function InboxPanel() {
  const { state, isOpen, setOpen } = useInbox();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function closeOnOutsideClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (panelRef.current?.contains(target)) return;
      // The icon toggles the Inbox itself.
      if (target.closest("[data-inbox-button]")) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [isOpen, setOpen]);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Notifications"
      className="fixed left-[14.5rem] top-2 z-40 flex max-h-[70vh] w-96 flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
    >
      <div className="flex items-center border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Notifications</h2>
      </div>
      {state.items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <BellOff className="size-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">No notifications yet</p>
          <p className="text-xs text-muted-foreground">
            When someone replies to you or something happens on your courses,
            it'll show up here.
          </p>
        </div>
      ) : (
        <ul className="overflow-y-auto">
          {state.items.map((item) => (
            <li key={item.id} className="border-b last:border-b-0">
              <InboxRowButton item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
