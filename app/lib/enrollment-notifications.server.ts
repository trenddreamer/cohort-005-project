import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { Db } from "~/db/types";
import { toNotificationUser } from "~/lib/notifications";
import { notify, type Notifier } from "~/lib/notifier.server";

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
