import { describe, it, expect } from "vitest";
import {
  PREFERENCE_KINDS,
  preferenceKindSchema,
  preferencesFrom,
  preferenceKindsFor,
  loadSwitches,
} from "./notification-preferences";
import { createRecordingNotifier } from "~/test/recording-notifier";

const learner = {
  isInstructor: false,
  isAdmin: false,
  hasPurchase: false,
  isTeamAdmin: false,
};

describe("which switches a person sees", () => {
  it("shows a learner with no purchase only replies", () => {
    expect(preferenceKindsFor(learner)).toEqual(["comment-reply"]);
  });

  it("adds refund request updates for anyone with a purchase", () => {
    expect(preferenceKindsFor({ ...learner, hasPurchase: true })).toEqual([
      "comment-reply",
      "refund-request-approved",
      "refund-request-declined",
    ]);
  });

  it("adds new comments and New Enrollments for instructors", () => {
    expect(preferenceKindsFor({ ...learner, isInstructor: true })).toEqual([
      "comment-reply",
      "lesson-comment",
      "new-enrollment",
    ]);
  });

  it("adds Open Refund Requests for admins", () => {
    expect(preferenceKindsFor({ ...learner, isAdmin: true })).toEqual([
      "comment-reply",
      "open-refund-request",
    ]);
  });

  it("adds seat claims for team admins", () => {
    expect(preferenceKindsFor({ ...learner, isTeamAdmin: true })).toEqual([
      "comment-reply",
      "seat-claimed",
    ]);
  });

  it("never offers Access ended, whoever the person is", () => {
    const everything = preferenceKindsFor({
      isInstructor: true,
      isAdmin: true,
      hasPurchase: true,
      isTeamAdmin: true,
    });
    expect(everything).toHaveLength(7);
    expect(everything).not.toContain("access-ended");
    expect(PREFERENCE_KINDS).not.toContain("access-ended");
  });
});

describe("loading switches", () => {
  it("shows every switch on for someone who has saved nothing", async () => {
    const notifier = createRecordingNotifier();

    const switches = await loadSwitches(notifier, 5, {
      ...learner,
      hasPurchase: true,
    });

    expect(switches).toEqual([
      { kind: "comment-reply", enabled: true },
      { kind: "refund-request-approved", enabled: true },
      { kind: "refund-request-declined", enabled: true },
    ]);
  });

  it("shows a saved off switch as off", async () => {
    const notifier = createRecordingNotifier();
    await notifier.setPreference(5, "comment-reply", false);

    const switches = await loadSwitches(notifier, 5, learner);

    expect(switches).toEqual([{ kind: "comment-reply", enabled: false }]);
  });
});

describe("saving a switch", () => {
  it("merges into the preference set and leaves the other switches", async () => {
    const notifier = createRecordingNotifier();
    await notifier.setPreference(5, "comment-reply", false);
    await notifier.setPreference(5, "lesson-comment", false);
    await notifier.setPreference(5, "comment-reply", true);

    const saved = await notifier.getPreferences(5);

    expect(saved["comment-reply"]).toBe(true);
    expect(saved["lesson-comment"]).toBe(false);
    expect(saved["new-enrollment"]).toBe(true);
  });

  it("keeps one person's switches apart from another's", async () => {
    const notifier = createRecordingNotifier();
    await notifier.setPreference(5, "comment-reply", false);

    expect((await notifier.getPreferences(6))["comment-reply"]).toBe(true);
  });
});

describe("the kind a form may switch", () => {
  it("accepts a switchable kind", () => {
    expect(preferenceKindSchema.parse("comment-reply")).toBe("comment-reply");
  });

  it("refuses Access ended and kinds that do not exist", () => {
    expect(preferenceKindSchema.safeParse("access-ended").success).toBe(false);
    expect(preferenceKindSchema.safeParse("nope").success).toBe(false);
  });
});

describe("building every switch", () => {
  it("sets each switchable kind from the rule and nothing else", () => {
    const preferences = preferencesFrom((kind) => kind !== "seat-claimed");

    expect(Object.keys(preferences)).toEqual([...PREFERENCE_KINDS]);
    expect(preferences["seat-claimed"]).toBe(false);
    expect(preferences["comment-reply"]).toBe(true);
  });
});
