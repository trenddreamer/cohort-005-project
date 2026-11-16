// PROTOTYPE (throwaway): floating bar to flip between UI variants via
// ?variant=. Dev-only. Extra prototype controls can be passed as children.
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function PrototypeSwitcher({
  variants,
  names,
  children,
}: {
  variants: string[];
  names: Record<string, string>;
  children?: React.ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const current = params.get("variant") ?? variants[0];

  function go(delta: number) {
    const i = variants.indexOf(current);
    const next = variants[(i + delta + variants.length) % variants.length];
    setParams(
      (p) => {
        p.set("variant", next);
        return p;
      },
      { replace: true, preventScrollReset: true }
    );
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable='true']"))
        return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!import.meta.env.DEV) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full border-2 border-fuchsia-500 bg-zinc-950 px-2 py-1.5 text-xs text-white shadow-2xl">
      <button
        onClick={() => go(-1)}
        className="rounded-full p-1 hover:bg-white/15"
        title="Previous variant (←)"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-36 text-center font-medium">
        {current} · {names[current] ?? "?"}
      </span>
      <button
        onClick={() => go(1)}
        className="rounded-full p-1 hover:bg-white/15"
        title="Next variant (→)"
      >
        <ChevronRight className="size-4" />
      </button>
      {children && <span className="mx-1 h-4 w-px bg-white/25" />}
      {children}
    </div>
  );
}
