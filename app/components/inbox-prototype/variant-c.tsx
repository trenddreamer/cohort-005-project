// PROTOTYPE (throwaway, #17). Variant C, "Activity flyout": a bell beside the
// user in the sidebar footer opens a full-height panel attached to the
// sidebar's edge. Dense one-line rows grouped by day, with filter chips by
// kind. Toasts are small dark pills.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Bell, BellOff, CheckCheck, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "~/lib/utils";
import {
  dayGroup,
  plainExcerpt,
  timeAgo,
  useInbox,
  type InboxItem,
} from "./store";
import { ItemAvatar, kindLabel } from "./shared";

export const name = "Activity flyout";

export function FooterSlot() {
  const { unreadCount, isOpen, setOpen } = useInbox();
  return (
    <button
      onClick={() => setOpen(!isOpen)}
      title="Inbox"
      className={cn(
        "relative rounded-md p-1 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        isOpen && "bg-sidebar-accent text-sidebar-accent-foreground"
      )}
    >
      <Bell className="size-4" />
      {unreadCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-red-500 ring-2 ring-sidebar" />
      )}
    </button>
  );
}

function Pill({
  children,
  onClick,
  onClose,
}: {
  children: React.ReactNode;
  onClick: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex max-w-[356px] items-center gap-2 rounded-full bg-zinc-900 py-1.5 pl-1.5 pr-3 text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
      <button
        onClick={onClick}
        className="flex min-w-0 items-center gap-2 text-left"
      >
        {children}
      </button>
      <button onClick={onClose} className="opacity-60 hover:opacity-100">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function Overlay() {
  const inbox = useInbox();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => {
    inbox.registerToasts(
      (item, open) =>
        toast.custom(
          (id) => (
            <Pill onClick={() => open(item)} onClose={() => toast.dismiss(id)}>
              <ItemAvatar item={item} size="sm" />
              <span className="truncate">{item.title}</span>
            </Pill>
          ),
          { duration: 5000 }
        ),
      (count, openInbox) =>
        toast.custom(
          (id) => (
            <Pill onClick={openInbox} onClose={() => toast.dismiss(id)}>
              <span className="flex size-6 items-center justify-center rounded-full bg-red-500 text-xs font-semibold text-white">
                {count}
              </span>
              <span>You have {count} new notifications</span>
            </Pill>
          ),
          { duration: 5000 }
        ),
      navigate
    );
  }, [inbox.registerToasts, navigate]);

  if (!inbox.isOpen) return null;

  const labels = Array.from(new Set(inbox.items.map((n) => kindLabel(n.kind))));
  const shown = filter
    ? inbox.items.filter((n) => kindLabel(n.kind) === filter)
    : inbox.items;
  const groups = (["Today", "Yesterday", "Earlier"] as const)
    .map((g) => ({
      g,
      rows: shown.filter((n) => dayGroup(n.insertedAt) === g),
    }))
    .filter((x) => x.rows.length > 0);

  return (
    <aside className="fixed inset-y-0 left-56 z-40 flex w-80 flex-col border-r bg-sidebar text-sidebar-foreground shadow-xl">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <h2 className="text-sm font-semibold">Inbox</h2>
        {inbox.unreadCount > 0 && (
          <span className="text-xs text-sidebar-foreground/50">
            {inbox.unreadCount} unread
          </span>
        )}
        <button
          onClick={inbox.markAllRead}
          disabled={inbox.unreadCount === 0}
          title="Mark all as read"
          className="ml-auto rounded-md p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent disabled:opacity-30"
        >
          <CheckCheck className="size-4" />
        </button>
        <button
          onClick={() => inbox.setOpen(false)}
          className="rounded-md p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent"
        >
          <X className="size-4" />
        </button>
      </div>

      {labels.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b border-sidebar-border px-4 py-2">
          {[null, ...labels].map((l) => (
            <button
              key={l ?? "all"}
              onClick={() => setFilter(l)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium",
                filter === l
                  ? "bg-primary text-primary-foreground"
                  : "bg-sidebar-accent text-sidebar-foreground/70 hover:text-sidebar-foreground"
              )}
            >
              {l ?? "All"}
            </button>
          ))}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
          <BellOff className="size-6 text-sidebar-foreground/30" />
          <p className="text-sm text-sidebar-foreground/60">Nothing here yet</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-2">
          {groups.map(({ g, rows }) => (
            <section key={g}>
              <h3 className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                {g}
              </h3>
              {rows.map((item) => (
                <Row
                  key={item.id}
                  item={item}
                  onOpen={() => inbox.openItem(item, navigate)}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}

function Row({ item, onOpen }: { item: InboxItem; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-start gap-2.5 px-4 py-2 text-left transition-colors hover:bg-sidebar-accent"
    >
      <span
        className={cn(
          "mt-2 size-1.5 shrink-0 rounded-full",
          item.readAt ? "bg-transparent" : "bg-primary"
        )}
      />
      <ItemAvatar item={item} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p
            className={cn(
              "truncate text-[13px]",
              item.readAt ? "text-sidebar-foreground/60" : "font-medium"
            )}
          >
            {item.title}
          </p>
          <span className="ml-auto shrink-0 text-[11px] text-sidebar-foreground/40">
            {timeAgo(item.insertedAt)}
          </span>
        </div>
        {(item.excerpt || item.detail) && (
          <p className="truncate text-xs text-sidebar-foreground/50">
            {item.excerpt ? plainExcerpt(item.excerpt, 80) : item.detail}
          </p>
        )}
      </div>
    </button>
  );
}
