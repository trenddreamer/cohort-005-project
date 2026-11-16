import { createNotifierFromEnv, type Notifier } from "~/lib/notifier.server";

// Chosen when this module loads, which in the production server is when it
// starts, so a missing Knock key warns once at start rather than on the first
// request. (In `npm run dev` modules load on demand, so it warns on first use.)
// Kept apart from `notifier.server.ts` so tests that import that module do not
// trigger the choice.
const notifier = createNotifierFromEnv(process.env);

/** The process-wide Notifier. Routes pass it in, as they pass the database. */
export function getNotifier(): Notifier {
  return notifier;
}
