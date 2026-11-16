import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import {
  createRecordingNotifier,
  type RecordingNotifier,
} from "~/test/recording-notifier";
import * as schema from "~/db/schema";
import { buyCourse, buyTeamSeats } from "./purchases.server";
import { redeemSeatCode } from "./seat-codes.server";

let db: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let notifier: RecordingNotifier;
const now = new Date("2026-03-05T15:30:00.000Z");

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  notifier = createRecordingNotifier();
});

function addUser(name: string) {
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

function addTeamAdmin(teamId: number, userId: number) {
  db.insert(schema.teamMembers)
    .values({ teamId, userId, role: schema.TeamMemberRole.Admin })
    .run();
}

function buyTeam(buyer = base.user, quantity = 2) {
  return buyTeamSeats(db, {
    userId: buyer.id,
    courseId: base.course.id,
    amountPaid: 9800,
    country: null,
    quantity,
  });
}

describe("buyCourse", () => {
  const buy = (userId: number) =>
    buyCourse(db, notifier, {
      userId,
      courseId: base.course.id,
      amountPaid: 4900,
      country: "US",
    });

  it("saves the purchase and Enrollment and tells the instructor", async () => {
    const result = await buy(base.user.id);

    expect(result.ok).toBe(true);
    expect(db.select().from(schema.purchases).all()).toHaveLength(1);
    expect(db.select().from(schema.enrollments).all()).toHaveLength(1);
    expect(notifier.sent).toEqual([
      {
        kind: "new-enrollment",
        recipientIds: [base.instructor.id],
        actor: { id: base.user.id, name: "Test User", avatarUrl: null },
        data: { course_title: "Test Course", course_id: base.course.id },
      },
    ]);
  });

  it("does not notify an instructor who enrolls in their own course", async () => {
    await buy(base.instructor.id);
    expect(notifier.sent[0].recipientIds).toEqual([]);
  });

  it("saves nothing and sends nothing when already enrolled", async () => {
    await buy(base.user.id);
    notifier.sent.length = 0;

    const result = await buy(base.user.id);

    expect(result.ok).toBe(false);
    expect(db.select().from(schema.purchases).all()).toHaveLength(1);
    expect(notifier.sent).toEqual([]);
  });

  it("rolls back the purchase and sends nothing when the Enrollment fails", async () => {
    const result = await buyCourse(db, notifier, {
      userId: base.user.id,
      courseId: 9999,
      amountPaid: 4900,
      country: "US",
    });

    expect(result.ok).toBe(false);
    expect(db.select().from(schema.purchases).all()).toEqual([]);
    expect(notifier.sent).toEqual([]);
  });

  it("still succeeds when delivery fails", async () => {
    const failing = createRecordingNotifier({ failWith: new Error("down") });
    const result = await buyCourse(db, failing, {
      userId: base.user.id,
      courseId: base.course.id,
      amountPaid: 4900,
      country: "US",
    });
    expect(result.ok).toBe(true);
  });
});

describe("buyTeamSeats", () => {
  it("creates seats but no Enrollment", () => {
    const result = buyTeam();

    expect(result.coupons).toHaveLength(2);
    expect(db.select().from(schema.enrollments).all()).toEqual([]);
    expect(notifier.sent).toEqual([]);
  });
});

describe("redeemSeatCode notifications", () => {
  async function claim(code: string, userId: number) {
    return redeemSeatCode(db, notifier, code, userId, "", now);
  }

  it("tells the instructor of the Enrollment and every team admin of the claim", async () => {
    const { team, coupons } = buyTeam();
    const second = addUser("Second");
    addTeamAdmin(team.id, second.id);
    const otherAdmin = addUser("Other");
    const otherTeam = buyTeam(otherAdmin, 1).team;
    expect(otherTeam.id).not.toBe(team.id);
    const member = addUser("Member");

    const result = await claim(coupons[0].code, member.id);

    expect(result.ok).toBe(true);
    const actor = { id: member.id, name: "Member", avatarUrl: null };
    expect(notifier.sent).toEqual([
      {
        kind: "new-enrollment",
        recipientIds: [base.instructor.id],
        actor,
        data: { course_title: "Test Course", course_id: base.course.id },
      },
      {
        kind: "seat-claimed",
        recipientIds: [base.user.id, second.id],
        actor,
        data: { course_title: "Test Course" },
      },
    ]);
  });

  it("does not tell a team admin about their own claim", async () => {
    const { team, coupons } = buyTeam();
    const second = addUser("Second");
    addTeamAdmin(team.id, second.id);

    await claim(coupons[0].code, base.user.id);

    const seatClaimed = notifier.sent.find((n) => n.kind === "seat-claimed");
    expect(seatClaimed?.recipientIds).toEqual([second.id]);
  });

  it("sends nothing when the claim fails", async () => {
    const { coupons } = buyTeam();
    await claim(coupons[0].code, addUser("Member").id);
    notifier.sent.length = 0;

    const result = await claim(coupons[0].code, addUser("Late").id);

    expect(result.ok).toBe(false);
    expect(notifier.sent).toEqual([]);
  });

  it("sends nothing when the transaction rolls back", async () => {
    const { coupons } = buyTeam();

    // A missing user makes the Enrollment insert violate its foreign key.
    await expect(claim(coupons[0].code, 9999)).rejects.toThrow();

    expect(notifier.sent).toEqual([]);
    expect(
      db
        .select()
        .from(schema.coupons)
        .where(eq(schema.coupons.id, coupons[0].id))
        .get()?.redeemedByUserId
    ).toBeNull();
  });
});
