import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { Db } from "~/db/types";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import { excerpt } from "~/lib/excerpt";
import { notify, type Notifier } from "~/lib/notifier.server";
import { toNotificationUser, type NotificationUser } from "~/lib/notifications";

export type CreateCommentResult =
  | { ok: true; comment: typeof schema.comments.$inferSelect }
  | { ok: false; error: string };

/**
 * Creates a comment, or a reply when `parentId` is set, then sends the
 * Notification: `comment-reply` to the top-level comment's author, or
 * `lesson-comment` to the course's instructor. The commenter is never
 * notified of their own comment. Invalid input comes back as
 * `{ ok: false, error }` with a displayable message, and nothing is saved or
 * sent. A Notifier that fails does not fail the comment.
 */
export async function createComment(
  db: Db,
  notifier: Notifier,
  userId: number,
  lessonId: number,
  parentId: number | null,
  body: string
): Promise<CreateCommentResult> {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    return { ok: false, error: "Comment cannot be empty" };
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    return {
      ok: false,
      error: `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`,
    };
  }

  const lesson = db
    .select({
      title: schema.lessons.title,
      courseTitle: schema.courses.title,
      courseSlug: schema.courses.slug,
      instructorId: schema.courses.instructorId,
    })
    .from(schema.lessons)
    .innerJoin(schema.modules, eq(schema.lessons.moduleId, schema.modules.id))
    .innerJoin(schema.courses, eq(schema.modules.courseId, schema.courses.id))
    .where(eq(schema.lessons.id, lessonId))
    .get();
  if (!lesson) {
    return { ok: false, error: "Lesson not found" };
  }

  let parent: typeof schema.comments.$inferSelect | undefined;
  if (parentId !== null) {
    parent = db
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.id, parentId))
      .get();
    if (!parent) {
      return { ok: false, error: "Parent comment not found" };
    }
    if (parent.lessonId !== lessonId) {
      return {
        ok: false,
        error: "Parent comment belongs to a different lesson",
      };
    }
    if (parent.parentId !== null) {
      return { ok: false, error: "Replies can only be one level deep" };
    }
  }

  const comment = db
    .insert(schema.comments)
    .values({ userId, lessonId, parentId, body: trimmed })
    .returning()
    .get();

  const actor = getUser(db, userId);
  if (!actor) return { ok: true, comment };

  if (parent) {
    const recipient = getUser(db, parent.userId);
    if (recipient && recipient.id !== actor.id) {
      await notify(notifier, {
        kind: "comment-reply",
        actor,
        recipients: [recipient],
        data: {
          lesson_title: lesson.title,
          course_slug: lesson.courseSlug,
          lesson_id: lessonId,
          comment_id: comment.id,
          excerpt: excerpt(trimmed),
        },
      });
    }
  } else {
    const instructor = getUser(db, lesson.instructorId);
    if (instructor && instructor.id !== actor.id) {
      await notify(notifier, {
        kind: "lesson-comment",
        actor,
        recipients: [instructor],
        data: {
          lesson_title: lesson.title,
          course_title: lesson.courseTitle,
          course_slug: lesson.courseSlug,
          lesson_id: lessonId,
          comment_id: comment.id,
          excerpt: excerpt(trimmed),
        },
      });
    }
  }

  return { ok: true, comment };
}

function getUser(db: Db, userId: number): NotificationUser | undefined {
  const user = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  return user && toNotificationUser(user);
}
