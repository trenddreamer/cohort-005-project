import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { Db } from "~/db/types";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import { excerpt } from "~/lib/excerpt";
import { notify, type Notifier } from "~/lib/notifier.server";
import type { NotificationUser } from "~/lib/notifications";

/**
 * Creates a comment, or a reply when `parentId` is set, then sends the
 * Notification: `comment-reply` to the top-level comment's author, or
 * `lesson-comment` to the course's instructor. The commenter is never
 * notified of their own comment. Throws an `Error` with a displayable message
 * when the input is invalid. A Notifier that fails does not fail the comment.
 */
export async function createComment(
  db: Db,
  notifier: Notifier,
  userId: number,
  lessonId: number,
  parentId: number | null,
  body: string
) {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    throw new Error("Comment cannot be empty");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`
    );
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
    throw new Error("Lesson not found");
  }

  if (parentId !== null) {
    const parent = db
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.id, parentId))
      .get();
    if (!parent) {
      throw new Error("Parent comment not found");
    }
    if (parent.lessonId !== lessonId) {
      throw new Error("Parent comment belongs to a different lesson");
    }
    if (parent.parentId !== null) {
      throw new Error("Replies can only be one level deep");
    }
  }

  const comment = db
    .insert(schema.comments)
    .values({ userId, lessonId, parentId, body: trimmed })
    .returning()
    .get();

  const actor = getUser(db, userId);
  if (!actor) return comment;

  if (parentId !== null) {
    const parentAuthor = db
      .select({ userId: schema.comments.userId })
      .from(schema.comments)
      .where(eq(schema.comments.id, parentId))
      .get();
    const recipient = parentAuthor && getUser(db, parentAuthor.userId);
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

  return comment;
}

function getUser(db: Db, userId: number): NotificationUser | undefined {
  return db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
}
