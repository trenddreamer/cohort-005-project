import { describe, it, expect } from "vitest";
import type { FeedItem } from "@knocklabs/client";
import { toInboxItem } from "./inbox-client";

function feedItem(overrides: Partial<FeedItem>): FeedItem {
  return {
    __cursor: "c1",
    id: "msg-1",
    source: { key: "seat-claimed", version_id: "v1", categories: [] },
    actors: [],
    total_actors: 0,
    data: { course_title: "Intro to Hooks" },
    blocks: [
      {
        name: "body",
        type: "markdown",
        content: "x",
        rendered: "<script>alert(1)</script>",
      },
    ],
    inserted_at: "2026-11-16T10:00:00.000Z",
    updated_at: "2026-11-16T10:00:00.000Z",
    read_at: null,
    seen_at: null,
    clicked_at: null,
    interacted_at: null,
    link_clicked_at: null,
    archived_at: null,
    tenant: null,
    ...overrides,
  };
}

describe("toInboxItem", () => {
  it("builds the item from the kind, the actor and the data", () => {
    const item = toInboxItem(
      feedItem({
        actors: [
          {
            id: "7",
            name: "Sam Lee",
            avatar: null,
            email: null,
            phone_number: null,
            created_at: "2026-11-01T00:00:00.000Z",
            updated_at: "2026-11-01T00:00:00.000Z",
            __typename: "User",
          },
        ],
        read_at: "2026-11-16T11:00:00.000Z",
      })
    );

    expect(item).toEqual({
      id: "msg-1",
      row: {
        kind: "seat-claimed",
        actor: { name: "Sam Lee", avatarUrl: null },
        title: "Sam Lee claimed a seat on Intro to Hooks",
        detail: null,
        excerpt: null,
        href: "/team",
      },
      insertedAt: "2026-11-16T10:00:00.000Z",
      readAt: "2026-11-16T11:00:00.000Z",
    });
  });

  it("never carries Knock's rendered HTML", () => {
    expect(JSON.stringify(toInboxItem(feedItem({})))).not.toContain("<script>");
  });

  it("skips a Notification of a kind Cadence does not know", () => {
    expect(
      toInboxItem(
        feedItem({
          source: { key: "something-new", version_id: "v1", categories: [] },
        })
      )
    ).toBeNull();
  });
});
