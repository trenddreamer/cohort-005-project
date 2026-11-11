import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  canOpenRefundRequest,
  getCompletionFraction,
  getRefundRequest,
  getWatchedSeconds,
} from "./refunds.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

// ─── Factories ───

function buyCourse(createdAt: string, userId = base.user.id) {
  return db
    .insert(schema.purchases)
    .values({ userId, courseId: base.course.id, amountPaid: 4900, createdAt })
    .returning()
    .get();
}

function addLessons(count: number, courseId = base.course.id) {
  const mod = db
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 1 })
    .returning()
    .get();
  return Array.from({ length: count }, (_, i) =>
    db
      .insert(schema.lessons)
      .values({ moduleId: mod.id, title: `Lesson ${i + 1}`, position: i + 1 })
      .returning()
      .get()
  );
}

function addOtherCourse() {
  return db
    .insert(schema.courses)
    .values({
      title: "Other Course",
      slug: "other-course",
      description: "",
      salesCopy: "",
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

function watch(
  lessonId: number,
  positionSeconds: number,
  userId = base.user.id
) {
  db.insert(schema.videoWatchEvents)
    .values({ userId, lessonId, eventType: "progress", positionSeconds })
    .run();
}

// ─── Watched time ───

describe("getWatchedSeconds", () => {
  it("sums the furthest position reached in each lesson", () => {
    const [first, second] = addLessons(2);
    watch(first.id, 100);
    watch(first.id, 300);
    watch(first.id, 50); // rewatching the start doesn't reduce it
    watch(second.id, 200);

    expect(getWatchedSeconds(db, base.user.id, base.course.id)).toBe(500);
  });

  it("ignores other learners and other courses", () => {
    const [lesson] = addLessons(1);
    const [otherLesson] = addLessons(1, addOtherCourse().id);
    watch(lesson.id, 60);
    watch(lesson.id, 9000, base.instructor.id);
    watch(otherLesson.id, 9000);

    expect(getWatchedSeconds(db, base.user.id, base.course.id)).toBe(60);
  });

  it("is zero for a course with no lessons", () => {
    expect(getWatchedSeconds(db, base.user.id, base.course.id)).toBe(0);
  });
});

// ─── Completion ───

function complete(lessonId: number, userId = base.user.id) {
  db.insert(schema.lessonProgress)
    .values({
      userId,
      lessonId,
      status: schema.LessonProgressStatus.Completed,
      completedAt: "2026-03-01T12:00:00",
    })
    .run();
}

describe("getCompletionFraction", () => {
  it("is completed lessons divided by the course's lessons", () => {
    const [a, b, c] = addLessons(4);
    complete(a.id);
    db.insert(schema.lessonProgress)
      .values({
        userId: base.user.id,
        lessonId: b.id,
        status: schema.LessonProgressStatus.InProgress,
      })
      .run();
    complete(c.id, base.instructor.id); // someone else's progress

    expect(getCompletionFraction(db, base.user.id, base.course.id)).toBe(0.25);
  });

  it("is zero for a course with no lessons", () => {
    expect(getCompletionFraction(db, base.user.id, base.course.id)).toBe(0);
  });
});

// ─── Eligibility ───

describe("canOpenRefundRequest", () => {
  it("lets a learner who just bought the course open a Refund Request", () => {
    const purchase = buyCourse("2026-03-01T10:00:00");

    const result = canOpenRefundRequest(
      db,
      purchase,
      base.user,
      new Date("2026-03-02T10:00:00")
    );

    expect(result).toEqual({ eligible: true });
  });

  // ─── Refund Window ───

  // The window counts calendar days, so a late-evening purchase still gets
  // the whole of its fourteenth day.
  it("is still eligible on the fourteenth day after purchase", () => {
    const purchase = buyCourse("2026-03-01T23:00:00");

    const result = canOpenRefundRequest(
      db,
      purchase,
      base.user,
      new Date("2026-03-15T23:59:00")
    );

    expect(result).toEqual({ eligible: true });
  });

  it("refuses once the Refund Window has closed", () => {
    const purchase = buyCourse("2026-03-01T23:00:00");

    const result = canOpenRefundRequest(
      db,
      purchase,
      base.user,
      new Date("2026-03-16T00:01:00")
    );

    expect(result).toEqual({
      eligible: false,
      reason: "outside-refund-window",
    });
  });

  // ─── Watch Limit ───

  it("is eligible just under the Watch Limit", () => {
    const [first, second] = addLessons(4);
    watch(first.id, 3600);
    watch(second.id, 3599);
    const purchase = buyCourse("2026-03-01T10:00:00");

    expect(
      canOpenRefundRequest(
        db,
        purchase,
        base.user,
        new Date("2026-03-02T10:00:00")
      )
    ).toEqual({ eligible: true });
  });

  it("refuses at exactly the Watch Limit of two hours", () => {
    const [first, second] = addLessons(4);
    watch(first.id, 3600);
    watch(second.id, 3600);
    const purchase = buyCourse("2026-03-01T10:00:00");

    expect(
      canOpenRefundRequest(
        db,
        purchase,
        base.user,
        new Date("2026-03-02T10:00:00")
      )
    ).toEqual({ eligible: false, reason: "watch-limit-reached" });
  });

  // ─── Completion Limit ───

  it("is eligible just under the Completion Limit", () => {
    const lessons = addLessons(3);
    complete(lessons[0].id);
    const purchase = buyCourse("2026-03-01T10:00:00");

    expect(
      canOpenRefundRequest(
        db,
        purchase,
        base.user,
        new Date("2026-03-02T10:00:00")
      )
    ).toEqual({ eligible: true });
  });

  it("refuses at exactly the Completion Limit of half the lessons", () => {
    const lessons = addLessons(4);
    complete(lessons[0].id);
    complete(lessons[1].id);
    const purchase = buyCourse("2026-03-01T10:00:00");

    expect(
      canOpenRefundRequest(
        db,
        purchase,
        base.user,
        new Date("2026-03-02T10:00:00")
      )
    ).toEqual({ eligible: false, reason: "completion-limit-reached" });
  });

  // ─── Claimed Seat ───

  function addSeat(purchaseId: number, code: string, claimedBy: number | null) {
    const team = db.insert(schema.teams).values({}).returning().get();
    db.insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code,
        purchaseId,
        redeemedByUserId: claimedBy,
        redeemedAt: claimedBy === null ? null : "2026-03-01T12:00:00",
      })
      .run();
  }

  it("is eligible for a team purchase whose seats are all unclaimed", () => {
    const purchase = buyCourse("2026-03-01T10:00:00");
    addSeat(purchase.id, "SEAT-1", null);

    expect(
      canOpenRefundRequest(
        db,
        purchase,
        base.user,
        new Date("2026-03-02T10:00:00")
      )
    ).toEqual({ eligible: true });
  });

  // One claimed seat makes the whole team purchase ineligible.
  it("refuses a team purchase with a Claimed Seat", () => {
    const purchase = buyCourse("2026-03-01T10:00:00");
    addSeat(purchase.id, "SEAT-1", null);
    addSeat(purchase.id, "SEAT-2", base.instructor.id);

    expect(
      canOpenRefundRequest(
        db,
        purchase,
        base.user,
        new Date("2026-03-02T10:00:00")
      )
    ).toEqual({ eligible: false, reason: "claimed-seat" });
  });

  // ─── One Refund Request per purchase ───

  function addRefundRequest(purchaseId: number, status: schema.RefundStatus) {
    db.insert(schema.refunds)
      .values({ purchaseId, status, reason: "Not what I expected" })
      .run();
  }

  it("refuses when an Open Refund Request already exists on the purchase", () => {
    const purchase = buyCourse("2026-03-01T10:00:00");
    addRefundRequest(purchase.id, schema.RefundStatus.Requested);

    expect(
      canOpenRefundRequest(
        db,
        purchase,
        base.user,
        new Date("2026-03-02T10:00:00")
      )
    ).toEqual({ eligible: false, reason: "refund-request-exists" });
  });

  // Once Declined, the learner can't ask again on the same purchase.
  it("refuses when the purchase's Refund Request was Declined", () => {
    const purchase = buyCourse("2026-03-01T10:00:00");
    addRefundRequest(purchase.id, schema.RefundStatus.Declined);

    expect(
      canOpenRefundRequest(
        db,
        purchase,
        base.user,
        new Date("2026-03-02T10:00:00")
      )
    ).toEqual({ eligible: false, reason: "refund-request-exists" });
  });

  it("refuses when the purchase's Refund Request was Approved", () => {
    const purchase = buyCourse("2026-03-01T10:00:00");
    addRefundRequest(purchase.id, schema.RefundStatus.Approved);

    expect(
      canOpenRefundRequest(
        db,
        purchase,
        base.user,
        new Date("2026-03-02T10:00:00")
      )
    ).toEqual({ eligible: false, reason: "refund-request-exists" });
  });

  // A refunded learner who buys again gets a fresh purchase, judged on its
  // own Refund Request rather than the earlier one.
  it("lets a refunded learner's later purchase of the same course be eligible", () => {
    const refunded = buyCourse("2026-03-01T10:00:00");
    addRefundRequest(refunded.id, schema.RefundStatus.Approved);
    const rebought = buyCourse("2026-03-20T10:00:00");

    expect(
      canOpenRefundRequest(
        db,
        rebought,
        base.user,
        new Date("2026-03-21T10:00:00")
      )
    ).toEqual({ eligible: true });
  });

  it("refuses before the day of purchase", () => {
    const purchase = buyCourse("2026-03-10T10:00:00");

    const result = canOpenRefundRequest(
      db,
      purchase,
      base.user,
      new Date("2026-03-09T10:00:00")
    );

    expect(result).toEqual({
      eligible: false,
      reason: "outside-refund-window",
    });
  });
});

// ─── Refund Request lookup ───

describe("getRefundRequest", () => {
  // The course page badge needs the request whatever its status.
  it("finds a purchase's resolved Refund Request", () => {
    const purchase = buyCourse("2026-03-01T10:00:00");
    db.insert(schema.refunds)
      .values({
        purchaseId: purchase.id,
        status: schema.RefundStatus.Declined,
        reason: "Not what I expected",
      })
      .run();

    expect(getRefundRequest(db, purchase.id)?.status).toBe(
      schema.RefundStatus.Declined
    );
  });

  it("finds nothing on a purchase without a Refund Request", () => {
    const purchase = buyCourse("2026-03-01T10:00:00");

    expect(getRefundRequest(db, purchase.id)).toBeUndefined();
  });
});
