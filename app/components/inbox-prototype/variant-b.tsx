// PROTOTYPE (throwaway, #17). Variant B, "Inbox drawer": an "Inbox" nav item
// opens a full-height drawer from the right with Unread / All tabs and roomy
// cards. Custom toasts with the sender's avatar, clickable as a whole.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { CheckCheck, Inbox as InboxIcon, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "~/lib/utils";
import { plainExcerpt, timeAgo, useInbox, type InboxItem } from "./store";
import { ItemAvatar } from "./shared";

export const name = "Inbox drawer";

export function NavSlot() {
  const { unreadCount, isOpen, setOpen } = useInbox();
  return (
    <button
      onClick={() => setOpen(!isOpen)}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        isOpen
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}
    >
      <InboxIcon className="size-4" />
      Inbox
      {unreadCount > 0 && (
        <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
          {unreadCount}
        </span>
      )}
    </button>
  );
}

function ToastCard({
  item,
  onOpen,
  onClose,
}: {
  item: InboxItem;
  onOpen: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex w-[356px] items-start gap-3 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg">
      <button
        onClick={onOpen}
        className="flex flex-1 items-start gap-3 text-left"
      >
        <ItemAvatar item={item} />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            New notification
          </p>
          <p className="text-sm font-medium leading-snug">{item.title}</p>
        </div>
      </button>
      <button
        onClick={onClose}
        className="text-muted-foreground hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export function Overlay() {
  const inbox = useInbox();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"unread" | "all">("unread");

  useEffect(() => {
    inbox.registerToasts(
      (item, open) =>
        toast.custom(
          (id) => (
            <ToastCard
              item={item}
              onOpen={() => open(item)}
              onClose={() => toast.dismiss(id)}
            />
          ),
          { duration: 5000 }
        ),
      (count, openInbox) =>
        toast.custom(
          (id) => (
            <div className="flex w-[356px] items-center gap-3 rounded-lg border bg-popover p-3 shadow-lg">
              <InboxIcon className="size-5 text-primary" />
              <button
                onClick={openInbox}
                className="flex-1 text-left text-sm font-medium"
              >
                You have {count} new notifications
              </button>
              <button
                onClick={() => toast.dismiss(id)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          ),
          { duration: 5000 }
        ),
      navigate
    );
  }, [inbox.registerToasts, navigate]);

  if (!inbox.isOpen) return null;
  const shown =
    tab === "unread" ? inbox.items.filter((n) => !n.readAt) : inbox.items;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={() => inbox.setOpen(false)}
      />
      <aside className="fixed inset-y-0 right-0 z-40 flex w-[440px] flex-col border-l bg-background shadow-2xl">
        <div className="flex items-center gap-3 border-b px-5 py-4">
          <h2 className="text-lg font-semibold">Inbox</h2>
          <button
            onClick={inbox.markAllRead}
            disabled={inbox.unreadCount === 0}
            className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <CheckCheck className="size-3.5" /> Mark all as read
          </button>
          <button
            onClick={() => inbox.setOpen(false)}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex gap-1 border-b px-5">
          {(["unread", "all"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize",
                tab === t
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t}
              {t === "unread" &&
                inbox.unreadCount > 0 &&
                ` (${inbox.unreadCount})`}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-muted">
              <InboxIcon className="size-7 text-muted-foreground" />
            </div>
            <p className="font-medium">
              {tab === "unread"
                ? "You're all caught up"
                : "Your inbox is empty"}
            </p>
            <p className="text-sm text-muted-foreground">
              {tab === "unread"
                ? "You've read every notification."
                : "Replies, refund updates and course activity will show up here."}
            </p>
          </div>
        ) : (
          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {shown.map((item) => (
              <article
                key={item.id}
                onClick={() => inbox.openItem(item, navigate)}
                className={cn(
                  "cursor-pointer rounded-lg border p-4 transition-colors hover:border-primary/40",
                  item.readAt
                    ? "bg-background"
                    : "border-primary/30 bg-primary/5"
                )}
              >
                <div className="flex items-start gap-3">
                  <ItemAvatar item={item} />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "text-sm leading-snug",
                        !item.readAt && "font-semibold"
                      )}
                    >
                      {item.title}
                    </p>
                    {item.detail && (
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {item.detail}
                      </p>
                    )}
                  </div>
                  {!item.readAt && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        inbox.markRead(item.id);
                      }}
                      title="Mark as read"
                      className="rounded-full border p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <CheckCheck className="size-3.5" />
                    </button>
                  )}
                </div>
                {item.excerpt && (
                  <blockquote className="mt-3 border-l-2 pl-3 text-sm text-muted-foreground">
                    {plainExcerpt(item.excerpt)}
                  </blockquote>
                )}
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded bg-muted px-1.5 py-0.5">
                    {item.courseTitle}
                  </span>
                  <span>·</span>
                  <span>{timeAgo(item.insertedAt)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </aside>
    </>
  );
}
