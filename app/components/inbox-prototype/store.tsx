// PROTOTYPE (throwaway, #17): in-memory Inbox state shared by the three
// variants. Shaped like Knock feed items (actor, data, read_at, inserted_at)
// so the winning design maps onto the real feed later. No Knock calls, no
// persistence: reload resets everything.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

export type Kind =
  | "refund-request-approved"
  | "refund-request-declined"
  | "comment-reply"
  | "lesson-comment"
  | "new-enrollment"
  | "open-refund-request"
  | "seat-claimed"
  | "access-ended";

export interface InboxItem {
  id: string;
  kind: Kind;
  /** The bold headline, e.g. "Sam Lee replied to your comment on Intro to Hooks". */
  title: string;
  /** Optional second sentence from the copy in #13. */
  detail?: string;
  /** User-written text (#3, #4, #6). Always rendered as plain text. */
  excerpt?: string;
  actor?: { name: string; avatarUrl: string | null };
  courseTitle: string;
  url: string;
  insertedAt: Date;
  readAt: Date | null;
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

function seed(): InboxItem[] {
  return [
    {
      id: "n1",
      kind: "comment-reply",
      title: "Sam Lee replied to your comment on Intro to Hooks",
      excerpt:
        "Good question! The effect runs twice in development because of React's Strict Mode. It mounts, unmounts and mounts again to help you find missing cleanup functions, so it's expected and won't…",
      actor: { name: "Sam Lee", avatarUrl: null },
      courseTitle: "React Fundamentals",
      url: "/courses/react-fundamentals/lessons/1#comment-42",
      insertedAt: minutesAgo(4),
      readAt: null,
    },
    {
      id: "n2",
      kind: "open-refund-request",
      title: "Priya Shah requested a refund for Advanced TypeScript",
      excerpt: "I bought the wrong course, I meant to buy the beginner one.",
      actor: { name: "Priya Shah", avatarUrl: null },
      courseTitle: "Advanced TypeScript",
      url: "/admin/refunds",
      insertedAt: minutesAgo(38),
      readAt: null,
    },
    {
      id: "n3",
      kind: "refund-request-approved",
      title: "Refund approved for Advanced TypeScript",
      detail: "We've refunded the $49.00 you paid.",
      courseTitle: "Advanced TypeScript",
      url: "/courses/advanced-typescript",
      insertedAt: minutesAgo(95),
      readAt: null,
    },
    {
      id: "n4",
      kind: "lesson-comment",
      title: "Alex Kim commented on useEffect Deep Dive",
      detail: "in React Fundamentals",
      excerpt:
        "Is there a way to **skip** the first render? I tried `useRef` but it feels hacky.",
      actor: { name: "Alex Kim", avatarUrl: null },
      courseTitle: "React Fundamentals",
      url: "/courses/react-fundamentals/lessons/3#comment-57",
      insertedAt: minutesAgo(60 * 5),
      readAt: minutesAgo(60 * 4),
    },
    {
      id: "n5",
      kind: "seat-claimed",
      title: "Jo Park claimed a seat on React Fundamentals",
      actor: { name: "Jo Park", avatarUrl: null },
      courseTitle: "React Fundamentals",
      url: "/team",
      insertedAt: minutesAgo(60 * 26),
      readAt: minutesAgo(60 * 20),
    },
    {
      id: "n6",
      kind: "new-enrollment",
      title: "Maria Lopez enrolled in React Fundamentals",
      actor: { name: "Maria Lopez", avatarUrl: null },
      courseTitle: "React Fundamentals",
      url: "/instructor/1/students",
      insertedAt: minutesAgo(60 * 30),
      readAt: null,
    },
    {
      id: "n7",
      kind: "refund-request-declined",
      title: "Refund declined for Node.js Basics",
      detail: "You still have access to the course.",
      courseTitle: "Node.js Basics",
      url: "/courses/nodejs-basics",
      insertedAt: minutesAgo(60 * 24 * 3),
      readAt: minutesAgo(60 * 24 * 3),
    },
    {
      id: "n8",
      kind: "access-ended",
      title: "Your access to Python for Data has ended",
      detail:
        "The team purchase was refunded. Your progress is kept if you get access again.",
      courseTitle: "Python for Data",
      url: "/courses/python-for-data",
      insertedAt: minutesAgo(60 * 24 * 9),
      readAt: minutesAgo(60 * 24 * 8),
    },
  ];
}

const arrivals: Omit<InboxItem, "id" | "insertedAt" | "readAt">[] = [
  {
    kind: "comment-reply",
    title: "Dana White replied to your comment on Props and State",
    excerpt: "Same here. Moving the state up one level fixed it for me.",
    actor: { name: "Dana White", avatarUrl: null },
    courseTitle: "React Fundamentals",
    url: "/courses/react-fundamentals/lessons/2#comment-88",
  },
  {
    kind: "seat-claimed",
    title: "Chris Ng claimed a seat on Advanced TypeScript",
    actor: { name: "Chris Ng", avatarUrl: null },
    courseTitle: "Advanced TypeScript",
    url: "/team",
  },
  {
    kind: "open-refund-request",
    title: "Lee Brown requested a refund for Node.js Basics",
    excerpt: "The course moves too fast for me. I'd like to try again later.",
    actor: { name: "Lee Brown", avatarUrl: null },
    courseTitle: "Node.js Basics",
    url: "/admin/refunds",
  },
  {
    kind: "new-enrollment",
    title: "Tom Hart enrolled in React Fundamentals",
    actor: { name: "Tom Hart", avatarUrl: null },
    courseTitle: "React Fundamentals",
    url: "/instructor/1/students",
  },
  {
    kind: "refund-request-approved",
    title: "Refund approved for Node.js Basics",
    detail: "We've refunded the $29.00 you paid.",
    courseTitle: "Node.js Basics",
    url: "/courses/nodejs-basics",
  },
  {
    kind: "lesson-comment",
    title: "Ivy Chen commented on Custom Hooks",
    detail: "in React Fundamentals",
    excerpt:
      "Could you add an example that fetches data? I'm stuck on the loading state.",
    actor: { name: "Ivy Chen", avatarUrl: null },
    courseTitle: "React Fundamentals",
    url: "/courses/react-fundamentals/lessons/5#comment-91",
  },
];

/** A variant decides how a single toast looks. */
export type ToastRenderer = (
  item: InboxItem,
  open: (item: InboxItem) => void
) => string | number;
export type SummaryToastRenderer = (
  count: number,
  openInbox: () => void
) => string | number;

interface InboxState {
  items: InboxItem[];
  unreadCount: number;
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  openItem: (item: InboxItem, navigate: (url: string) => void) => void;
  // Prototype controls
  empty: boolean;
  setEmpty: (empty: boolean) => void;
  videoPlaying: boolean;
  setVideoPlaying: (playing: boolean) => void;
  simulate: (count: number) => void;
  registerToasts: (
    one: ToastRenderer,
    summary: SummaryToastRenderer,
    navigate: (url: string) => void
  ) => void;
}

const Ctx = createContext<InboxState | null>(null);

const MAX_TOASTS = 3;

export function InboxPrototypeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [items, setItems] = useState<InboxItem[]>(seed);
  const [isOpen, setOpen] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const nextArrival = useRef(0);
  const activeToasts = useRef(new Set<string | number>());
  const renderers = useRef<{
    one: ToastRenderer;
    summary: SummaryToastRenderer;
    navigate: (url: string) => void;
  } | null>(null);
  const videoRef = useRef(videoPlaying);
  videoRef.current = videoPlaying;

  const visible = empty ? [] : items;

  const markRead = useCallback((id: string) => {
    setItems((all) =>
      all.map((n) =>
        n.id === id && !n.readAt ? { ...n, readAt: new Date() } : n
      )
    );
  }, []);

  const markAllRead = useCallback(() => {
    setItems((all) =>
      all.map((n) => (n.readAt ? n : { ...n, readAt: new Date() }))
    );
  }, []);

  const openItem = useCallback(
    (item: InboxItem, navigate: (url: string) => void) => {
      markRead(item.id);
      setOpen(false);
      navigate(item.url);
    },
    [markRead]
  );

  const registerToasts = useCallback<InboxState["registerToasts"]>(
    (one, summary, navigate) => {
      renderers.current = { one, summary, navigate };
    },
    []
  );

  // Decided in #13: toasts for every kind except New Enrollment, none while a
  // video plays, at most 3 on screen, then one "You have {n} new" summary.
  const simulate = useCallback(
    (count: number) => {
      const fresh: InboxItem[] = [];
      for (let i = 0; i < count; i++) {
        const template = arrivals[nextArrival.current % arrivals.length];
        nextArrival.current++;
        fresh.push({
          ...template,
          id: `live-${Date.now()}-${i}`,
          insertedAt: new Date(),
          readAt: null,
        });
      }
      setEmpty(false);
      setItems((all) => [...fresh.reverse(), ...all]);

      const r = renderers.current;
      if (!r || videoRef.current) return;
      const toastable = fresh.filter((n) => n.kind !== "new-enrollment");
      let overflow = 0;
      for (const item of toastable) {
        if (activeToasts.current.size >= MAX_TOASTS) {
          overflow++;
          continue;
        }
        const id = r.one(item, (it) => {
          toast.dismiss(id);
          openItem(it, r.navigate);
        });
        track(id);
      }
      if (overflow > 0) {
        const id = r.summary(overflow, () => {
          toast.dismiss(id);
          setOpen(true);
        });
        track(id);
      }
      function track(id: string | number) {
        activeToasts.current.add(id);
        setTimeout(() => activeToasts.current.delete(id), 5_200);
      }
    },
    [openItem]
  );

  const value = useMemo<InboxState>(
    () => ({
      items: visible,
      unreadCount: visible.filter((n) => !n.readAt).length,
      isOpen,
      setOpen,
      markRead,
      markAllRead,
      openItem,
      empty,
      setEmpty,
      videoPlaying,
      setVideoPlaying,
      simulate,
      registerToasts,
    }),
    [
      visible,
      isOpen,
      markRead,
      markAllRead,
      openItem,
      empty,
      videoPlaying,
      simulate,
      registerToasts,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useInbox() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useInbox outside InboxPrototypeProvider");
  return ctx;
}

export function timeAgo(date: Date) {
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function dayGroup(date: Date): "Today" | "Yesterday" | "Earlier" {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (date >= start) return "Today";
  const yesterday = new Date(start.getTime() - 86_400_000);
  if (date >= yesterday) return "Yesterday";
  return "Earlier";
}

/** Strip markdown so excerpts are plain text (prototype-grade). */
export function plainExcerpt(text: string, max = 140) {
  const plain = text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? plain.slice(0, max - 1).trimEnd() + "…" : plain;
}
