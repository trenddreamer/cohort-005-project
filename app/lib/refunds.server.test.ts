import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  approveRefundRequest,
  canOpenRefundRequest,
  declineRefundRequest,
  getCompletionFraction,
  getRefundRequest,
  getWatchedSeconds,
  listRefundRequests,
} from "./refunds.server";
import { getSeatCode, redeemSeatCode } from "./seat-codes.server";

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

// ─── Team purchases ───

function addMember(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: schema.UserRole.Student,
    })
    .returning()
    .get();
}

// A team purchase: the buyer gets seat codes, not an enrollment. Under the
// eligibility rules its Refund Request was opened while no seat was claimed.
function openTeamRefundRequest(seatCount: number) {
  const purchase = buyCourse("2026-03-01T10:00:00");
  const team = db.insert(schema.teams).values({}).returning().get();
  const codes = Array.from({ length: seatCount }, (_, i) => {
    const code = `SEAT-${i + 1}`;
    db.insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code,
        purchaseId: purchase.id,
      })
      .run();
    return code;
  });
  const request = db
    .insert(schema.refunds)
    .values({
      purchaseId: purchase.id,
      reason: "Team changed plans",
      requestedAt: "2026-03-02T09:00:00.000Z",
    })
    .returning()
    .get();
  return { purchase, request, codes };
}

// A member claims a seat (as the redeem page does) while the request is Open.
function claimSeat(code: string, userId: number, claimedAt: string) {
  db.update(schema.coupons)
    .set({ redeemedByUserId: userId, redeemedAt: claimedAt })
    .where(eq(schema.coupons.code, code))
    .run();
  db.insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
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

// ─── Listing Refund Requests ───

describe("listRefundRequests", () => {
  function requestRefund(
    purchaseId: number,
    requestedAt: string,
    status = schema.RefundStatus.Requested
  ) {
    return db
      .insert(schema.refunds)
      .values({ purchaseId, reason: "Not what I expected", requestedAt, status })
      .returning()
      .get();
  }

  it("lists an Open Refund Request with the learner, course, reason and Refundable Amount", () => {
    const purchase = buyCourse("2026-03-01T10:00:00");
    const request = requestRefund(purchase.id, "2026-03-02T09:00:00");

    expect(
      listRefundRequests(db, schema.RefundStatus.Requested)
    ).toMatchObject([
      {
        id: request.id,
        status: schema.RefundStatus.Requested,
        purchaseId: purchase.id,
        learner: { id: base.user.id, name: "Test User", email: "test@example.com" },
        course: { id: base.course.id, title: "Test Course" },
        reason: "Not what I expected",
        requestedAt: "2026-03-02T09:00:00",
        refundableAmount: 4900,
      },
    ]);
  });

  it("marks a solo purchase as not a team purchase, with no seats", () => {
    requestRefund(buyCourse("2026-03-01T10:00:00").id, "2026-03-02T09:00:00");

    expect(listRefundRequests(db, schema.RefundStatus.Requested)).toMatchObject(
      [
        {
          isTeamPurchase: false,
          seatCount: 0,
          claimedSeatCount: 0,
          claimedSeatsSinceRequested: 0,
        },
      ]
    );
  });

  // The admin sees who loses access on approval: seats claimed while the
  // request was Open are counted separately for the confirmation warning.
  it("shows a team purchase's seat count, Claimed Seats, and seats claimed since the request was opened", () => {
    const { codes } = openTeamRefundRequest(4);
    claimSeat(codes[0], addMember("Early").id, "2026-03-01T12:00:00.000Z");
    claimSeat(codes[1], addMember("Olivia").id, "2026-03-03T10:00:00.000Z");
    claimSeat(codes[2], addMember("Liam").id, "2026-03-04T10:00:00.000Z");

    expect(listRefundRequests(db, schema.RefundStatus.Requested)).toMatchObject(
      [
        {
          refundableAmount: 4900,
          isTeamPurchase: true,
          seatCount: 4,
          claimedSeatCount: 3,
          claimedSeatsSinceRequested: 2,
        },
      ]
    );
  });

  // The learner who has waited longest is first in line.
  it("lists only Open requests, oldest first", () => {
    const newest = requestRefund(
      buyCourse("2026-03-01T10:00:00").id,
      "2026-03-05T09:00:00"
    );
    const oldest = requestRefund(
      buyCourse("2026-03-01T11:00:00").id,
      "2026-03-02T09:00:00"
    );
    requestRefund(
      buyCourse("2026-03-01T12:00:00").id,
      "2026-03-01T09:00:00",
      schema.RefundStatus.Declined
    );
    requestRefund(
      buyCourse("2026-03-01T13:00:00").id,
      "2026-03-01T08:00:00",
      schema.RefundStatus.Approved
    );

    expect(
      listRefundRequests(db, schema.RefundStatus.Requested).map((r) => r.id)
    ).toEqual([oldest.id, newest.id]);
  });

  // The admin refunds by hand exactly what the list says, so it must be what
  // the learner paid, not whatever the course costs today.
  it("shows the amount paid as the Refundable Amount after the list price changes", () => {
    db.update(schema.courses).set({ price: 4900 }).run();
    const purchase = buyCourse("2026-03-01T10:00:00");
    requestRefund(purchase.id, "2026-03-02T09:00:00");
    db.update(schema.courses).set({ price: 9900 }).run();

    const [item] = listRefundRequests(db, schema.RefundStatus.Requested);
    expect(item.refundableAmount).toBe(4900);
  });

  // ─── Usage and limit warnings ───

  it("shows the learner's current watched time and completion, under the limits", () => {
    const [a, b] = addLessons(4);
    watch(a.id, 1800);
    watch(b.id, 1800);
    complete(a.id);
    requestRefund(buyCourse("2026-03-01T10:00:00").id, "2026-03-02T09:00:00");

    expect(
      listRefundRequests(db, schema.RefundStatus.Requested)[0]
    ).toMatchObject({
      watchedSeconds: 3600,
      completionFraction: 0.25,
      isOverWatchLimit: false,
      isOverCompletionLimit: false,
    });
  });

  // Exactly at a limit counts as over it, matching eligibility.
  it("flags watched time and completion at the Watch Limit and Completion Limit", () => {
    const [a, b] = addLessons(2);
    watch(a.id, 3600);
    watch(b.id, 3600);
    complete(a.id);
    requestRefund(buyCourse("2026-03-01T10:00:00").id, "2026-03-02T09:00:00");

    expect(
      listRefundRequests(db, schema.RefundStatus.Requested)[0]
    ).toMatchObject({
      watchedSeconds: 7200,
      completionFraction: 0.5,
      isOverWatchLimit: true,
      isOverCompletionLimit: true,
    });
  });

  // Usage is per learner and per course: another learner's progress, or the
  // same learner's progress on another course, doesn't count.
  it("counts only the requesting learner's usage of the purchased course", () => {
    const [lesson] = addLessons(1);
    const otherCourse = addOtherCourse();
    const [otherLesson] = addLessons(1, otherCourse.id);
    watch(lesson.id, 7200, base.instructor.id);
    complete(lesson.id, base.instructor.id);
    watch(otherLesson.id, 7200);
    complete(otherLesson.id);
    requestRefund(buyCourse("2026-03-01T10:00:00").id, "2026-03-02T09:00:00");

    expect(
      listRefundRequests(db, schema.RefundStatus.Requested)[0]
    ).toMatchObject({
      watchedSeconds: 0,
      completionFraction: 0,
      isOverWatchLimit: false,
      isOverCompletionLimit: false,
    });
  });
});

// ─── Declining a Refund Request ───

describe("declineRefundRequest", () => {
  const now = new Date("2026-03-05T15:30:00.000Z");

  function addAdmin() {
    return db
      .insert(schema.users)
      .values({
        name: "Test Admin",
        email: "admin@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();
  }

  function openRefundRequest(status = schema.RefundStatus.Requested) {
    const purchase = buyCourse("2026-03-01T10:00:00");
    return db
      .insert(schema.refunds)
      .values({ purchaseId: purchase.id, reason: "Not for me", status })
      .returning()
      .get();
  }

  function findRefundRequest(id: number) {
    return db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, id))
      .get();
  }

  it("marks an Open Refund Request Declined, recording who declined it and when", () => {
    const admin = addAdmin();
    const request = openRefundRequest();

    expect(declineRefundRequest(db, request.id, admin.id, now)).toEqual({
      ok: true,
    });
    expect(findRefundRequest(request.id)).toMatchObject({
      status: schema.RefundStatus.Declined,
      resolvedByUserId: admin.id,
      resolvedAt: "2026-03-05T15:30:00.000Z",
      amountRefunded: null,
    });
  });

  // Declining changes nothing but the status: the learner keeps access and
  // progress, the purchase still counts, and team seat codes still work.
  it("leaves enrollments, seat codes, progress and the purchase unchanged", () => {
    const admin = addAdmin();
    const [lesson] = addLessons(1);
    const request = openRefundRequest();
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    const team = db.insert(schema.teams).values({}).returning().get();
    db.insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: "SEAT-1",
        purchaseId: request.purchaseId,
      })
      .run();
    complete(lesson.id);
    watch(lesson.id, 600);

    const snapshot = () => ({
      enrollments: db.select().from(schema.enrollments).all(),
      coupons: db.select().from(schema.coupons).all(),
      lessonProgress: db.select().from(schema.lessonProgress).all(),
      videoWatchEvents: db.select().from(schema.videoWatchEvents).all(),
      purchases: db.select().from(schema.purchases).all(),
    });
    const before = snapshot();

    expect(declineRefundRequest(db, request.id, admin.id, now)).toEqual({
      ok: true,
    });
    expect(snapshot()).toEqual(before);
    expect(before.enrollments).toHaveLength(1);
    expect(before.coupons).toHaveLength(1);
  });

  it("reports a Refund Request that doesn't exist", () => {
    const admin = addAdmin();

    expect(declineRefundRequest(db, 999, admin.id, now)).toEqual({
      ok: false,
      error: "not-found",
    });
  });

  // Two admins act on the same request: the second finds it already resolved,
  // and the first admin's decision stands.
  it("refuses a request another admin already declined, changing nothing", () => {
    const firstAdmin = addAdmin();
    const secondAdmin = db
      .insert(schema.users)
      .values({
        name: "Second Admin",
        email: "admin2@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();
    const request = openRefundRequest();
    declineRefundRequest(db, request.id, firstAdmin.id, now);

    expect(
      declineRefundRequest(
        db,
        request.id,
        secondAdmin.id,
        new Date("2026-03-05T15:31:00.000Z")
      )
    ).toEqual({ ok: false, error: "already-resolved" });
    expect(findRefundRequest(request.id)).toMatchObject({
      status: schema.RefundStatus.Declined,
      resolvedByUserId: firstAdmin.id,
      resolvedAt: "2026-03-05T15:30:00.000Z",
    });
  });

  // A resolution is final: an Approved request never becomes Declined.
  it("refuses to decline an Approved request, changing nothing", () => {
    const admin = addAdmin();
    const request = openRefundRequest(schema.RefundStatus.Approved);

    expect(declineRefundRequest(db, request.id, admin.id, now)).toEqual({
      ok: false,
      error: "already-resolved",
    });
    expect(findRefundRequest(request.id)).toMatchObject({
      status: schema.RefundStatus.Approved,
      resolvedByUserId: null,
      resolvedAt: null,
    });
  });

  // Only an admin resolves a Refund Request.
  it.each([
    ["an instructor", () => base.instructor.id],
    ["a student", () => base.user.id],
  ])("refuses %s, leaving the request Open", (_, actingUserId) => {
    const request = openRefundRequest();

    expect(declineRefundRequest(db, request.id, actingUserId(), now)).toEqual({
      ok: false,
      error: "not-an-admin",
    });
    expect(findRefundRequest(request.id)).toMatchObject({
      status: schema.RefundStatus.Requested,
      resolvedByUserId: null,
      resolvedAt: null,
    });
  });
});

// ─── Approving a Refund Request ───

describe("approveRefundRequest", () => {
  const now = new Date("2026-03-05T15:30:00.000Z");

  function addAdmin() {
    return db
      .insert(schema.users)
      .values({
        name: "Test Admin",
        email: "admin@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();
  }

  // A solo purchase: the learner bought it and was enrolled by it.
  function openSoloRefundRequest(status = schema.RefundStatus.Requested) {
    const purchase = buyCourse("2026-03-01T10:00:00");
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    return db
      .insert(schema.refunds)
      .values({ purchaseId: purchase.id, reason: "Not for me", status })
      .returning()
      .get();
  }

  function findRefundRequest(id: number) {
    return db
      .select()
      .from(schema.refunds)
      .where(eq(schema.refunds.id, id))
      .get();
  }

  it("marks an Open Refund Request Approved, recording who approved it, when, and the Amount Refunded", () => {
    const admin = addAdmin();
    const request = openSoloRefundRequest();

    expect(approveRefundRequest(db, request.id, admin.id, now)).toEqual({
      ok: true,
    });
    expect(findRefundRequest(request.id)).toMatchObject({
      status: schema.RefundStatus.Approved,
      resolvedByUserId: admin.id,
      resolvedAt: "2026-03-05T15:30:00.000Z",
      amountRefunded: 4900,
    });
  });

  function enrollmentsOf(userId: number) {
    return db
      .select({ courseId: schema.enrollments.courseId })
      .from(schema.enrollments)
      .where(eq(schema.enrollments.userId, userId))
      .all();
  }

  // ADR 0001: access is "an enrollment row exists", so Approve deletes it.
  // Progress is keyed by user and lesson, so it survives for a re-buy.
  it("removes the learner's enrollment for the course and keeps their progress", () => {
    const admin = addAdmin();
    const [lesson] = addLessons(1);
    const otherCourse = addOtherCourse();
    const request = openSoloRefundRequest();
    db.insert(schema.enrollments)
      .values([
        { userId: base.user.id, courseId: otherCourse.id },
        { userId: base.instructor.id, courseId: base.course.id },
      ])
      .run();
    complete(lesson.id);
    watch(lesson.id, 600);
    const progressBefore = db.select().from(schema.lessonProgress).all();
    const watchEventsBefore = db.select().from(schema.videoWatchEvents).all();

    expect(approveRefundRequest(db, request.id, admin.id, now)).toEqual({
      ok: true,
    });
    expect(enrollmentsOf(base.user.id)).toEqual([{ courseId: otherCourse.id }]);
    expect(enrollmentsOf(base.instructor.id)).toEqual([
      { courseId: base.course.id },
    ]);
    expect(db.select().from(schema.lessonProgress).all()).toEqual(
      progressBefore
    );
    expect(db.select().from(schema.videoWatchEvents).all()).toEqual(
      watchEventsBefore
    );
    expect(progressBefore).toHaveLength(1);
    expect(watchEventsBefore).toHaveLength(1);
  });

  // The learner gets back what they paid, even if the price has moved since.
  it("records Amount Refunded as the amount paid, not the course's current list price", () => {
    const admin = addAdmin();
    const request = openSoloRefundRequest();
    db.update(schema.courses)
      .set({ price: 9900 })
      .where(eq(schema.courses.id, base.course.id))
      .run();

    approveRefundRequest(db, request.id, admin.id, now);

    expect(findRefundRequest(request.id)?.amountRefunded).toBe(4900);
  });

  it("reports a Refund Request that doesn't exist", () => {
    const admin = addAdmin();

    expect(approveRefundRequest(db, 999, admin.id, now)).toEqual({
      ok: false,
      error: "not-found",
    });
  });

  // A resolution is final: a Declined request never becomes Approved, and the
  // learner keeps the access Decline left them.
  it.each([
    ["Declined", schema.RefundStatus.Declined],
    ["already Approved", schema.RefundStatus.Approved],
  ])("refuses a request that is %s, changing nothing", (_, status) => {
    const admin = addAdmin();
    const request = openSoloRefundRequest(status);

    expect(approveRefundRequest(db, request.id, admin.id, now)).toEqual({
      ok: false,
      error: "already-resolved",
    });
    expect(findRefundRequest(request.id)).toMatchObject({
      status,
      resolvedByUserId: null,
      resolvedAt: null,
      amountRefunded: null,
    });
    expect(enrollmentsOf(base.user.id)).toEqual([{ courseId: base.course.id }]);
  });

  it("removes every member's enrollment from a team purchase whose seats were claimed while the request was Open, keeping their progress", () => {
    const admin = addAdmin();
    const [lesson] = addLessons(1);
    const otherCourse = addOtherCourse();
    const olivia = addMember("Olivia");
    const liam = addMember("Liam");
    const { request, codes } = openTeamRefundRequest(3);
    claimSeat(codes[0], olivia.id, "2026-03-03T10:00:00.000Z");
    claimSeat(codes[1], liam.id, "2026-03-04T10:00:00.000Z");
    db.insert(schema.enrollments)
      .values({ userId: olivia.id, courseId: otherCourse.id })
      .run();
    complete(lesson.id, olivia.id);
    watch(lesson.id, 600, liam.id);

    expect(approveRefundRequest(db, request.id, admin.id, now)).toEqual({
      ok: true,
    });
    expect(enrollmentsOf(olivia.id)).toEqual([{ courseId: otherCourse.id }]);
    expect(enrollmentsOf(liam.id)).toEqual([]);
    expect(db.select().from(schema.lessonProgress).all()).toHaveLength(1);
    expect(db.select().from(schema.videoWatchEvents).all()).toHaveLength(1);
    expect(findRefundRequest(request.id)?.amountRefunded).toBe(4900);
  });

  it("stops a team purchase's unclaimed seat codes from being claimed", () => {
    const admin = addAdmin();
    const olivia = addMember("Olivia");
    const liam = addMember("Liam");
    const { request, codes } = openTeamRefundRequest(3);
    claimSeat(codes[0], olivia.id, "2026-03-03T10:00:00.000Z");

    approveRefundRequest(db, request.id, admin.id, now);

    expect(redeemSeatCode(db, codes[1], liam.id, "", now)).toEqual({
      ok: false,
      error: "This seat code no longer works: its purchase was refunded",
    });
    expect(enrollmentsOf(liam.id)).toEqual([]);
    expect(getSeatCode(db, codes[1])).toMatchObject({
      redeemedByUserId: null,
      redeemedAt: null,
    });
  });

  // Only unclaimed seat codes become unclaimable: a Claimed Seat stays a seat
  // on the team's record, even though its member lost access.
  it("leaves a team purchase's Claimed Seats unvoided", () => {
    const admin = addAdmin();
    const olivia = addMember("Olivia");
    const { request, codes } = openTeamRefundRequest(2);
    claimSeat(codes[0], olivia.id, "2026-03-03T10:00:00.000Z");

    approveRefundRequest(db, request.id, admin.id, now);

    expect(getSeatCode(db, codes[0])).toMatchObject({
      redeemedByUserId: olivia.id,
      voidedAt: null,
    });
    expect(getSeatCode(db, codes[1])?.voidedAt).toBe(
      "2026-03-05T15:30:00.000Z"
    );
  });

  // Only an admin resolves a Refund Request.
  it.each([
    ["an instructor", () => base.instructor.id],
    ["a student", () => base.user.id],
  ])(
    "refuses %s, leaving the request Open and access in place",
    (_, actingUserId) => {
      const request = openSoloRefundRequest();

      expect(approveRefundRequest(db, request.id, actingUserId(), now)).toEqual(
        {
          ok: false,
          error: "not-an-admin",
        }
      );
      expect(findRefundRequest(request.id)).toMatchObject({
        status: schema.RefundStatus.Requested,
        resolvedByUserId: null,
        resolvedAt: null,
        amountRefunded: null,
      });
      expect(enrollmentsOf(base.user.id)).toEqual([
        { courseId: base.course.id },
      ]);
    }
  );
});

// ─── Listing resolved Refund Requests ───

describe("listRefundRequests for resolved requests", () => {
  function addAdmin(name: string, email: string) {
    return db
      .insert(schema.users)
      .values({ name, email, role: schema.UserRole.Admin })
      .returning()
      .get();
  }

  function openRefundRequest(purchasedAt: string, requestedAt: string) {
    const purchase = buyCourse(purchasedAt);
    return db
      .insert(schema.refunds)
      .values({ purchaseId: purchase.id, reason: "Not for me", requestedAt })
      .returning()
      .get();
  }

  // The admin looking back wants what was just resolved at the top, whatever
  // order the requests came in.
  it("lists Declined requests most recently resolved first, with who resolved them and when", () => {
    const ada = addAdmin("Ada Admin", "ada@example.com");
    const bo = addAdmin("Bo Admin", "bo@example.com");
    // Requested first but declined first too, so it ends up last.
    const declinedFirst = openRefundRequest(
      "2026-03-01T10:00:00",
      "2026-03-02T09:00:00"
    );
    const declinedLast = openRefundRequest(
      "2026-03-01T11:00:00",
      "2026-03-05T09:00:00"
    );
    const stillOpen = openRefundRequest(
      "2026-03-01T12:00:00",
      "2026-03-03T09:00:00"
    );
    declineRefundRequest(
      db,
      declinedFirst.id,
      ada.id,
      new Date("2026-03-06T10:00:00.000Z")
    );
    declineRefundRequest(
      db,
      declinedLast.id,
      bo.id,
      new Date("2026-03-07T10:00:00.000Z")
    );

    const declined = listRefundRequests(db, schema.RefundStatus.Declined);

    expect(declined.map((r) => r.id)).not.toContain(stillOpen.id);
    expect(declined).toMatchObject([
      {
        id: declinedLast.id,
        status: schema.RefundStatus.Declined,
        learner: { id: base.user.id, name: "Test User" },
        course: { id: base.course.id, title: "Test Course" },
        reason: "Not for me",
        resolvedBy: { id: bo.id, name: "Bo Admin" },
        resolvedAt: "2026-03-07T10:00:00.000Z",
        amountRefunded: null,
      },
      {
        id: declinedFirst.id,
        resolvedBy: { id: ada.id, name: "Ada Admin" },
        resolvedAt: "2026-03-06T10:00:00.000Z",
      },
    ]);
  });

  it("lists Approved requests most recently resolved first, with the Amount Refunded", () => {
    const ada = addAdmin("Ada Admin", "ada@example.com");
    const approvedFirst = openRefundRequest(
      "2026-03-01T10:00:00",
      "2026-03-02T09:00:00"
    );
    const approvedLast = openRefundRequest(
      "2026-03-01T11:00:00",
      "2026-03-05T09:00:00"
    );
    const declined = openRefundRequest(
      "2026-03-01T12:00:00",
      "2026-03-03T09:00:00"
    );
    approveRefundRequest(
      db,
      approvedFirst.id,
      ada.id,
      new Date("2026-03-06T10:00:00.000Z")
    );
    approveRefundRequest(
      db,
      approvedLast.id,
      ada.id,
      new Date("2026-03-07T10:00:00.000Z")
    );
    declineRefundRequest(
      db,
      declined.id,
      ada.id,
      new Date("2026-03-08T10:00:00.000Z")
    );
    // Amount Refunded is what was paid, whatever the course costs now.
    db.update(schema.courses).set({ price: 9900 }).run();

    expect(listRefundRequests(db, schema.RefundStatus.Approved)).toMatchObject([
      {
        id: approvedLast.id,
        status: schema.RefundStatus.Approved,
        resolvedBy: { id: ada.id, name: "Ada Admin" },
        resolvedAt: "2026-03-07T10:00:00.000Z",
        amountRefunded: 4900,
      },
      {
        id: approvedFirst.id,
        resolvedAt: "2026-03-06T10:00:00.000Z",
        amountRefunded: 4900,
      },
    ]);
  });

  // Voided seat codes are no longer seats, so the admin's seat count drops
  // them, but the purchase was still bought for a team.
  it("counts only the Claimed Seats of an Approved team purchase, still marking it a team purchase", () => {
    const ada = addAdmin("Ada Admin", "ada@example.com");
    const olivia = addMember("Olivia");
    const { request, codes } = openTeamRefundRequest(3);
    claimSeat(codes[0], olivia.id, "2026-03-03T10:00:00.000Z");
    approveRefundRequest(
      db,
      request.id,
      ada.id,
      new Date("2026-03-06T10:00:00.000Z")
    );

    expect(listRefundRequests(db, schema.RefundStatus.Approved)).toMatchObject([
      { isTeamPurchase: true, seatCount: 1, claimedSeatCount: 1 },
    ]);
  });

  // With no seat claimed, every code is voided and there are no seats left,
  // yet it is still a team purchase, not a solo one.
  it("still marks an Approved team purchase with no Claimed Seats as a team purchase", () => {
    const ada = addAdmin("Ada Admin", "ada@example.com");
    const { request } = openTeamRefundRequest(2);
    approveRefundRequest(
      db,
      request.id,
      ada.id,
      new Date("2026-03-06T10:00:00.000Z")
    );

    expect(listRefundRequests(db, schema.RefundStatus.Approved)).toMatchObject([
      { isTeamPurchase: true, seatCount: 0, claimedSeatCount: 0 },
    ]);
  });

  it("lists an Open request with no resolver, resolved-at or Amount Refunded", () => {
    openRefundRequest("2026-03-01T10:00:00", "2026-03-02T09:00:00");

    expect(listRefundRequests(db, schema.RefundStatus.Requested)).toMatchObject(
      [{ resolvedBy: null, resolvedAt: null, amountRefunded: null }]
    );
  });
});
