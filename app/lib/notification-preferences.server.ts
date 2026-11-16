import { and, eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { Db } from "~/db/types";
import type { PreferenceAudience } from "~/lib/notification-preferences";

/** What this person is or has, read from the database. */
export function getPreferenceAudience(
  db: Db,
  user: { id: number; role: schema.UserRole }
): PreferenceAudience {
  const purchase = db
    .select({ id: schema.purchases.id })
    .from(schema.purchases)
    .where(eq(schema.purchases.userId, user.id))
    .get();
  const teamAdminship = db
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(
      and(
        eq(schema.teamMembers.userId, user.id),
        eq(schema.teamMembers.role, schema.TeamMemberRole.Admin)
      )
    )
    .get();
  return {
    isInstructor: user.role === schema.UserRole.Instructor,
    isAdmin: user.role === schema.UserRole.Admin,
    hasPurchase: purchase !== undefined,
    isTeamAdmin: teamAdminship !== undefined,
  };
}
