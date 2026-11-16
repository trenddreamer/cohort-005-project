import { describe, it, expect } from "vitest";
import { createToastPlanner } from "./toast-plan";
import type { InboxItem } from "./inbox-client";

function item(id: string, kind = "comment-reply"): InboxItem {
  return {
    id,
    row: {
      kind: kind as InboxItem["row"]["kind"],
      actor: null,
      title: `Title ${id}`,
      detail: null,
      excerpt: null,
      href: "/x",
    },
    insertedAt: "2026-11-16T10:00:00.000Z",
    readAt: null,
  };
}

const idle = { videoPlaying: false, toastsOnScreen: 0, overflowCount: 0 };

describe("createToastPlanner", () => {
  it("plans one toast for a new notification", () => {
    const planner = createToastPlanner();
    const a = item("a");
    expect(planner.plan([a], idle)).toEqual([
      { type: "notification", item: a },
    ]);
  });

  it("raises no toast twice for the same notification id", () => {
    const planner = createToastPlanner();
    planner.plan([item("a")], idle);
    expect(planner.plan([item("a"), item("b")], idle)).toEqual([
      { type: "notification", item: item("b") },
    ]);
  });

  it("raises no toast for notifications present at page load", () => {
    const planner = createToastPlanner();
    planner.seed(["old-1", "old-2"]);
    expect(planner.plan([item("old-1"), item("old-2")], idle)).toEqual([]);
  });

  it("raises no toast for a new enrollment", () => {
    const planner = createToastPlanner();
    expect(planner.plan([item("e", "new-enrollment")], idle)).toEqual([]);
  });

  it("shows at most 3, then one summary of the rest", () => {
    const planner = createToastPlanner();
    const plan = planner.plan(
      [item("1"), item("2"), item("3"), item("4"), item("5")],
      idle
    );
    expect(plan.map((a) => a.type)).toEqual([
      "notification",
      "notification",
      "notification",
      "overflow",
    ]);
    expect(plan[3]).toEqual({ type: "overflow", count: 2 });
  });

  it("counts toasts already on screen against the limit", () => {
    const planner = createToastPlanner();
    const plan = planner.plan([item("1"), item("2")], {
      ...idle,
      toastsOnScreen: 2,
    });
    expect(plan).toEqual([
      { type: "notification", item: item("1") },
      { type: "overflow", count: 1 },
    ]);
  });

  it("adds a later burst to the summary's count instead of replacing it", () => {
    const planner = createToastPlanner();
    const plan = planner.plan([item("6"), item("7")], {
      ...idle,
      toastsOnScreen: 3,
      overflowCount: 2,
    });
    expect(plan).toEqual([{ type: "overflow", count: 4 }]);
  });

  it("does not count the summary toast against the 3 notification toasts", () => {
    const planner = createToastPlanner();
    const plan = planner.plan([item("1"), item("2"), item("3"), item("4")], {
      ...idle,
      overflowCount: 2,
    });
    expect(plan.map((a) => a.type)).toEqual([
      "notification",
      "notification",
      "notification",
      "overflow",
    ]);
    expect(plan[3]).toEqual({ type: "overflow", count: 3 });
  });

  it("leaves the summary alone when everything new fits", () => {
    const planner = createToastPlanner();
    const a = item("a");
    expect(
      planner.plan([a], { ...idle, toastsOnScreen: 1, overflowCount: 2 })
    ).toEqual([{ type: "notification", item: a }]);
  });

  it("never shows more than 3 notification toasts plus one summary", () => {
    const planner = createToastPlanner();
    const plan = planner.plan(
      Array.from({ length: 10 }, (_, i) => item(`n${i}`)),
      { ...idle, toastsOnScreen: 1, overflowCount: 4 }
    );
    expect(plan.filter((a) => a.type === "notification")).toHaveLength(2);
    expect(plan.filter((a) => a.type === "overflow")).toEqual([
      { type: "overflow", count: 12 },
    ]);
  });

  it("raises no toast while a video plays, and none later for those items", () => {
    const planner = createToastPlanner();
    expect(planner.plan([item("a")], { ...idle, videoPlaying: true })).toEqual(
      []
    );
    expect(planner.plan([item("a")], idle)).toEqual([]);
  });
});
