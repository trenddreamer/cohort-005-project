import { generateKeyPairSync, createPublicKey, verify } from "node:crypto";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createKnockNotifier,
  createNoopNotifier,
  knockConfigFromEnv,
  createNotifierFromEnv,
  notify,
  describeFailure,
  type KnockWorkflows,
  type KnockUsers,
} from "./notifier.server";
import type { Notification, NotificationUser } from "./notifications";
import { createRecordingNotifier } from "~/test/recording-notifier";

// A throwaway key pair: the real signing key is never used in tests.
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const signingKey = Buffer.from(privateKey).toString("base64");

function decodeJwt(token: string) {
  const [header, payload, signature] = token.split(".");
  const json = (part: string) =>
    JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  return {
    header: json(header),
    claims: json(payload),
    signatureValid: verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      createPublicKey(publicKey),
      Buffer.from(signature, "base64url")
    ),
  };
}

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

    await createKnockNotifier(workflows, users, signingKey).setPreference(
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
      users,
      signingKey
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
      users,
      signingKey
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
      users,
      signingKey
    ).getPreferences(7);

    expect(preferences["comment-reply"]).toBe(true);
  });

  it("does not hide other failures", async () => {
    const { users, getPreferences } = stubUsers();
    getPreferences.mockRejectedValue(
      Object.assign(new Error("boom"), { status: 500 })
    );

    await expect(
      createKnockNotifier(workflows, users, signingKey).getPreferences(7)
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

    await createKnockNotifier(workflows, stubUsers().users, signingKey).send(
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

    await createKnockNotifier(workflows, stubUsers().users, signingKey).send(
      newEnrollment([sam, jo], sam)
    );

    expect(trigger.mock.calls[0][1].recipients.map((r) => r.id)).toEqual(["8"]);
  });

  it("sends nothing when the actor was the only recipient", async () => {
    const { workflows, trigger } = stubWorkflows();

    await createKnockNotifier(workflows, stubUsers().users, signingKey).send(
      newEnrollment([sam], sam)
    );

    expect(trigger).not.toHaveBeenCalled();
  });

  it("sends no actor for a Notification that has none", async () => {
    const { workflows, trigger } = stubWorkflows();

    await createKnockNotifier(workflows, stubUsers().users, signingKey).send({
      kind: "refund-request-declined",
      recipients: [jo],
      data: { course_title: "Test Course", course_slug: "test-course" },
    });

    expect(trigger.mock.calls[0][1].actor).toBeUndefined();
  });
});

describe("issuing an Inbox token", () => {
  const workflows = { trigger: vi.fn<KnockWorkflows["trigger"]>() };

  it("signs RS256 for the Cadence user ID, valid for about an hour", async () => {
    const token = await createKnockNotifier(
      workflows,
      stubUsers().users,
      signingKey
    ).issueInboxToken(42);

    expect(token).not.toBeNull();
    const { header, claims, signatureValid } = decodeJwt(token ?? "");
    expect(header.alg).toBe("RS256");
    expect(claims.sub).toBe("42");
    expect(claims.exp - claims.iat).toBe(3600);
    expect(signatureValid).toBe(true);
  });

  it("issues no token from the no-op Notifier", async () => {
    await expect(createNoopNotifier().issueInboxToken(42)).resolves.toBeNull();
  });

  it("records the user IDs the recording fake issued tokens for", async () => {
    const notifier = createRecordingNotifier();

    await notifier.issueInboxToken(5);
    await notifier.issueInboxToken(6);

    expect(notifier.tokensIssuedFor).toEqual([5, 6]);
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

  it("logs one line per actual recipient, never for the actor", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const failing = createRecordingNotifier({
      failWith: Object.assign(new Error("boom"), { status: 500 }),
    });

    await notify(failing, newEnrollment([jo, sam, ana], sam));

    expect(consoleError.mock.calls).toEqual([
      ["[notifier] new-enrollment to user 8 failed: 500 boom"],
      ["[notifier] new-enrollment to user 9 failed: 500 boom"],
    ]);
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

describe("describeFailure", () => {
  it("gives the status and message, never the error object", () => {
    const error = Object.assign(new Error("rate limited"), {
      status: 429,
      headers: { authorization: "Bearer secret" },
    });
    expect(describeFailure(error)).toBe("429 rate limited");
  });

  it("copes with an error that has no status or is not an Error", () => {
    expect(describeFailure(new Error("boom"))).toBe("no status boom");
    expect(describeFailure("weird")).toBe("no status unknown error");
  });
});

const fullEnv = {
  KNOCK_API_KEY: "sk_test_x",
  KNOCK_PUBLIC_API_KEY: "pk_test_x",
  KNOCK_FEED_CHANNEL_ID: "channel-1",
  KNOCK_SIGNING_KEY: "signing-key",
};

describe("choosing a Notifier from the environment", () => {
  it.each([
    ["the API key is missing", {}],
    ["the API key is empty", { ...fullEnv, KNOCK_API_KEY: "" }],
    ["the API key is blank", { ...fullEnv, KNOCK_API_KEY: "   " }],
    [
      "the public key is missing",
      { ...fullEnv, KNOCK_PUBLIC_API_KEY: undefined },
    ],
    [
      "the Inbox channel ID is blank",
      { ...fullEnv, KNOCK_FEED_CHANNEL_ID: " " },
    ],
    ["the signing key is empty", { ...fullEnv, KNOCK_SIGNING_KEY: "" }],
  ])("finds no Knock config when %s", (_, env) => {
    expect(knockConfigFromEnv(env)).toBeNull();
  });

  it("finds the Knock config when every setting is there", () => {
    expect(knockConfigFromEnv(fullEnv)).toEqual({
      apiKey: "sk_test_x",
      publicKey: "pk_test_x",
      inboxChannelId: "channel-1",
      signingKey: "signing-key",
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

    createNotifierFromEnv(fullEnv);

    expect(warn).not.toHaveBeenCalled();
  });
});
