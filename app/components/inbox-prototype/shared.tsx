// PROTOTYPE (throwaway, #17): small pieces the variants share.
import {
  Ban,
  CircleCheck,
  CircleX,
  MessageSquare,
  MessageSquareReply,
  ReceiptText,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { UserAvatar } from "~/components/user-avatar";
import type { InboxItem, Kind } from "./store";

const kindMeta: Record<
  Kind,
  { icon: React.ElementType; tone: string; label: string }
> = {
  "refund-request-approved": {
    icon: CircleCheck,
    tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    label: "Refunds",
  },
  "refund-request-declined": {
    icon: CircleX,
    tone: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    label: "Refunds",
  },
  "open-refund-request": {
    icon: ReceiptText,
    tone: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    label: "Refunds",
  },
  "comment-reply": {
    icon: MessageSquareReply,
    tone: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    label: "Comments",
  },
  "lesson-comment": {
    icon: MessageSquare,
    tone: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    label: "Comments",
  },
  "new-enrollment": {
    icon: UserPlus,
    tone: "bg-primary/15 text-primary",
    label: "Enrollments",
  },
  "seat-claimed": {
    icon: UsersRound,
    tone: "bg-primary/15 text-primary",
    label: "Seats",
  },
  "access-ended": {
    icon: Ban,
    tone: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
    label: "Access",
  },
};

export function kindLabel(kind: Kind) {
  return kindMeta[kind].label;
}

export function KindIcon({
  kind,
  className,
}: {
  kind: Kind;
  className?: string;
}) {
  const { icon: Icon, tone } = kindMeta[kind];
  return (
    <div
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full",
        tone,
        className
      )}
    >
      <Icon className="size-4" />
    </div>
  );
}

/** The sender's avatar with a small kind icon in the corner, or just the kind icon. */
export function ItemAvatar({
  item,
  size = "md",
}: {
  item: InboxItem;
  size?: "sm" | "md";
}) {
  if (!item.actor)
    return (
      <KindIcon
        kind={item.kind}
        className={size === "sm" ? "size-6" : undefined}
      />
    );
  const { icon: Icon, tone } = kindMeta[item.kind];
  return (
    <div className="relative shrink-0">
      <UserAvatar
        name={item.actor.name}
        avatarUrl={item.actor.avatarUrl}
        className={size === "sm" ? "size-6 text-[10px]" : undefined}
      />
      <div
        className={cn(
          "absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full ring-2 ring-background",
          tone,
          "bg-background"
        )}
      >
        <Icon className="size-2.5" />
      </div>
    </div>
  );
}

export function UnreadBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white",
        className
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
