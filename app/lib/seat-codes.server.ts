import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq } from "drizzle-orm";
import * as schema from "~/db/schema";

/** The app's drizzle instance, or a `createTestDb()` in tests. */
export type SeatCodesDb = BetterSQLite3Database<typeof schema>;

export function getSeatCode(db: SeatCodesDb, code: string) {
  return db
    .select()
    .from(schema.coupons)
    .where(eq(schema.coupons.code, code))
    .get();
}

/** Shown for a seat code whose purchase's Refund Request was Approved. */
export const SEAT_CODE_VOIDED_MESSAGE =
  "This seat code no longer works: its purchase was refunded";

export type RedeemSeatCodeResult =
  | { ok: true; enrollment: typeof schema.enrollments.$inferSelect }
  | { ok: false; error: string };

/**
 * Claims a team seat for `userId`: marks the seat code claimed and enrolls
 * them in its course, in one transaction.
 */
export function redeemSeatCode(
  db: SeatCodesDb,
  code: string,
  userId: number,
  userCountry: string,
  now: Date
): RedeemSeatCodeResult {
  return db.transaction((tx) => {
    const coupon = tx
      .select()
      .from(schema.coupons)
      .where(eq(schema.coupons.code, code))
      .get();
    if (!coupon) {
      return { ok: false, error: "Coupon not found" };
    }

    if (coupon.redeemedByUserId !== null) {
      return { ok: false, error: "Coupon has already been redeemed" };
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
          "This coupon can only be redeemed from the same country as the purchaser",
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
