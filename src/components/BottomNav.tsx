import { Compass, Heart } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useAuth } from "@/lib/auth";

export type NavTab = "explore" | "saved" | "you";

/**
 * Floating bottom pill: Explore (map), Saved, You. The active tab is a sliding burgundy-tinted capsule.
 * It sits above every sheet and stays tappable while a modal sheet is open.
 */
export function BottomNav({ active, onSelect }: { active: NavTab; onSelect: (tab: NavTab) => void }) {
  const { user, profile } = useAuth();
  const reduced = useReducedMotion();
  const initial = (profile?.display_name?.trim()[0] ?? user?.email?.[0] ?? "?").toUpperCase();
  const tabs: { id: NavTab; label: string }[] = [
    { id: "explore", label: "Explore" },
    { id: "saved", label: "Saved" },
    { id: "you", label: "You" },
  ];
  return (
    <nav aria-label="Main" className="map-bar bottom-nav pointer-events-auto absolute left-1/2 z-40 grid w-[calc(100%-32px)] max-w-[360px] -translate-x-1/2 grid-cols-3 gap-1 p-1.5">
      {tabs.map((t) => {
        const on = active === t.id;
        return (
          <button key={t.id} type="button" onClick={() => onSelect(t.id)} aria-current={on ? "page" : undefined}
            className={`relative flex h-full min-w-0 items-center justify-center rounded-full text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${on ? "text-[var(--nav-active)]" : "text-[var(--nav-idle)]"}`}>
            {on && <motion.span layoutId="bottom-nav-capsule" className="nav-capsule absolute inset-0 rounded-full"
              transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 34, mass: 0.7 }} />}
            <span className="relative flex items-center gap-1.5">
              {t.id === "explore" && <Compass className="size-5" />}
              {t.id === "saved" && <Heart className="size-5" />}
              {t.id === "you" && (
                <span aria-hidden className={`grid size-6 place-items-center rounded-full text-xs font-bold text-[var(--nav-cream)] ${on ? "bg-[var(--nav-active)]" : "bg-[var(--nav-idle)]"}`}>{initial}</span>
              )}
              {t.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
