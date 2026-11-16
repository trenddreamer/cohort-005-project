// PROTOTYPE (throwaway, #17). Variant A, "Bell popover": a bell in the sidebar
// header opens a compact dropdown list beside the sidebar. Plain sonner toasts.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Bell, BellOff, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "~/lib/utils";
import { plainExcerpt, timeAgo, useInbox } from "./store";
import { ItemAvatar, UnreadBadge } from "./shared";

export const name = "Bell popover";

const PAGE_SIZE = 10;

export function HeaderSlot() {
  const { unreadCount, isOpen, setOpen } = useInbox();
  return (
    <button
      onClick={() => setOpen(!isOpen)}
      title="Inbox"
      className={cn(
        "relative ml-auto rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        isOpen && "bg-sidebar-accent text-sidebar-accent-foreground"
      )}
    >
      <Bell className="size-4" />
      <UnreadBadge count={unreadCount} className="absolute -right-1 -top-1" />
    </button>
  );
}

export function Overlay() {
  const inbox = useInbox();
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inbox.registerToasts(
      (item, open) =>
        toast(item.title, {
          description: item.detail,
          duration: 5000,
          action: { label: "View", onClick: () => open(item) },
        }),
      (count, openInbox) =>
        toast(`You have ${count} more new notification${count === 1 ? "" : "s"}`, {
          duration: 5000,
          action: { label: "Open inbox", onClick: openInbox },
        }),
      navigate
    );
  }, [inbox.registerToasts, navigate]);

  useEffect(() => {
    if (!inbox.isOpen) return;
    function onDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (
        panelRef.current?.contains(target) ||
        target.closest("[title='Inbox']")
      )
        return;
      inbox.setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [inbox.isOpen, inbox.setOpen]);

  // Infinite scroll, simulated: show one "page" of PAGE_SIZE, and load the
  // next page (with a short fake network delay) when the bottom row scrolls
  // into view. The real Inbox would fetch Knock's next feed page instead.
  const [pages, setPages] = useState(1);
  const sentinelRef = useRef<HTMLLIElement>(null);
  const shownCount = pages * PAGE_SIZE;
  const hasMore = inbox.items.length > shownCount;

  useEffect(() => {
    if (!inbox.isOpen) setPages(1);
  }, [inbox.isOpen]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !timer) {
        timer = setTimeout(() => setPages((p) => p + 1), 700);
      }
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [hasMore, pages, inbox.isOpen]);

  if (!inbox.isOpen) return null;

  return (
    <div
      ref={panelRef}
      className="fixed left-[14.5rem] top-2 z-40 flex max-h-[70vh] w-96 flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Notifications</h2>
        {inbox.unreadCount > 0 && (
          <button
            onClick={inbox.markAllRead}
            className="text-xs font-medium text-primary hover:underline"
          >
            Mark all as read
          </button>
        )}
      </div>

      {inbox.items.length === 0 ? (
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
          {inbox.items.slice(0, shownCount).map((item) => (
            <li
              key={item.id}
              className="group relative border-b last:border-b-0"
            >
              <button
                onClick={() => inbox.openItem(item, navigate)}
                className={cn(
                  "flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60",
                  !item.readAt && "bg-primary/5"
                )}
              >
                <ItemAvatar item={item} />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm leading-snug",
                      item.readAt ? "text-muted-foreground" : "font-medium"
                    )}
                  >
                    {item.title}
                  </p>
                  {item.detail && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.detail}
                    </p>
                  )}
                  {item.excerpt && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      “{plainExcerpt(item.excerpt)}”
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground/70">
                    {timeAgo(item.insertedAt)}
                  </p>
                </div>
                {!item.readAt && (
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                )}
              </button>
              {!item.readAt && (
                <button
                  onClick={() => inbox.markRead(item.id)}
                  title="Mark as read"
                  className="absolute right-3 top-8 hidden rounded-md border bg-background p-1 text-muted-foreground shadow-sm hover:text-foreground group-hover:block"
                >
                  <Check className="size-3.5" />
                </button>
              )}
            </li>
          ))}
          {hasMore ? (
            <li
              ref={sentinelRef}
              className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground"
            >
              <Loader2 className="size-3.5 animate-spin" /> Loading older
              notifications…
            </li>
          ) : (
            <li className="py-4 text-center text-xs text-muted-foreground/70">
              That's all your notifications
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
