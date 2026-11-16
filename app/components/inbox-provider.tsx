import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  connectInbox,
  EMPTY_INBOX_STATE,
  type InboxConnection,
  type InboxItem,
  type InboxState,
} from "~/lib/inbox-client";

/** What the app layout's loader gives the browser. Null: Inbox not set up. */
export type InboxConfig = {
  userId: number;
  publicKey: string;
  feedChannelId: string;
  token: string;
};

type InboxContextValue = {
  /** True when an Inbox connection is open (Knock is set up). */
  connected: boolean;
  state: InboxState;
  isOpen: boolean;
  setOpen(open: boolean): void;
  markAsRead(id: string): void;
  /** Subscribe to Notifications arriving live. Returns an unsubscribe. */
  onArrival(handler: (items: InboxItem[]) => void): () => void;
};

const InboxContext = createContext<InboxContextValue | null>(null);

export function useInbox(): InboxContextValue {
  const value = useContext(InboxContext);
  if (!value) throw new Error("useInbox must be used inside <InboxProvider>");
  return value;
}

async function fetchInboxToken(): Promise<string | null> {
  const response = await fetch("/api/inbox-token");
  if (!response.ok) return null;
  const body: unknown = await response.json();
  if (body instanceof Object && "token" in body) {
    return typeof body.token === "string" ? body.token : null;
  }
  return null;
}

/**
 * Holds one live Inbox connection for the signed-in user. The connection is
 * keyed on the user, so a DevUI user switch closes it and opens the new
 * user's. A new token from the layout loader does not reconnect: the client
 * renews its own token through `/api/inbox-token` before it expires.
 */
export function InboxProvider({
  config,
  children,
}: {
  config: InboxConfig | null;
  children: React.ReactNode;
}) {
  const [state, setState] = useState(EMPTY_INBOX_STATE);
  const [isOpen, setIsOpen] = useState(false);
  const connectionRef = useRef<InboxConnection | null>(null);
  // Held here, not on the connection: a child's effect runs before this
  // provider's, so it can subscribe before the connection exists.
  const arrivalHandlers = useRef(new Set<(items: InboxItem[]) => void>());

  // The first token goes to the connection; later ones are ignored (see above).
  const tokenRef = useRef(config?.token);
  tokenRef.current = config?.token;

  const connected = config !== null;
  const userId = config?.userId;
  const publicKey = config?.publicKey;
  const feedChannelId = config?.feedChannelId;

  useEffect(() => {
    const token = tokenRef.current;
    if (userId === undefined || !publicKey || !feedChannelId || !token) return;
    const connection = connectInbox({
      userId,
      publicKey,
      feedChannelId,
      token,
      fetchToken: fetchInboxToken,
    });
    connectionRef.current = connection;
    const stopArrivals = connection.onArrival((items) => {
      for (const handler of arrivalHandlers.current) handler(items);
    });
    setState(connection.getState());
    const unsubscribe = connection.subscribe(() =>
      setState(connection.getState())
    );
    return () => {
      unsubscribe();
      stopArrivals();
      connection.disconnect();
      connectionRef.current = null;
      setState(EMPTY_INBOX_STATE);
      setIsOpen(false);
    };
  }, [userId, publicKey, feedChannelId]);

  const setOpen = useCallback((open: boolean) => {
    // Opening starts from the newest Notifications again.
    if (open) connectionRef.current?.refresh();
    setIsOpen(open);
  }, []);

  const markAsRead = useCallback((id: string) => {
    connectionRef.current?.markAsRead(id);
  }, []);

  const onArrival = useCallback((handler: (items: InboxItem[]) => void) => {
    arrivalHandlers.current.add(handler);
    return () => void arrivalHandlers.current.delete(handler);
  }, []);

  const value = useMemo(
    () => ({
      connected,
      state,
      isOpen,
      setOpen,
      markAsRead,
      onArrival,
    }),
    [connected, state, isOpen, setOpen, markAsRead, onArrival]
  );

  return (
    <InboxContext.Provider value={value}>{children}</InboxContext.Provider>
  );
}
