import { Compass, Heart } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useAuth } from "@/lib/auth";

type Tab = "explore" | "saved" | "you";

/** Floating bottom pill: Explore (map), Saved, You. Active tab is a sliding burgundy capsule. */
export function BottomNav({ savedOpen, onExplore, onSaved }: { savedOpen: boolean; onExplore: () => void; onSaved: () => void }) {
  const { user, profile, requireAuth, openProfile, profileOpen } = useAuth();
  const reduced = useReducedMotion();
  const active: Tab = profileOpen ? "you" : savedOpen ? "saved" : "explore";
  const initial = (profile?.display_name?.trim()[0] ?? user?.email?.[0] ?? "?").toUpperCase();
  const tabs: { id: Tab; label: string; onClick: () => void }[] = [
    { id: "explore", label: "Explore", onClick: onExplore },
    { id: "saved", label: "Saved", onClick: onSaved },
    { id: "you", label: "You", onClick: () => requireAuth(openProfile) },
  ];
  return (
    <nav aria-label="Main" className="bottom-nav liquid-glass absolute left-1/2 z-20 flex w-[calc(100%-32px)] max-w-[360px] -translate-x-1/2 items-center gap-1 rounded-full p-1.5 ">
      {tabs.map((t) => {
        const on = active === t.id;
        const color = on ? "text-[var(--nav-active)]" : "text-[var(--nav-ink)]";
        return (
          <button key={t.id} type="button" onClick={t.onClick} aria-current={on ? "page" : undefined}
            className={`relative flex h-full flex-1 items-center justify-center gap-1.5 rounded-full text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${color}`}>
            {on && <motion.span layoutId="bottom-nav-capsule" className="absolute inset-0 rounded-full liquid-glass-capsule"
              transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 480, damping: 32, mass: 0.7 }} />}
            <span className="relative flex items-center gap-1.5">
              {t.id === "explore" && <Compass className="size-5" />}
              {t.id === "saved" && <Heart className="size-5" />}
              {t.id === "you" && (
                <span aria-hidden className={`grid size-6 place-items-center rounded-full text-xs font-bold bg-[var(--nav-active)] text-[var(--nav-cream)] [text-shadow:none]`}>{initial}</span>
              )}
              {t.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
