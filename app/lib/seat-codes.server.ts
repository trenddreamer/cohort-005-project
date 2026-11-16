import { and, eq } from "drizzle-orm";
import { notifyNewEnrollment } from "~/lib/enrollment-notifications.server";
import { notify, type Notifier } from "~/lib/notifier.server";
import { toNotificationUser } from "~/lib/notifications";
import * as schema from "~/db/schema";
import type { Db } from "~/db/types";
import { SEAT_CODE_VOIDED_MESSAGE } from "~/lib/seat-codes";

export function getSeatCode(db: Db, code: string) {
  return db
    .select()
    .from(schema.coupons)
    .where(eq(schema.coupons.code, code))
    .get();
}

export type RedeemSeatCodeResult =
  | { ok: true; enrollment: typeof schema.enrollments.$inferSelect }
  | { ok: false; error: string };

/**
 * Claims a team seat for `userId`: marks the seat code claimed and enrolls
 * them in its course, in one transaction. Once it has committed, tells the
 * course's instructor of the Enrollment and every team admin of the claim.
 */
export async function redeemSeatCode(
  db: Db,
  notifier: Notifier,
  code: string,
  userId: number,
  userCountry: string,
  now: Date
): Promise<RedeemSeatCodeResult> {
  const outcome = db.transaction((tx) => {
    const coupon = getSeatCode(tx, code);
    if (!coupon) {
      return { ok: false as const, error: "Coupon not found" };
    }

    if (coupon.redeemedByUserId !== null) {
      return {
        ok: false as const,
        error: "This seat has already been claimed",
      };
    }

    if (coupon.voidedAt !== null) {
      return { ok: false as const, error: SEAT_CODE_VOIDED_MESSAGE };
    }

    const existingEnrollment = tx
      .select()
      .from(schema.enrollments)
      .where(
        and(
          eq(schema.enrollments.userId, userId),
          eq(schema.enrollments.courseId, coupon.courseId)
        )
      )
      .get();
    if (existingEnrollment) {
      return {
        ok: false as const,
        error: "You are already enrolled in this course",
      };
    }

    const purchase = tx
      .select()
      .from(schema.purchases)
      .where(eq(schema.purchases.id, coupon.purchaseId))
      .get();
    if (purchase?.country && purchase.country !== userCountry) {
      return {
        ok: false as const,
        error:
          "This seat can only be claimed from the same country as the purchaser",
      };
    }

    tx.update(schema.coupons)
      .set({ redeemedByUserId: userId, redeemedAt: now.toISOString() })
      .where(eq(schema.coupons.id, coupon.id))
      .run();

    const enrollment = tx
      .insert(schema.enrollments)
      .values({ userId, courseId: coupon.courseId })
      .returning()
      .get();

    const member = tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();
    const course = tx
      .select()
      .from(schema.courses)
      .where(eq(schema.courses.id, coupon.courseId))
      .get();
    const admins = tx
      .select({ user: schema.users })
      .from(schema.teamMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.teamMembers.userId))
      .where(
        and(
          eq(schema.teamMembers.teamId, coupon.teamId),
          eq(schema.teamMembers.role, schema.TeamMemberRole.Admin)
        )
      )
      .all()
      .map((row) => row.user);

    return { ok: true as const, enrollment, member, course, admins };
  });

  if (!outcome.ok) return outcome;

  const { enrollment, member, course, admins } = outcome;
  if (member && course) {
    await notifyNewEnrollment(db, notifier, member, course);
    await notify(notifier, {
      kind: "seat-claimed",
      recipients: admins.map(toNotificationUser),
      actor: toNotificationUser(member),
      data: { course_title: course.title },
    });
  }
  return { ok: true, enrollment };
}
