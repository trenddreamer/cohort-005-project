import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import * as schema from "~/db/schema";

/** The app's drizzle instance, or a `createTestDb()` in tests. */
export type RefundsDb = BetterSQLite3Database<typeof schema>;

// ─── Eligibility limits (names from GLOSSARY.md) ───

/** Refund Window: calendar days from the day of purchase. */
export const REFUND_WINDOW_DAYS = 14;

/** Watch Limit: watched video at or above this blocks a Refund Request. */
export const MAX_WATCHED_HOURS = 2;
const MAX_WATCHED_SECONDS = MAX_WATCHED_HOURS * 60 * 60;

/** Completion Limit: this fraction of lessons completed blocks a Refund Request. */
export const COMPLETION_LIMIT = 0.5;

export type RefundIneligibleReason =
  | "refund-request-exists"
  | "claimed-seat"
  | "outside-refund-window"
  | "completion-limit-reached"
  | "watch-limit-reached";

export type RefundEligibility =
  { eligible: true } | { eligible: false; reason: RefundIneligibleReason };

type PurchaseForRefund = { id: number; courseId: number; createdAt: string };

// The window is counted in whole local calendar days, not hours — someone who
// buys at 23:00 still gets the whole of their fourteenth day.
function calendarDay(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

/** The last calendar day (YYYY-MM-DD) on which a Refund Request can be opened. */
export function lastDayOfRefundWindow(purchase: { createdAt: string }): string {
  const deadline = new Date(purchase.createdAt);
  deadline.setDate(deadline.getDate() + REFUND_WINDOW_DAYS);
  return calendarDay(deadline);
}

function isInsideRefundWindow(purchase: { createdAt: string }, now: Date) {
  const today = calendarDay(now);
  return (
    today >= calendarDay(new Date(purchase.createdAt)) &&
    today <= lastDayOfRefundWindow(purchase)
  );
}

// ─── Course usage ───

function getLessonIdsForCourse(db: RefundsDb, courseId: number): number[] {
  return db
    .select({ id: schema.lessons.id })
    .from(schema.lessons)
    .innerJoin(schema.modules, eq(schema.lessons.moduleId, schema.modules.id))
    .where(eq(schema.modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}

/**
 * Seconds of video `userId` has watched on a course: the furthest position
 * reached in each lesson, summed over the course's lessons.
 */
export function getWatchedSeconds(
  db: RefundsDb,
  userId: number,
  courseId: number
): number {
  const lessonIds = getLessonIdsForCourse(db, courseId);
  if (lessonIds.length === 0) return 0;

  const furthestPerLesson = db
    .select({
      furthest: sql<number>`max(${schema.videoWatchEvents.positionSeconds})`,
    })
    .from(schema.videoWatchEvents)
    .where(
      and(
        eq(schema.videoWatchEvents.userId, userId),
        inArray(schema.videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(schema.videoWatchEvents.lessonId)
    .all();

  return furthestPerLesson.reduce((total, row) => total + row.furthest, 0);
}

/**
 * Fraction (0–1) of a course's lessons `userId` has completed. Zero for a
 * course with no lessons.
 */
export function getCompletionFraction(
  db: RefundsDb,
  userId: number,
  courseId: number
): number {
  const lessonIds = getLessonIdsForCourse(db, courseId);
  if (lessonIds.length === 0) return 0;

  const completed = db
    .select({ count: sql<number>`count(*)` })
    .from(schema.lessonProgress)
    .where(
      and(
        eq(schema.lessonProgress.userId, userId),
        eq(schema.lessonProgress.status, schema.LessonProgressStatus.Completed),
        inArray(schema.lessonProgress.lessonId, lessonIds)
      )
    )
    .get();

  return (completed?.count ?? 0) / lessonIds.length;
}

// ─── Purchases and Refund Requests ───

/** The learner's most recent purchase of a course, if any. */
export function getLatestPurchase(
  db: RefundsDb,
  userId: number,
  courseId: number
) {
  return db
    .select()
    .from(schema.purchases)
    .where(
      and(
        eq(schema.purchases.userId, userId),
        eq(schema.purchases.courseId, courseId)
      )
    )
    .orderBy(desc(schema.purchases.createdAt))
    .get();
}

/**
 * The purchase's Refund Request, whatever its status, if it has one. Each
 * purchase gets one Refund Request.
 */
export function getRefundRequest(db: RefundsDb, purchaseId: number) {
  return db
    .select()
    .from(schema.refunds)
    .where(eq(schema.refunds.purchaseId, purchaseId))
    .orderBy(desc(schema.refunds.requestedAt))
    .get();
}

/** Whether any team seat on the purchase has been claimed. */
function hasClaimedSeat(db: RefundsDb, purchaseId: number): boolean {
  const claimedSeat = db
    .select({ id: schema.coupons.id })
    .from(schema.coupons)
    .where(
      and(
        eq(schema.coupons.purchaseId, purchaseId),
        isNotNull(schema.coupons.redeemedAt)
      )
    )
    .get();
  return claimedSeat !== undefined;
}

/** A purchase's team seat codes. A purchase with any is a team purchase. */
function getSeatCodes(db: RefundsDb | RefundsTx, purchaseId: number) {
  return db
    .select({
      redeemedByUserId: schema.coupons.redeemedByUserId,
      redeemedAt: schema.coupons.redeemedAt,
    })
    .from(schema.coupons)
    .where(eq(schema.coupons.purchaseId, purchaseId))
    .all();
}

// ─── Eligibility ───

/**
 * Whether `user` can open a Refund Request on `purchase` at `now`, or the
 * first reason they can't.
 */
export function canOpenRefundRequest(
  db: RefundsDb,
  purchase: PurchaseForRefund,
  user: { id: number },
  now: Date
): RefundEligibility {
  if (getRefundRequest(db, purchase.id)) {
    return { eligible: false, reason: "refund-request-exists" };
  }
  if (hasClaimedSeat(db, purchase.id)) {
    return { eligible: false, reason: "claimed-seat" };
  }
  if (!isInsideRefundWindow(purchase, now)) {
    return { eligible: false, reason: "outside-refund-window" };
  }
  if (
    getCompletionFraction(db, user.id, purchase.courseId) >= COMPLETION_LIMIT
  ) {
    return { eligible: false, reason: "completion-limit-reached" };
  }
  if (
    getWatchedSeconds(db, user.id, purchase.courseId) >= MAX_WATCHED_SECONDS
  ) {
    return { eligible: false, reason: "watch-limit-reached" };
  }
  return { eligible: true };
}

// ─── Listing Refund Requests ───

export type RefundRequestListItem = {
  id: number;
  /** Only an Open (`RefundStatus.Requested`) request can be resolved. */
  status: schema.RefundStatus;
  purchaseId: number;
  learner: { id: number; name: string; email: string };
  course: { id: number; title: string };
  reason: string;
  requestedAt: string;
  /** What the learner actually paid, never the course's current list price. */
  refundableAmount: number;
  /** The learner's watched time on the course now, not when they asked. */
  watchedSeconds: number;
  /** The learner's completion (0–1) of the course now. */
  completionFraction: number;
  /** At or over the Watch Limit. A warning for the admin, not a rule. */
  isOverWatchLimit: boolean;
  /** At or over the Completion Limit. A warning for the admin, not a rule. */
  isOverCompletionLimit: boolean;
  /** Bought as seat codes for a team, rather than by the learner for themselves. */
  isTeamPurchase: boolean;
  /** Seats the team purchase bought. Zero for a solo purchase. */
  seatCount: number;
  /** Seats a member has claimed. Approving removes each one's access. */
  claimedSeatCount: number;
  /** Claimed Seats taken after the request was opened, while it was Open. */
  claimedSeatsSinceRequested: number;
};

/**
 * Refund Requests with the given status (`RefundStatus.Requested` is Open),
 * oldest request first.
 */
export function listRefundRequests(
  db: RefundsDb,
  status: schema.RefundStatus
): RefundRequestListItem[] {
  const requests = db
    .select({
      id: schema.refunds.id,
      status: schema.refunds.status,
      purchaseId: schema.refunds.purchaseId,
      learner: {
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
      },
      course: { id: schema.courses.id, title: schema.courses.title },
      reason: schema.refunds.reason,
      requestedAt: schema.refunds.requestedAt,
      refundableAmount: schema.purchases.amountPaid,
    })
    .from(schema.refunds)
    .innerJoin(
      schema.purchases,
      eq(schema.refunds.purchaseId, schema.purchases.id)
    )
    .innerJoin(schema.users, eq(schema.purchases.userId, schema.users.id))
    .innerJoin(schema.courses, eq(schema.purchases.courseId, schema.courses.id))
    .where(eq(schema.refunds.status, status))
    .orderBy(asc(schema.refunds.requestedAt), asc(schema.refunds.id))
    .all();

  return requests.map((request) => {
    const watchedSeconds = getWatchedSeconds(
      db,
      request.learner.id,
      request.course.id
    );
    const completionFraction = getCompletionFraction(
      db,
      request.learner.id,
      request.course.id
    );
    const seatCodes = getSeatCodes(db, request.purchaseId);
    const seatCount = seatCodes.length;
    const claimedSeats = seatCodes.flatMap((seat) =>
      seat.redeemedAt === null ? [] : [seat.redeemedAt]
    );
    return {
      ...request,
      watchedSeconds,
      completionFraction,
      isOverWatchLimit: watchedSeconds >= MAX_WATCHED_SECONDS,
      isOverCompletionLimit: completionFraction >= COMPLETION_LIMIT,
      isTeamPurchase: seatCount > 0,
      seatCount,
      claimedSeatCount: claimedSeats.length,
      claimedSeatsSinceRequested: claimedSeats.filter(
        (claimedAt) => claimedAt >= request.requestedAt
      ).length,
    };
  });
}

// ─── Resolving Refund Requests ───

export type ResolveRefundRequestError =
  "not-an-admin" | "not-found" | "already-resolved";

export type ResolveRefundRequestResult =
  { ok: true } | { ok: false; error: ResolveRefundRequestError };

/** A transaction inside `RefundsDb.transaction`. */
type RefundsTx = Parameters<Parameters<RefundsDb["transaction"]>[0]>[0];

/**
 * Removes access from everyone who got it through the purchase by deleting
 * their enrollments for the course (ADR 0001). Lesson progress and watch
 * events are keyed by user and lesson, so they stay.
 *
 * A solo purchase enrolled its buyer. A team purchase (one with seat codes)
 * enrolled whoever claimed its seats, not its buyer.
 */
function revokeAccessFromPurchase(
  tx: RefundsTx,
  purchase: { id: number; userId: number; courseId: number },
  now: Date
) {
  const seatCodes = getSeatCodes(tx, purchase.id);
  const isTeamPurchase = seatCodes.length > 0;
  const userIdsWithAccess = isTeamPurchase
    ? seatCodes.flatMap((seat) =>
        seat.redeemedByUserId === null ? [] : [seat.redeemedByUserId]
      )
    : [purchase.userId];
  if (isTeamPurchase) {
    // Every seat code on the purchase stops counting as a seat, and the
    // unclaimed ones can no longer be claimed.
    tx.update(schema.coupons)
      .set({ voidedAt: now.toISOString() })
      .where(eq(schema.coupons.purchaseId, purchase.id))
      .run();
  }
  if (userIdsWithAccess.length === 0) return;

  tx.delete(schema.enrollments)
    .where(
      and(
        inArray(schema.enrollments.userId, userIdsWithAccess),
        eq(schema.enrollments.courseId, purchase.courseId)
      )
    )
    .run();
}

// Runs after the request has moved from Open to Approved, in that transaction.
function recordApproval(tx: RefundsTx, refundRequestId: number, now: Date) {
  const purchase = tx
    .select({
      id: schema.purchases.id,
      userId: schema.purchases.userId,
      courseId: schema.purchases.courseId,
      amountPaid: schema.purchases.amountPaid,
    })
    .from(schema.refunds)
    .innerJoin(
      schema.purchases,
      eq(schema.refunds.purchaseId, schema.purchases.id)
    )
    .where(eq(schema.refunds.id, refundRequestId))
    .get();
  // The refunds -> purchases foreign key means this can't happen; throwing
  // rolls the transaction back rather than approving half-way.
  if (!purchase) {
    throw new Error(`Refund request ${refundRequestId} has no purchase.`);
  }

  // Amount Refunded is always the full Refundable Amount: what the learner
  // paid, never the course's current list price. There are no partial refunds.
  tx.update(schema.refunds)
    .set({ amountRefunded: purchase.amountPaid })
    .where(eq(schema.refunds.id, refundRequestId))
    .run();

  revokeAccessFromPurchase(tx, purchase, now);
}

/**
 * Resolves an Open Refund Request in one transaction, behind the guards that
 * Approve and Decline share: only an admin resolves, and only an Open request
 * can be resolved. Approving also records the Amount Refunded and removes
 * access in the same transaction, so a failure leaves the request Open.
 */
function resolveRefundRequest(
  db: RefundsDb,
  refundRequestId: number,
  actingUserId: number,
  now: Date,
  status: schema.RefundStatus.Approved | schema.RefundStatus.Declined
): ResolveRefundRequestResult {
  return db.transaction((tx) => {
    const actingUser = tx
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, actingUserId))
      .get();
    if (actingUser?.role !== schema.UserRole.Admin) {
      return { ok: false, error: "not-an-admin" };
    }

    // Only an Open request changes, so of two admins resolving at once the
    // first one wins and the second finds it already resolved.
    const { changes } = tx
      .update(schema.refunds)
      .set({
        status,
        resolvedByUserId: actingUserId,
        resolvedAt: now.toISOString(),
      })
      .where(
        and(
          eq(schema.refunds.id, refundRequestId),
          eq(schema.refunds.status, schema.RefundStatus.Requested)
        )
      )
      .run();
    if (changes === 0) {
      const exists = tx
        .select({ id: schema.refunds.id })
        .from(schema.refunds)
        .where(eq(schema.refunds.id, refundRequestId))
        .get();
      return { ok: false, error: exists ? "already-resolved" : "not-found" };
    }

    if (status === schema.RefundStatus.Approved) {
      recordApproval(tx, refundRequestId, now);
    }

    return { ok: true };
  });
}

/**
 * Declines an Open Refund Request. Only the status, resolver and resolved-at
 * change: access, progress and revenue stay as they are.
 */
export function declineRefundRequest(
  db: RefundsDb,
  refundRequestId: number,
  actingUserId: number,
  now: Date
): ResolveRefundRequestResult {
  return resolveRefundRequest(
    db,
    refundRequestId,
    actingUserId,
    now,
    schema.RefundStatus.Declined
  );
}

/**
 * Approves an Open Refund Request, recording a Refund the admin has already
 * issued by hand (the app never moves money). Amount Refunded is what the
 * learner paid, and everyone who got access through the purchase loses it.
 * Lesson progress and watch events are kept, so a learner who buys the course
 * again carries on where they left off.
 */
export function approveRefundRequest(
  db: RefundsDb,
  refundRequestId: number,
  actingUserId: number,
  now: Date
): ResolveRefundRequestResult {
  return resolveRefundRequest(
    db,
    refundRequestId,
    actingUserId,
    now,
    schema.RefundStatus.Approved
  );
}
