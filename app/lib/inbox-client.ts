// The one browser module that talks to Knock. It wraps Knock's headless client
// (no prebuilt UI) and hands the rest of the app Cadence-shaped items, so
// nothing else imports `@knocklabs/client`.
//
// Importing this file is safe on the server; nothing runs until
// `connectInbox` is called, and that is only called from an effect.
import Knock, {
  type Feed,
  type FeedItem,
  type FeedStoreState,
} from "@knocklabs/client";
import { describeNotification, type InboxRow } from "~/lib/inbox-rows";

/** One Notification in the Inbox. */
export type InboxItem = {
  /** The Notification ID. Stable, so toasts can dedupe by it. */
  id: string;
  row: InboxRow;
  /** ISO time the Notification was sent. */
  insertedAt: string;
  /** ISO time it was read, or null while unread. */
  readAt: string | null;
};

export type InboxStatus = "loading" | "fetchMore" | "ready" | "error";

/** What the Inbox shows right now. A new object only when something changed. */
export type InboxState = {
  /** Newest first. Notifications Cadence cannot draw are left out. */
  items: InboxItem[];
  unreadCount: number;
  status: InboxStatus;
};

export const EMPTY_INBOX_STATE: InboxState = {
  items: [],
  unreadCount: 0,
  status: "ready",
};

export type InboxConnectionOptions = {
  /** Cadence user ID. */
  userId: number;
  publicKey: string;
  feedChannelId: string;
  /** A signed Inbox token for `userId`. */
  token: string;
  /**
   * Returns a fresh Inbox token for the same user. Called shortly before the
   * current one expires; the connection restarts with the new token.
   */
  fetchToken: () => Promise<string | null>;
};

export type InboxConnection = {
  /** Snapshot, for `useSyncExternalStore`. Same object until state changes. */
  getState(): InboxState;
  subscribe(listener: () => void): () => void;
  /** Fetches the first page again, replacing what is loaded. */
  refresh(): void;
  /** Marks one Notification read. */
  markAsRead(id: string): void;
  /**
   * Calls the handler with Notifications that arrive live (not the first
   * page, not older pages). Returns an unsubscribe function.
   */
  onArrival(handler: (items: InboxItem[]) => void): () => void;
  /** Closes the connection and the live updates. Call once. */
  disconnect(): void;
};

const PAGE_SIZE = 10;

/** A Notification from Knock as the Inbox shows it, or null if it can't be. */
export function toInboxItem(item: FeedItem): InboxItem | null {
  const first = item.actors[0];
  const row = describeNotification({
    kind: item.source.key,
    actor: first && "name" in first ? first : null,
    data: item.data,
  });
  if (!row) return null;
  return {
    id: item.id,
    row,
    insertedAt: item.inserted_at,
    readAt: item.read_at,
  };
}

function toInboxState(raw: FeedStoreState): InboxState {
  return {
    items: raw.items.flatMap((item) => toInboxItem(item) ?? []),
    unreadCount: raw.metadata.unread_count,
    status: raw.networkStatus,
  };
}

/**
 * Connects to one user's Inbox and starts live updates. Call from an effect,
 * never during render, and `disconnect` in the cleanup.
 */
export function connectInbox(options: InboxConnectionOptions): InboxConnection {
  const knock = new Knock(options.publicKey);
  knock.authenticate({ id: String(options.userId) }, options.token, {
    // The server identifies people when it sends, so no PUT per page load.
    identificationStrategy: "skip",
    onUserTokenExpiring: async () => (await options.fetchToken()) ?? undefined,
  });
  const feed: Feed = knock.feeds.initialize(options.feedChannelId, {
    page_size: PAGE_SIZE,
  });

  // `useSyncExternalStore` needs the same snapshot until something changes.
  let lastRaw: FeedStoreState | null = null;
  let lastState = EMPTY_INBOX_STATE;
  function getState(): InboxState {
    const raw = feed.store.getState();
    if (raw !== lastRaw) {
      lastRaw = raw;
      lastState = toInboxState(raw);
    }
    return lastState;
  }

  const arrivalHandlers = new Set<(items: InboxItem[]) => void>();
  const onRealtime = ({ items }: { items: FeedItem[] }) => {
    const arrived = items.flatMap((item) => toInboxItem(item) ?? []);
    if (arrived.length === 0) return;
    for (const handler of arrivalHandlers) handler(arrived);
  };
  feed.on("items.received.realtime", onRealtime);
  feed.listenForUpdates();
  void feed.fetch();

  return {
    getState,
    subscribe: (listener) => feed.store.subscribe(listener),
    refresh: () => void feed.fetch(),
    markAsRead(id) {
      const item = feed.store.getState().items.find((i) => i.id === id);
      if (item) void feed.markAsRead(item);
    },
    onArrival(handler) {
      arrivalHandlers.add(handler);
      return () => void arrivalHandlers.delete(handler);
    },
    disconnect() {
      arrivalHandlers.clear();
      feed.off("items.received.realtime", onRealtime);
      feed.dispose();
      knock.teardown();
    },
  };
}
