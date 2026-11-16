import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import * as schema from "~/db/schema";
import type { Db } from "~/db/types";
import { excerpt } from "~/lib/excerpt";
import { notify, type Notifier } from "~/lib/notifier.server";
import type { NotificationUser } from "~/lib/notifications";

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

function getLessonIdsForCourse(db: Db, courseId: number): number[] {
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
  db: Db,
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
  db: Db,
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
  db: Db,
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
export function getRefundRequest(db: Db, purchaseId: number) {
  return db
    .select()
    .from(schema.refunds)
    .where(eq(schema.refunds.purchaseId, purchaseId))
    .orderBy(desc(schema.refunds.requestedAt))
    .get();
}

/** Whether any team seat on the purchase has been claimed. */
function hasClaimedSeat(db: Db, purchaseId: number): boolean {
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

/**
 * A purchase's team seat codes, voided ones included. A voided code is no
 * longer a seat, but its row still shows the purchase was a team purchase.
 */
function getSeatCodes(db: Db, purchaseId: number) {
  return db
    .select({
      redeemedByUserId: schema.coupons.redeemedByUserId,
      redeemedAt: schema.coupons.redeemedAt,
      voidedAt: schema.coupons.voidedAt,
    })
    .from(schema.coupons)
    .where(eq(schema.coupons.purchaseId, purchaseId))
    .all();
}

/** A purchase with any seat codes, even voided ones, is a team purchase. */
function isTeamPurchase(seatCodes: readonly unknown[]): boolean {
  return seatCodes.length > 0;
}

// ─── Eligibility ───

/**
 * Whether `user` can open a Refund Request on `purchase` at `now`, or the
 * first reason they can't.
 */
export function canOpenRefundRequest(
  db: Db,
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
  /** Seats on the team purchase, not counting voided codes. Zero if solo. */
  seatCount: number;
  /** Seats a member has claimed. Approving removes each one's access. */
  claimedSeatCount: number;
  /** Claimed Seats taken after the request was opened, while it was Open. */
  claimedSeatsSinceRequested: number;
  /** The admin who resolved it. Null while Open. */
  resolvedBy: { id: number; name: string } | null;
  /** When it was resolved. Null while Open. */
  resolvedAt: string | null;
  /** Set only on an Approved request: always the full Refundable Amount. */
  amountRefunded: number | null;
};

const resolvers = alias(schema.users, "resolvers");

/**
 * Refund Requests with the given status (`RefundStatus.Requested` is Open).
 * Open requests come oldest request first, so whoever has waited longest is
 * first in line; Approved and Declined ones come most recently resolved first.
 */
export function listRefundRequests(
  db: Db,
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
      resolvedBy: { id: resolvers.id, name: resolvers.name },
      resolvedAt: schema.refunds.resolvedAt,
      amountRefunded: schema.refunds.amountRefunded,
    })
    .from(schema.refunds)
    .innerJoin(
      schema.purchases,
      eq(schema.refunds.purchaseId, schema.purchases.id)
    )
    .innerJoin(schema.users, eq(schema.purchases.userId, schema.users.id))
    .innerJoin(schema.courses, eq(schema.purchases.courseId, schema.courses.id))
    .leftJoin(resolvers, eq(schema.refunds.resolvedByUserId, resolvers.id))
    .where(eq(schema.refunds.status, status))
    .orderBy(
      ...(status === schema.RefundStatus.Requested
        ? [asc(schema.refunds.requestedAt), asc(schema.refunds.id)]
        : [desc(schema.refunds.resolvedAt), desc(schema.refunds.id)])
    )
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
    const seats = seatCodes.filter((seat) => seat.voidedAt === null);
    const claimedSeats = seats.flatMap((seat) =>
      seat.redeemedAt === null ? [] : [seat.redeemedAt]
    );
    return {
      ...request,
      watchedSeconds,
      completionFraction,
      isOverWatchLimit: watchedSeconds >= MAX_WATCHED_SECONDS,
      isOverCompletionLimit: completionFraction >= COMPLETION_LIMIT,
      isTeamPurchase: isTeamPurchase(seatCodes),
      seatCount: seats.length,
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

/**
 * Removes access from everyone who got it through the purchase by deleting
 * their enrollments for the course (ADR 0001). Lesson progress and watch
 * events are keyed by user and lesson, so they stay.
 *
 * A solo purchase enrolled its buyer. A team purchase (one with seat codes)
 * enrolled whoever claimed its seats, not its buyer.
 *
 * Returns the IDs of the team members (Claimed Seats) whose access ended; a
 * solo purchase's buyer is not one of them.
 */
function revokeAccessFromPurchase(
  tx: Db,
  purchase: { id: number; userId: number; courseId: number },
  now: Date
): number[] {
  const seatCodes = getSeatCodes(tx, purchase.id);
  const isTeam = isTeamPurchase(seatCodes);
  const userIdsWithAccess = isTeam
    ? seatCodes.flatMap((seat) =>
        seat.redeemedByUserId === null ? [] : [seat.redeemedByUserId]
      )
    : [purchase.userId];
  if (isTeam) {
    // Unclaimed seat codes can no longer be claimed and stop counting as
    // seats. Claimed Seats stay on record; their members lose access below.
    tx.update(schema.coupons)
      .set({ voidedAt: now.toISOString() })
      .where(
        and(
          eq(schema.coupons.purchaseId, purchase.id),
          isNull(schema.coupons.redeemedByUserId)
        )
      )
      .run();
  }
  if (userIdsWithAccess.length === 0) return [];

  tx.delete(schema.enrollments)
    .where(
      and(
        inArray(schema.enrollments.userId, userIdsWithAccess),
        eq(schema.enrollments.courseId, purchase.courseId)
      )
    )
    .run();
  return isTeam ? userIdsWithAccess : [];
}

/** What approving changed, for the Notifications sent once it commits. */
type Approval = { amountRefunded: number; revokedMemberIds: number[] };

// Runs after the request has moved from Open to Approved, in that transaction.
function recordApproval(
  tx: Db,
  refundRequestId: number,
  now: Date
): Approval {
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

  const revokedMemberIds = revokeAccessFromPurchase(tx, purchase, now);
  return { amountRefunded: purchase.amountPaid, revokedMemberIds };
}

// Always money, so a free purchase reads "$0.00", never "Free".
function formatAmountRefunded(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** What the transaction hands out so Notifications can be sent after it commits. */
type ResolvedRefundRequest = {
  buyer: NotificationUser;
  course: { id: number; title: string; slug: string };
  /** Set when approving: the Amount Refunded and the members who lost access. */
  approval?: { amountRefunded: number; revokedMembers: NotificationUser[] };
};

type ResolveOutcome =
  | { ok: true; resolved: ResolvedRefundRequest }
  | { ok: false; error: ResolveRefundRequestError };

function loadNotificationUsers(tx: Db, userIds: number[]): NotificationUser[] {
  if (userIds.length === 0) return [];
  return tx
    .select({
      id: schema.users.id,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds))
    .orderBy(asc(schema.users.id))
    .all();
}

// The buyer and the course of a Refund Request, loaded for its Notifications.
function loadResolvedRefundRequest(
  tx: Db,
  refundRequestId: number,
  approval?: Approval
): ResolvedRefundRequest {
  const row = tx
    .select({
      buyerId: schema.users.id,
      buyerName: schema.users.name,
      buyerAvatarUrl: schema.users.avatarUrl,
      courseId: schema.courses.id,
      courseTitle: schema.courses.title,
      courseSlug: schema.courses.slug,
    })
    .from(schema.refunds)
    .innerJoin(
      schema.purchases,
      eq(schema.refunds.purchaseId, schema.purchases.id)
    )
    .innerJoin(schema.users, eq(schema.purchases.userId, schema.users.id))
    .innerJoin(schema.courses, eq(schema.purchases.courseId, schema.courses.id))
    .where(eq(schema.refunds.id, refundRequestId))
    .get();
  // Foreign keys mean this can't happen; throwing rolls the transaction back.
  if (!row) {
    throw new Error(`Refund request ${refundRequestId} has no purchase.`);
  }
  return {
    buyer: {
      id: row.buyerId,
      name: row.buyerName,
      avatarUrl: row.buyerAvatarUrl,
    },
    course: { id: row.courseId, title: row.courseTitle, slug: row.courseSlug },
    approval: approval && {
      amountRefunded: approval.amountRefunded,
      revokedMembers: loadNotificationUsers(tx, approval.revokedMemberIds),
    },
  };
}

/**
 * Resolves an Open Refund Request in one transaction, behind the guards that
 * Approve and Decline share: only an admin resolves, and only an Open request
 * can be resolved. Approving also records the Amount Refunded and removes
 * access in the same transaction, so a failure leaves the request Open.
 *
 * Notifications are sent after the transaction commits, never inside it, and
 * never when it fails. A Notifier that fails does not fail the resolution.
 */
async function resolveRefundRequest(
  db: Db,
  notifier: Notifier,
  refundRequestId: number,
  actingUserId: number,
  now: Date,
  status: schema.RefundStatus.Approved | schema.RefundStatus.Declined
): Promise<ResolveRefundRequestResult> {
  const outcome = db.transaction((tx): ResolveOutcome => {
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

    const approval =
      status === schema.RefundStatus.Approved
        ? recordApproval(tx, refundRequestId, now)
        : undefined;

    return {
      ok: true,
      resolved: loadResolvedRefundRequest(tx, refundRequestId, approval),
    };
  });

  if (!outcome.ok) return outcome;

  await sendResolutionNotifications(notifier, status, outcome.resolved);
  return { ok: true };
}

// Committed by now.
async function sendResolutionNotifications(
  notifier: Notifier,
  status: schema.RefundStatus.Approved | schema.RefundStatus.Declined,
  { buyer, course, approval }: ResolvedRefundRequest
) {
  switch (status) {
    case schema.RefundStatus.Declined:
      await notify(notifier, {
        kind: "refund-request-declined",
        recipients: [buyer],
        data: { course_title: course.title, course_slug: course.slug },
      });
      return;
    case schema.RefundStatus.Approved:
      if (!approval) return;
      await notify(notifier, {
        kind: "refund-request-approved",
        recipients: [buyer],
        data: {
          course_title: course.title,
          course_slug: course.slug,
          amount: formatAmountRefunded(approval.amountRefunded),
        },
      });
      if (approval.revokedMembers.length > 0) {
        await notify(notifier, {
          kind: "access-ended",
          recipients: approval.revokedMembers,
          data: { course_title: course.title, course_slug: course.slug },
        });
      }
      return;
  }
}

/**
 * Declines an Open Refund Request. Only the status, resolver and resolved-at
 * change: access, progress and revenue stay as they are.
 */
export function declineRefundRequest(
  db: Db,
  notifier: Notifier,
  refundRequestId: number,
  actingUserId: number,
  now: Date
): Promise<ResolveRefundRequestResult> {
  return resolveRefundRequest(
    db,
    notifier,
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
  db: Db,
  notifier: Notifier,
  refundRequestId: number,
  actingUserId: number,
  now: Date
): Promise<ResolveRefundRequestResult> {
  return resolveRefundRequest(
    db,
    notifier,
    refundRequestId,
    actingUserId,
    now,
    schema.RefundStatus.Approved
  );
}

// ─── Opening a Refund Request ───

export type OpenRefundRequestResult =
  { ok: true } | { ok: false; reason: RefundIneligibleReason };

/**
 * Opens a Refund Request on `purchase` for the learner, unless the purchase
 * is ineligible. Every admin is then sent an "open-refund-request"
 * Notification with the learner as actor, so an admin who opens one on their
 * own purchase is not told about it.
 *
 * Notifications are sent after the request is saved, and a Notifier that
 * fails does not undo it.
 */
export async function openRefundRequest(
  db: Db,
  notifier: Notifier,
  input: {
    purchase: PurchaseForRefund;
    learner: NotificationUser;
    course: { title: string };
    reason: string;
    now: Date;
  }
): Promise<OpenRefundRequestResult> {
  const { purchase, learner, course, reason, now } = input;

  const eligibility = canOpenRefundRequest(db, purchase, learner, now);
  if (!eligibility.eligible) return { ok: false, reason: eligibility.reason };

  db.insert(schema.refunds)
    .values({
      purchaseId: purchase.id,
      status: schema.RefundStatus.Requested,
      reason,
    })
    .run();

  const admins = db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(schema.users)
    .where(eq(schema.users.role, schema.UserRole.Admin))
    .all();

  await notify(notifier, {
    kind: "open-refund-request",
    recipients: admins,
    actor: {
      id: learner.id,
      name: learner.name,
      avatarUrl: learner.avatarUrl,
    },
    data: { course_title: course.title, excerpt: excerpt(reason) },
  });

  return { ok: true };
}
