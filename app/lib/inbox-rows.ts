// Turns one Notification (its kind, actor and data) into what an Inbox row
// shows. Pure, so it is tested without a browser. Everything returned is plain
// text: names, course titles and excerpts are user-entered, so the Inbox never
// uses Knock's rendered HTML.
import { z } from "zod";
import type { NotificationKind } from "~/lib/notifications";

/** What a row needs from a Notification. */
export type InboxRow = {
  kind: NotificationKind;
  /** Null when the Notification names nobody. */
  actor: { name: string; avatarUrl: string | null } | null;
  title: string;
  detail: string | null;
  /** Plain text, already cut short on the server. */
  excerpt: string | null;
  /** Where clicking the row goes. */
  href: string;
};

/** The parts of a Knock feed item a row is built from. */
export type RowSource = {
  kind: string;
  /** Knock's inline-identified user, as it comes back on the feed item. */
  actor: { id: string; name?: string | null; avatar?: string | null } | null;
  data: Record<string, unknown> | null;
};

const text = z.string();
const id = z.number();

type Built = Pick<InboxRow, "title" | "detail" | "excerpt" | "href">;

/** Checks a Notification's data against its kind, then builds the row text. */
type KindBuilder = (data: unknown, who: string) => Built | null;

function spec<T extends z.ZodType>(
  schema: T,
  build: (data: z.infer<T>, who: string) => Built
): KindBuilder {
  return (data, who) => {
    const parsed = schema.safeParse(data);
    return parsed.success ? build(parsed.data, who) : null;
  };
}

const course = (slug: string) => `/courses/${slug}`;
const lessonComment = (slug: string, lessonId: number, commentId: number) =>
  `/courses/${slug}/lessons/${lessonId}#comment-${commentId}`;

const specs = {
  "refund-request-approved": spec(
    z.object({
      course_title: text,
      course_slug: text,
      amount: text,
    }),
    (d) => ({
      title: `Refund approved for ${d.course_title}`,
      detail: `We've refunded the ${d.amount} you paid.`,
      excerpt: null,
      href: course(d.course_slug),
    })
  ),
  "refund-request-declined": spec(
    z.object({ course_title: text, course_slug: text }),
    (d) => ({
      title: `Refund declined for ${d.course_title}`,
      detail: "You still have access to the course.",
      excerpt: null,
      href: course(d.course_slug),
    })
  ),
  "comment-reply": spec(
    z.object({
      lesson_title: text,
      course_slug: text,
      lesson_id: id,
      comment_id: id,
      excerpt: text,
    }),
    (d, who) => ({
      title: `${who} replied to your comment on ${d.lesson_title}`,
      detail: null,
      excerpt: d.excerpt,
      href: lessonComment(d.course_slug, d.lesson_id, d.comment_id),
    })
  ),
  "lesson-comment": spec(
    z.object({
      lesson_title: text,
      course_title: text,
      course_slug: text,
      lesson_id: id,
      comment_id: id,
      excerpt: text,
    }),
    (d, who) => ({
      title: `${who} commented on ${d.lesson_title}`,
      detail: `in ${d.course_title}`,
      excerpt: d.excerpt,
      href: lessonComment(d.course_slug, d.lesson_id, d.comment_id),
    })
  ),
  "new-enrollment": spec(
    z.object({ course_title: text, course_id: id }),
    (d, who) => ({
      title: `${who} enrolled in ${d.course_title}`,
      detail: null,
      excerpt: null,
      href: `/instructor/${d.course_id}/students`,
    })
  ),
  "open-refund-request": spec(
    z.object({ course_title: text, excerpt: text }),
    (d, who) => ({
      title: `${who} requested a refund for ${d.course_title}`,
      detail: null,
      excerpt: d.excerpt,
      href: "/admin/refunds",
    })
  ),
  "seat-claimed": spec(z.object({ course_title: text }), (d, who) => ({
    title: `${who} claimed a seat on ${d.course_title}`,
    detail: null,
    excerpt: null,
    href: "/team",
  })),
  "access-ended": spec(
    z.object({ course_title: text, course_slug: text }),
    (d) => ({
      title: `Your access to ${d.course_title} has ended`,
      detail:
        "The team purchase was refunded. Your progress is kept if you get access again.",
      excerpt: null,
      href: course(d.course_slug),
    })
  ),
} satisfies Record<NotificationKind, KindBuilder>;

function isKnownKind(kind: string): kind is NotificationKind {
  return Object.hasOwn(specs, kind);
}

/**
 * The row for one Notification, or null when its kind is not one Cadence
 * knows or its data lacks what that kind needs (so the Inbox skips it rather
 * than showing a broken row).
 */
export function describeNotification(source: RowSource): InboxRow | null {
  if (!isKnownKind(source.kind)) return null;
  const kind = source.kind;
  const actor = source.actor
    ? {
        name: source.actor.name?.trim() || "Someone",
        avatarUrl: source.actor.avatar ?? null,
      }
    : null;
  const who = actor?.name ?? "Someone";

  const built = specs[kind](source.data, who);
  return built && { kind, actor, ...built };
}
