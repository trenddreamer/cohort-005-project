// PROTOTYPE (throwaway, #17 "What does the Inbox look like?").
// Three structurally different Inbox designs, mounted in the real app layout
// and switchable with ?variant=A|B|C (default A) or the ←/→ keys. Sample data
// is in memory and shaped like Knock feed items; nothing calls Knock.
import { useSearchParams } from "react-router";
import { PrototypeSwitcher } from "~/components/prototype-switcher";
import { useInbox } from "./store";
import * as A from "./variant-a";
import * as B from "./variant-b";
import * as C from "./variant-c";

export { InboxPrototypeProvider } from "./store";

const variants = ["A", "B", "C"];
const names = { A: A.name, B: B.name, C: C.name };

function useVariant() {
  const [params] = useSearchParams();
  const v = params.get("variant") ?? "A";
  return variants.includes(v) ? v : "A";
}

/** Sidebar slots: each variant puts its entry point somewhere different. */
export function InboxHeaderSlot() {
  return useVariant() === "A" ? <A.HeaderSlot /> : null;
}
export function InboxNavSlot() {
  return useVariant() === "B" ? <B.NavSlot /> : null;
}
export function InboxFooterSlot() {
  return useVariant() === "C" ? <C.FooterSlot /> : null;
}

export function InboxOverlay() {
  const v = useVariant();
  const inbox = useInbox();
  const btn = "rounded-full px-2 py-1 hover:bg-white/15";
  return (
    <>
      {v === "A" && <A.Overlay key="A" />}
      {v === "B" && <B.Overlay key="B" />}
      {v === "C" && <C.Overlay key="C" />}
      <PrototypeSwitcher variants={variants} names={names}>
        <button
          className={btn}
          onClick={() => inbox.simulate(1)}
          title="A new Notification arrives"
        >
          +1 new
        </button>
        <button
          className={btn}
          onClick={() => inbox.simulate(5)}
          title="5 arrive at once (one is a New Enrollment, so no toast)"
        >
          +5 burst
        </button>
        <button
          className={`${btn} ${inbox.empty ? "bg-white/20" : ""}`}
          onClick={() => inbox.setEmpty(!inbox.empty)}
        >
          Empty
        </button>
        <button
          className={`${btn} ${inbox.videoPlaying ? "bg-white/20" : ""}`}
          onClick={() => inbox.setVideoPlaying(!inbox.videoPlaying)}
          title="Pretend a video is playing: no toasts"
        >
          Video {inbox.videoPlaying ? "▶ playing" : "⏸"}
        </button>
      </PrototypeSwitcher>
    </>
  );
}
