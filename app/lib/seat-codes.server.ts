import { and, eq } from "drizzle-orm";
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
 * them in its course, in one transaction.
 */
export function redeemSeatCode(
  db: Db,
  code: string,
  userId: number,
  userCountry: string,
  now: Date
): RedeemSeatCodeResult {
  return db.transaction((tx) => {
    const coupon = getSeatCode(tx, code);
    if (!coupon) {
      return { ok: false, error: "Coupon not found" };
    }

    if (coupon.redeemedByUserId !== null) {
      return { ok: false, error: "This seat has already been claimed" };
    }

    if (coupon.voidedAt !== null) {
      return { ok: false, error: SEAT_CODE_VOIDED_MESSAGE };
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
      return { ok: false, error: "You are already enrolled in this course" };
    }

    const purchase = tx
      .select()
      .from(schema.purchases)
      .where(eq(schema.purchases.id, coupon.purchaseId))
      .get();
    if (purchase?.country && purchase.country !== userCountry) {
      return {
        ok: false,
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

    return { ok: true, enrollment };
  });
}
