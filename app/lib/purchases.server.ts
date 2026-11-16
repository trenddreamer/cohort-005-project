import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { Db } from "~/db/types";
import type { NotificationUser } from "~/lib/notifications";
import { notify, type Notifier } from "~/lib/notifier.server";

export function toNotificationUser(
  user: typeof schema.users.$inferSelect
): NotificationUser {
  return { id: user.id, name: user.name, avatarUrl: user.avatarUrl };
}

/**
 * Tells the course's instructor that `learner` enrolled. Call it only after
 * the Enrollment has committed. The Notifier drops the instructor when they
 * are the learner.
 */
export async function notifyNewEnrollment(
  db: Db,
  notifier: Notifier,
  learner: typeof schema.users.$inferSelect,
  course: typeof schema.courses.$inferSelect
): Promise<void> {
  const instructor = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, course.instructorId))
    .get();
  if (!instructor) return;
  await notify(notifier, {
    kind: "new-enrollment",
    recipients: [toNotificationUser(instructor)],
    actor: toNotificationUser(learner),
    data: { course_title: course.title, course_id: course.id },
  });
}

export type BuyCourseResult =
  | { ok: true; enrollment: typeof schema.enrollments.$inferSelect }
  | { ok: false; error: string };

/**
 * Buys a course for one learner: saves the purchase and the Enrollment in one
 * transaction, then tells the instructor.
 */
export async function buyCourse(
  db: Db,
  notifier: Notifier,
  input: {
    userId: number;
    courseId: number;
    amountPaid: number;
    country: string | null;
  }
): Promise<BuyCourseResult> {
  const { userId, courseId, amountPaid, country } = input;

  const result = db.transaction((tx) => {
    const course = tx
      .select()
      .from(schema.courses)
      .where(eq(schema.courses.id, courseId))
      .get();
    if (!course) return { ok: false as const, error: "Course not found" };

    const learner = tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();
    if (!learner) return { ok: false as const, error: "User not found" };

    const existing = tx
      .select()
      .from(schema.enrollments)
      .where(
        and(
          eq(schema.enrollments.userId, userId),
          eq(schema.enrollments.courseId, courseId)
        )
      )
      .get();
    if (existing) {
      return {
        ok: false as const,
        error: "You are already enrolled in this course",
      };
    }

    tx.insert(schema.purchases)
      .values({ userId, courseId, amountPaid, country })
      .run();
    const enrollment = tx
      .insert(schema.enrollments)
      .values({ userId, courseId })
      .returning()
      .get();
    return { ok: true as const, enrollment, course, learner };
  });

  if (!result.ok) return result;

  await notifyNewEnrollment(db, notifier, result.learner, result.course);
  return { ok: true, enrollment: result.enrollment };
}

/**
 * Buys seats for a team: the purchase, the buyer's team (created on first
 * purchase) and one seat code per seat. The buyer gets no Enrollment, so
 * nobody is notified.
 */
export function buyTeamSeats(
  db: Db,
  input: {
    userId: number;
    courseId: number;
    amountPaid: number;
    country: string | null;
    quantity: number;
  }
) {
  const { userId, courseId, amountPaid, country, quantity } = input;
  return db.transaction((tx) => {
    const purchase = tx
      .insert(schema.purchases)
      .values({ userId, courseId, amountPaid, country })
      .returning()
      .get();

    const membership = tx
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.userId, userId),
          eq(schema.teamMembers.role, schema.TeamMemberRole.Admin)
        )
      )
      .get();
    let team = membership
      ? tx
          .select()
          .from(schema.teams)
          .where(eq(schema.teams.id, membership.teamId))
          .get()
      : undefined;
    if (!team) {
      team = tx.insert(schema.teams).values({}).returning().get();
      tx.insert(schema.teamMembers)
        .values({
          teamId: team.id,
          userId,
          role: schema.TeamMemberRole.Admin,
        })
        .run();
    }

    const coupons: (typeof schema.coupons.$inferSelect)[] = [];
    for (let i = 0; i < quantity; i++) {
      coupons.push(
        tx
          .insert(schema.coupons)
          .values({
            teamId: team.id,
            courseId,
            code: crypto.randomBytes(12).toString("base64url"),
            purchaseId: purchase.id,
          })
          .returning()
          .get()
      );
    }
    return { purchase, team, coupons };
  });
}
