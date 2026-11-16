import { describe, it, expect, beforeEach } from "vitest";
import * as schema from "~/db/schema";
import { createTestDb, seedBaseData } from "~/test/setup";
import { getPreferenceAudience } from "./notification-preferences.server";

let db: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

describe("getPreferenceAudience", () => {
  it("is nothing for a learner with no purchase", () => {
    expect(getPreferenceAudience(db, base.user)).toEqual({
      isInstructor: false,
      isAdmin: false,
      hasPurchase: false,
      isTeamAdmin: false,
    });
  });

  it("sees a purchase", () => {
    db.insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 4900,
        country: "US",
      })
      .run();
    expect(getPreferenceAudience(db, base.user).hasPurchase).toBe(true);
  });

  it("reads instructor from the role", () => {
    expect(getPreferenceAudience(db, base.instructor).isInstructor).toBe(true);
  });

  it("sees a team admin membership", () => {
    const team = db.insert(schema.teams).values({}).returning().get();
    db.insert(schema.teamMembers)
      .values({
        teamId: team.id,
        userId: base.user.id,
        role: schema.TeamMemberRole.Admin,
      })
      .run();
    expect(getPreferenceAudience(db, base.user).isTeamAdmin).toBe(true);
  });
});
