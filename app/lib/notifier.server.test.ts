import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createKnockNotifier,
  createNoopNotifier,
  knockConfigFromEnv,
  createNotifierFromEnv,
  notify,
  type KnockWorkflows,
  type KnockUsers,
} from "./notifier.server";
import type { Notification, NotificationUser } from "./notifications";
import { createRecordingNotifier } from "~/test/recording-notifier";

const sam: NotificationUser = { id: 7, name: "Sam", avatarUrl: null };
const jo: NotificationUser = {
  id: 8,
  name: "Jo",
  avatarUrl: "https://example.com/jo.png",
};
const ana: NotificationUser = { id: 9, name: "Ana", avatarUrl: null };

function newEnrollment(
  recipients: NotificationUser[],
  actor: NotificationUser
): Notification {
  return {
    kind: "new-enrollment",
    recipients,
    actor,
    data: { course_title: "Test Course", course_id: 3 },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the recording fake", () => {
  it("records kind, recipient IDs, actor and data", async () => {
    const notifier = createRecordingNotifier();

    await notifier.send(newEnrollment([jo], sam));

    expect(notifier.sent).toEqual([
      {
        kind: "new-enrollment",
        recipientIds: [8],
        actor: sam,
        data: { course_title: "Test Course", course_id: 3 },
      },
    ]);
  });

  it("drops the actor from the recipients", async () => {
    const notifier = createRecordingNotifier();

    await notifier.send(newEnrollment([sam, jo, ana], jo));

    expect(notifier.sent[0].recipientIds).toEqual([7, 9]);
  });
});

function stubUsers() {
  const getPreferences = vi
    .fn<KnockUsers["getPreferences"]>()
    .mockResolvedValue({ workflows: null });
  const setPreferences = vi
    .fn<KnockUsers["setPreferences"]>()
    .mockResolvedValue({});
  return {
    users: { getPreferences, setPreferences },
    getPreferences,
    setPreferences,
  };
}

describe("the Knock Notifier preferences", () => {
  const workflows = { trigger: vi.fn() };

  it("saves one switch with a merge, in the in-app feed channel type", async () => {
    const { users, setPreferences } = stubUsers();

    await createKnockNotifier(workflows, users).setPreference(
      7,
      "comment-reply",
      false
    );

    expect(setPreferences).toHaveBeenCalledWith("7", "default", {
      __persistence_strategy__: "merge",
      workflows: { "comment-reply": { channel_types: { in_app_feed: false } } },
    });
  });

  it("reads everything as on when nothing is saved", async () => {
    const { users } = stubUsers();

    const preferences = await createKnockNotifier(
      workflows,
      users
    ).getPreferences(7);

    expect(Object.values(preferences)).toEqual(Array(7).fill(true));
  });

  it("reads a switch as off only when Knock says false", async () => {
    const { users, getPreferences } = stubUsers();
    getPreferences.mockResolvedValue({
      workflows: {
        "comment-reply": { channel_types: { in_app_feed: false } },
        "lesson-comment": false,
        "new-enrollment": { channel_types: { email: false } },
        "seat-claimed": { channel_types: { in_app_feed: true } },
      },
    });

    const preferences = await createKnockNotifier(
      workflows,
      users
    ).getPreferences(7);

    expect(preferences["comment-reply"]).toBe(false);
    expect(preferences["lesson-comment"]).toBe(false);
    expect(preferences["new-enrollment"]).toBe(true);
    expect(preferences["seat-claimed"]).toBe(true);
    expect(preferences["open-refund-request"]).toBe(true);
  });

  it("reads everything as on for a person Knock has never seen", async () => {
    const { users, getPreferences } = stubUsers();
    getPreferences.mockRejectedValue(
      Object.assign(new Error("not found"), { status: 404 })
    );

    const preferences = await createKnockNotifier(
      workflows,
      users
    ).getPreferences(7);

    expect(preferences["comment-reply"]).toBe(true);
  });

  it("does not hide other failures", async () => {
    const { users, getPreferences } = stubUsers();
    getPreferences.mockRejectedValue(
      Object.assign(new Error("boom"), { status: 500 })
    );

    await expect(
      createKnockNotifier(workflows, users).getPreferences(7)
    ).rejects.toThrow("boom");
  });
});

describe("the no-op Notifier preferences", () => {
  it("reads everything as on and accepts a save", async () => {
    const notifier = createNoopNotifier();
    await notifier.setPreference(7, "comment-reply", false);
    expect((await notifier.getPreferences(7))["comment-reply"]).toBe(true);
  });
});

describe("the Knock Notifier", () => {
  function stubWorkflows() {
    const trigger = vi.fn<KnockWorkflows["trigger"]>().mockResolvedValue({});
    return { workflows: { trigger }, trigger };
  }

  it("triggers the workflow named by the kind, identifying people inline", async () => {
    const { workflows, trigger } = stubWorkflows();

    await createKnockNotifier(workflows, stubUsers().users).send(
      newEnrollment([jo], sam)
    );

    expect(trigger).toHaveBeenCalledWith("new-enrollment", {
      recipients: [
        { id: "8", name: "Jo", avatar: "https://example.com/jo.png" },
      ],
      actor: { id: "7", name: "Sam", avatar: null },
      data: { course_title: "Test Course", course_id: 3 },
    });
  });

  it("drops the actor from the recipients", async () => {
    const { workflows, trigger } = stubWorkflows();

    await createKnockNotifier(workflows, stubUsers().users).send(
      newEnrollment([sam, jo], sam)
    );

    expect(trigger.mock.calls[0][1].recipients.map((r) => r.id)).toEqual(["8"]);
  });

  it("sends nothing when the actor was the only recipient", async () => {
    const { workflows, trigger } = stubWorkflows();

    await createKnockNotifier(workflows, stubUsers().users).send(
      newEnrollment([sam], sam)
    );

    expect(trigger).not.toHaveBeenCalled();
  });

  it("sends no actor for a Notification that has none", async () => {
    const { workflows, trigger } = stubWorkflows();

    await createKnockNotifier(workflows, stubUsers().users).send({
      kind: "refund-request-declined",
      recipients: [jo],
      data: { course_title: "Test Course", course_slug: "test-course" },
    });

    expect(trigger.mock.calls[0][1].actor).toBeUndefined();
  });
});

describe("notify", () => {
  it("logs one line with the kind, recipient, status and message, and does not throw", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const failing = createRecordingNotifier({
      failWith: Object.assign(new Error("401 Unauthorized"), { status: 401 }),
    });

    await expect(notify(failing, newEnrollment([jo], sam))).resolves.toBe(
      undefined
    );

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "[notifier] new-enrollment to user 8 failed: 401 401 Unauthorized"
    );
  });

  it("never logs the excerpt", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const failing = createRecordingNotifier({ failWith: new Error("boom") });

    await notify(failing, {
      kind: "open-refund-request",
      recipients: [jo],
      actor: sam,
      data: { course_title: "Test Course", excerpt: "my private reason" },
    });

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0][0])).not.toContain(
      "my private reason"
    );
  });
});

describe("choosing a Notifier from the environment", () => {
  it.each([
    ["missing", {}],
    ["empty", { KNOCK_API_KEY: "" }],
    ["blank", { KNOCK_API_KEY: "   " }],
  ])("finds no Knock config when the key is %s", (_, env) => {
    expect(knockConfigFromEnv(env)).toBeNull();
  });

  it("finds the Knock config when the key is set", () => {
    expect(knockConfigFromEnv({ KNOCK_API_KEY: "sk_test_x" })).toEqual({
      apiKey: "sk_test_x",
    });
  });

  it("warns once and skips every Notification when the key is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const notifier = createNotifierFromEnv({});

    expect(warn).toHaveBeenCalledTimes(1);
    await expect(notifier.send(newEnrollment([jo], sam))).resolves.toBe(
      undefined
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not warn when the key is set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    createNotifierFromEnv({ KNOCK_API_KEY: "sk_test_x" });

    expect(warn).not.toHaveBeenCalled();
  });
});
