import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createKnockNotifier,
  knockConfigFromEnv,
  createNotifierFromEnv,
  notify,
  type KnockWorkflows,
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

describe("the Knock Notifier", () => {
  function stubWorkflows() {
    const trigger = vi.fn<KnockWorkflows["trigger"]>().mockResolvedValue({});
    return { workflows: { trigger }, trigger };
  }

  it("triggers the workflow named by the kind, identifying people inline", async () => {
    const { workflows, trigger } = stubWorkflows();

    await createKnockNotifier(workflows).send(newEnrollment([jo], sam));

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

    await createKnockNotifier(workflows).send(newEnrollment([sam, jo], sam));

    expect(trigger.mock.calls[0][1].recipients.map((r) => r.id)).toEqual(["8"]);
  });

  it("sends nothing when the actor was the only recipient", async () => {
    const { workflows, trigger } = stubWorkflows();

    await createKnockNotifier(workflows).send(newEnrollment([sam], sam));

    expect(trigger).not.toHaveBeenCalled();
  });

  it("sends no actor for a Notification that has none", async () => {
    const { workflows, trigger } = stubWorkflows();

    await createKnockNotifier(workflows).send({
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
