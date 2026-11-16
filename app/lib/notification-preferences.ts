import { z } from "zod";
import {
  KIND_FACTS,
  NOTIFICATION_KINDS,
  type NotificationKind,
} from "~/lib/notifications";
import type { Notifier } from "~/lib/notifier.server";

/** The kinds a person can switch off: the `switchable` ones in `KIND_FACTS`. */
export type PreferenceKind = {
  [K in NotificationKind]: (typeof KIND_FACTS)[K]["switchable"] extends true
    ? K
    : never;
}[NotificationKind];

export const PREFERENCE_KINDS = NOTIFICATION_KINDS.filter(
  (kind): kind is PreferenceKind => KIND_FACTS[kind].switchable
);

const [firstKind, ...otherKinds] = PREFERENCE_KINDS;

/** Parses a form value into a switchable kind; "access-ended" is refused. */
export const preferenceKindSchema = z.enum([firstKind, ...otherKinds]);

/** Every switch, on or off. A kind nobody has saved is on. */
export type Preferences = Record<PreferenceKind, boolean>;

function isComplete(
  preferences: Partial<Preferences>
): preferences is Preferences {
  return PREFERENCE_KINDS.every((kind) => preferences[kind] !== undefined);
}

/** Builds every switch from a rule that says whether each one is on. */
export function preferencesFrom(
  isOn: (kind: PreferenceKind) => boolean
): Preferences {
  const preferences: Partial<Preferences> = {};
  for (const kind of PREFERENCE_KINDS) preferences[kind] = isOn(kind);
  if (!isComplete(preferences)) {
    throw new Error("Every preference kind must be set.");
  }
  return preferences;
}

/** What a person is or has, which decides what they could be sent. */
export type PreferenceAudience = {
  isInstructor: boolean;
  isAdmin: boolean;
  hasPurchase: boolean;
  isTeamAdmin: boolean;
};

const AUDIENCE: Record<
  PreferenceKind,
  (person: PreferenceAudience) => boolean
> = {
  "comment-reply": () => true,
  "refund-request-approved": (p) => p.hasPurchase,
  "refund-request-declined": (p) => p.hasPurchase,
  "lesson-comment": (p) => p.isInstructor,
  "new-enrollment": (p) => p.isInstructor,
  "open-refund-request": (p) => p.isAdmin,
  "seat-claimed": (p) => p.isTeamAdmin,
};

/** The switches this person sees, in card order. */
export function preferenceKindsFor(
  person: PreferenceAudience
): PreferenceKind[] {
  return PREFERENCE_KINDS.filter((kind) => AUDIENCE[kind](person));
}

export type PreferenceSwitch = { kind: PreferenceKind; enabled: boolean };

/** Reads the person's saved preferences and keeps the switches they see. */
export async function loadSwitches(
  notifier: Notifier,
  userId: number,
  person: PreferenceAudience
): Promise<PreferenceSwitch[]> {
  const saved = await notifier.getPreferences(userId);
  return preferenceKindsFor(person).map((kind) => ({
    kind,
    enabled: saved[kind],
  }));
}
