// What a Notification is, shared by the server (which sends them) and the
// browser (the Inbox renders each row by kind). No server code in here.

/** A person as a Notification names them. The id is the Cadence user ID. */
export type NotificationUser = {
  id: number;
  name: string;
  avatarUrl: string | null;
};

/**
 * Each kind is the key of its Knock workflow (`knock/workflows/<key>`), and
 * the `data` field names are the ones those workflows' templates read.
 */
export type NotificationDataByKind = {
  "refund-request-approved": {
    course_title: string;
    course_slug: string;
    /** Preformatted, for example "$49.00". */
    amount: string;
  };
  "refund-request-declined": { course_title: string; course_slug: string };
  "comment-reply": {
    lesson_title: string;
    course_slug: string;
    lesson_id: number;
    comment_id: number;
    /** Plain text from `excerpt()`. */
    excerpt: string;
  };
  "lesson-comment": {
    lesson_title: string;
    course_title: string;
    course_slug: string;
    lesson_id: number;
    comment_id: number;
    /** Plain text from `excerpt()`. */
    excerpt: string;
  };
  "new-enrollment": { course_title: string; course_id: number };
  "open-refund-request": {
    course_title: string;
    /** The learner's reason, plain text from `excerpt()`. */
    excerpt: string;
  };
  "seat-claimed": { course_title: string };
  "access-ended": { course_title: string; course_slug: string };
};

export type NotificationKind = keyof NotificationDataByKind;

/**
 * The per-kind facts that are not data fields, in one place: the label the
 * Settings page shows, and whether a person can switch the kind off. "Access
 * ended" can't be: its workflow overrides preferences, so it always arrives.
 * The order is the order of the Settings switches.
 */
export const KIND_FACTS = {
  "comment-reply": { label: "Replies to your comments", switchable: true },
  "refund-request-approved": {
    label: "Refund request approved",
    switchable: true,
  },
  "refund-request-declined": {
    label: "Refund request declined",
    switchable: true,
  },
  "lesson-comment": {
    label: "New comments on your lessons",
    switchable: true,
  },
  "new-enrollment": { label: "New enrollments", switchable: true },
  "open-refund-request": { label: "Open refund requests", switchable: true },
  "seat-claimed": { label: "Seats claimed on your team", switchable: true },
  "access-ended": { label: "Access ended", switchable: false },
} as const satisfies Record<
  NotificationKind,
  { label: string; switchable: boolean }
>;

export const NOTIFICATION_KINDS = Object.keys(KIND_FACTS) as NotificationKind[];

/**
 * The same person as a Notification names them, from a user row or anything
 * with an id, name and avatar. The one place that mapping is written.
 */
export function toNotificationUser(user: NotificationUser): NotificationUser {
  return { id: user.id, name: user.name, avatarUrl: user.avatarUrl };
}

/** The kinds that name nobody as the sender. */
type KindsWithoutActor =
  "refund-request-approved" | "refund-request-declined" | "access-ended";

type NotificationOf<K extends NotificationKind> = {
  kind: K;
  /** Never includes the actor: the Notifier drops them if it does. */
  recipients: NotificationUser[];
  data: NotificationDataByKind[K];
} & (K extends KindsWithoutActor
  ? { actor?: undefined }
  : { actor: NotificationUser });

/** One Notification to send: a union, so `kind` fixes `actor` and `data`. */
export type Notification = {
  [K in NotificationKind]: NotificationOf<K>;
}[NotificationKind];
