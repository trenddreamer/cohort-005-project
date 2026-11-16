import { describe, it, expect, beforeEach, vi } from "vitest";
import * as schema from "~/db/schema";
import { createComment } from "~/lib/comments.server";
import type { Notifier } from "~/lib/notifier.server";
import { MAX_COMMENT_LENGTH } from "~/lib/comments";
import { createRecordingNotifier } from "~/test/recording-notifier";
import { createTestDb, seedBaseData } from "~/test/setup";

let db: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  const mod = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module 1", position: 1 })
    .returning()
    .get();
  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "Intro Lesson", position: 1 })
    .returning()
    .get().id;
});

/** Creates a comment that is expected to be valid. */
async function post(
  notifier: Notifier,
  userId: number,
  inLessonId: number,
  parentId: number | null,
  body: string
) {
  const result = await createComment(
    db,
    notifier,
    userId,
    inLessonId,
    parentId,
    body
  );
  if (!result.ok) throw new Error(result.error);
  return result.comment;
}

function addLearner(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name}@example.com`,
      role: schema.UserRole.Student,
    })
    .returning()
    .get();
}

describe("createComment: replies", () => {
  it("sends comment-reply to the top-level comment's author", async () => {
    const notifier = createRecordingNotifier();
    const question = await post(
      notifier,
      base.user.id,
      lessonId,
      null,
      "How does this work?"
    );
    notifier.sent.length = 0;

    const reply = await post(
      notifier,
      base.instructor.id,
      lessonId,
      question.id,
      "**Like** this."
    );

    expect(notifier.sent).toEqual([
      {
        kind: "comment-reply",
        recipientIds: [base.user.id],
        actor: {
          id: base.instructor.id,
          name: "Test Instructor",
          avatarUrl: null,
        },
        data: {
          lesson_title: "Intro Lesson",
          course_slug: "test-course",
          lesson_id: lessonId,
          comment_id: reply.id,
          excerpt: "Like this.",
        },
      },
    ]);
  });

  it("sends nothing when a learner replies in their own thread", async () => {
    const notifier = createRecordingNotifier();
    const question = await post(
      notifier,
      base.user.id,
      lessonId,
      null,
      "Question"
    );
    notifier.sent.length = 0;
    await post(notifier, base.user.id, lessonId, question.id, "Me again");
    expect(notifier.sent).toEqual([]);
  });

  it("notifies only the top-level author, not the instructor or other repliers", async () => {
    const notifier = createRecordingNotifier();
    const other = addLearner("Other");
    const question = await post(
      notifier,
      base.user.id,
      lessonId,
      null,
      "Question"
    );
    await post(notifier, other.id, lessonId, question.id, "First");
    notifier.sent.length = 0;
    await post(notifier, base.instructor.id, lessonId, question.id, "Answer");
    expect(notifier.sent.map((n) => [n.kind, n.recipientIds])).toEqual([
      ["comment-reply", [base.user.id]],
    ]);
  });
});

describe("createComment: top-level comments", () => {
  it("sends lesson-comment to the course's instructor", async () => {
    const notifier = createRecordingNotifier();
    const comment = await post(
      notifier,
      base.user.id,
      lessonId,
      null,
      "Great lesson"
    );
    expect(notifier.sent).toEqual([
      {
        kind: "lesson-comment",
        recipientIds: [base.instructor.id],
        actor: { id: base.user.id, name: "Test User", avatarUrl: null },
        data: {
          lesson_title: "Intro Lesson",
          course_title: "Test Course",
          course_slug: "test-course",
          lesson_id: lessonId,
          comment_id: comment.id,
          excerpt: "Great lesson",
        },
      },
    ]);
  });

  it("sends nothing when the instructor comments on their own Lesson", async () => {
    const notifier = createRecordingNotifier();
    await post(notifier, base.instructor.id, lessonId, null, "Note");
    expect(notifier.sent).toEqual([]);
  });

  it("keeps the excerpt to plain text of about 140 characters", async () => {
    const notifier = createRecordingNotifier();
    await post(
      notifier,
      base.user.id,
      lessonId,
      null,
      `# Hi\n\n${"word ".repeat(100)}`
    );
    const { excerpt } = notifier.sent[0].data as { excerpt: string };
    expect(excerpt.length).toBeLessThanOrEqual(140);
    expect(excerpt.startsWith("Hi word")).toBe(true);
  });
});

describe("createComment: failures", () => {
  it("still posts the comment when the Notifier throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const notifier = createRecordingNotifier({ failWith: new Error("down") });
    const comment = await post(notifier, base.user.id, lessonId, null, "Hello");
    expect(comment.body).toBe("Hello");
    expect(db.select().from(schema.comments).all()).toHaveLength(1);
    spy.mockRestore();
  });

  it("returns the message for bad input, without saving or sending", async () => {
    const notifier = createRecordingNotifier();
    const results = [
      await createComment(db, notifier, base.user.id, lessonId, null, "   "),
      await createComment(db, notifier, base.user.id, 9999, null, "Hi"),
      await createComment(
        db,
        notifier,
        base.user.id,
        lessonId,
        null,
        "x".repeat(MAX_COMMENT_LENGTH + 1)
      ),
      await createComment(db, notifier, base.user.id, lessonId, 9999, "Hi"),
    ];
    expect(results).toEqual([
      { ok: false, error: "Comment cannot be empty" },
      { ok: false, error: "Lesson not found" },
      {
        ok: false,
        error: `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`,
      },
      { ok: false, error: "Parent comment not found" },
    ]);
    expect(db.select().from(schema.comments).all()).toEqual([]);
    expect(notifier.sent).toEqual([]);
  });

  it("refuses a reply to a reply", async () => {
    const notifier = createRecordingNotifier();
    const question = await post(notifier, base.user.id, lessonId, null, "Q");
    const reply = await post(
      notifier,
      base.user.id,
      lessonId,
      question.id,
      "R"
    );

    expect(
      await createComment(db, notifier, base.user.id, lessonId, reply.id, "RR")
    ).toEqual({ ok: false, error: "Replies can only be one level deep" });
  });
});
