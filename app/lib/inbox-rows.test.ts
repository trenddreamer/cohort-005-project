import { describe, it, expect } from "vitest";
import { describeNotification } from "./inbox-rows";

const sam = { id: "7", name: "Sam Lee", avatar: "https://example.com/sam.png" };

describe("describeNotification", () => {
  it.each([
    {
      kind: "refund-request-approved",
      actor: null,
      data: {
        course_title: "Intro to Hooks",
        course_slug: "intro-to-hooks",
        amount: "$49.00",
      },
      expected: {
        title: "Refund approved for Intro to Hooks",
        detail: "We've refunded the $49.00 you paid.",
        excerpt: null,
        href: "/courses/intro-to-hooks",
      },
    },
    {
      kind: "refund-request-declined",
      actor: null,
      data: { course_title: "Intro to Hooks", course_slug: "intro-to-hooks" },
      expected: {
        title: "Refund declined for Intro to Hooks",
        detail: "You still have access to the course.",
        excerpt: null,
        href: "/courses/intro-to-hooks",
      },
    },
    {
      kind: "comment-reply",
      actor: sam,
      data: {
        lesson_title: "useEffect",
        course_slug: "intro-to-hooks",
        lesson_id: 12,
        comment_id: 345,
        excerpt: "Good question!",
      },
      expected: {
        title: "Sam Lee replied to your comment on useEffect",
        detail: null,
        excerpt: "Good question!",
        href: "/courses/intro-to-hooks/lessons/12#comment-345",
      },
    },
    {
      kind: "lesson-comment",
      actor: sam,
      data: {
        lesson_title: "useEffect",
        course_title: "Intro to Hooks",
        course_slug: "intro-to-hooks",
        lesson_id: 12,
        comment_id: 346,
        excerpt: "Can we skip the first render?",
      },
      expected: {
        title: "Sam Lee commented on useEffect",
        detail: "in Intro to Hooks",
        excerpt: "Can we skip the first render?",
        href: "/courses/intro-to-hooks/lessons/12#comment-346",
      },
    },
    {
      kind: "new-enrollment",
      actor: sam,
      data: { course_title: "Intro to Hooks", course_id: 3 },
      expected: {
        title: "Sam Lee enrolled in Intro to Hooks",
        detail: null,
        excerpt: null,
        href: "/instructor/3/students",
      },
    },
    {
      kind: "open-refund-request",
      actor: sam,
      data: { course_title: "Intro to Hooks", excerpt: "Wrong course." },
      expected: {
        title: "Sam Lee requested a refund for Intro to Hooks",
        detail: null,
        excerpt: "Wrong course.",
        href: "/admin/refunds",
      },
    },
    {
      kind: "seat-claimed",
      actor: sam,
      data: { course_title: "Intro to Hooks" },
      expected: {
        title: "Sam Lee claimed a seat on Intro to Hooks",
        detail: null,
        excerpt: null,
        href: "/team",
      },
    },
    {
      kind: "access-ended",
      actor: null,
      data: { course_title: "Intro to Hooks", course_slug: "intro-to-hooks" },
      expected: {
        title: "Your access to Intro to Hooks has ended",
        detail:
          "The team purchase was refunded. Your progress is kept if you get access again.",
        excerpt: null,
        href: "/courses/intro-to-hooks",
      },
    },
  ])("builds the $kind row", ({ kind, actor, data, expected }) => {
    expect(describeNotification({ kind, actor, data })).toEqual({
      kind,
      actor: actor && {
        name: "Sam Lee",
        avatarUrl: "https://example.com/sam.png",
      },
      ...expected,
    });
  });

  it("keeps markup in names and titles as plain text", () => {
    const row = describeNotification({
      kind: "new-enrollment",
      actor: { id: "7", name: "<b>Sam</b>", avatar: null },
      data: { course_title: "<img src=x onerror=alert(1)>", course_id: 3 },
    });

    expect(row?.title).toBe(
      "<b>Sam</b> enrolled in <img src=x onerror=alert(1)>"
    );
  });

  it("gives no avatar URL when the actor has none", () => {
    const row = describeNotification({
      kind: "seat-claimed",
      actor: { id: "7", name: "Sam Lee", avatar: null },
      data: { course_title: "Intro to Hooks" },
    });

    expect(row?.actor).toEqual({ name: "Sam Lee", avatarUrl: null });
  });

  it("returns null for a kind Cadence does not know", () => {
    expect(
      describeNotification({ kind: "something-new", actor: null, data: {} })
    ).toBeNull();
  });

  it("returns null when the data lacks what the kind needs", () => {
    expect(
      describeNotification({
        kind: "refund-request-approved",
        actor: null,
        data: { course_title: "Intro to Hooks" },
      })
    ).toBeNull();
    expect(
      describeNotification({
        kind: "refund-request-approved",
        actor: null,
        data: null,
      })
    ).toBeNull();
  });

  it("names a missing actor as Someone", () => {
    const row = describeNotification({
      kind: "seat-claimed",
      actor: null,
      data: { course_title: "Intro to Hooks" },
    });

    expect(row?.title).toBe("Someone claimed a seat on Intro to Hooks");
    expect(row?.actor).toBeNull();
  });
});
