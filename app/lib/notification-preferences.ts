import type { NotificationKind } from "~/lib/notifications";
import type { Notifier } from "~/lib/notifier.server";

/**
 * The kinds a person can switch off. "Access ended" is left out on purpose:
 * its workflow overrides preferences, so it always arrives.
 */
export const PREFERENCE_KINDS = [
  "comment-reply",
  "refund-request-approved",
  "refund-request-declined",
  "lesson-comment",
  "new-enrollment",
  "open-refund-request",
  "seat-claimed",
] as const satisfies readonly NotificationKind[];

export type PreferenceKind = (typeof PREFERENCE_KINDS)[number];

/** Every switch, on or off. A kind nobody has saved is on. */
export type Preferences = Record<PreferenceKind, boolean>;

export function isPreferenceKind(value: string): value is PreferenceKind {
  return (PREFERENCE_KINDS as readonly string[]).includes(value);
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

/**
 * Saves one switch. Takes the kind as a string because it comes from a form:
 * anything that is not a switchable kind (including "access-ended") is
 * refused and nothing is saved.
 */
export async function savePreference(
  notifier: Notifier,
  userId: number,
  kind: string,
  enabled: boolean
): Promise<{ ok: true } | { ok: false }> {
  if (!isPreferenceKind(kind)) return { ok: false };
  await notifier.setPreference(userId, kind, enabled);
  return { ok: true };
}
