import type { Route } from "./+types/api.inbox-token";
import { requireUserId } from "~/lib/access.server";
import { getNotifier } from "~/lib/notifier-instance.server";

/**
 * A fresh Inbox token for the signed-in user. The Inbox asks for one shortly
 * before its current token expires, so an open page keeps working.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const token = await getNotifier().issueInboxToken(userId);
  return Response.json(
    { token },
    // A token is per user and per moment: never cache it.
    { headers: { "Cache-Control": "no-store" } }
  );
}
