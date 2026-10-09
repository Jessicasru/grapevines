import { Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { motion, usePresence, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { wineryQuery } from "@/lib/wine";
import { detailSpring } from "@/lib/detail-camera";
import { Button } from "@/components/ui/button";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t py-3">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 break-words font-serif text-lg">{value}</dd>
    </div>
  );
}

export function WineryDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const reduced = useReducedMotion();
  const [present, safeToRemove] = usePresence();
  useEffect(() => {
    if (present) return;
    const timer = window.setTimeout(() => safeToRemove?.(), reduced ? 150 : 400);
    return () => window.clearTimeout(timer);
  }, [present, safeToRemove, reduced]);
  const [desktop, setDesktop] = useState(false);
  const swipeStart = useRef<number | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const sync = () => setDesktop(media.matches);
    sync(); media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    panelRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => { window.removeEventListener("keydown", closeOnEscape); if (previous instanceof HTMLElement) previous.focus({ preventScroll: true }); };
  }, [onClose]);
  const { data: w } = useSuspenseQuery(wineryQuery(id));
  if (!w) return null;
  const recs = w.recommendations ?? [];
  const goCount = recs.filter((r) => r.verdict === "go").length;

  return (
    <motion.aside
      ref={panelRef} tabIndex={-1} role="dialog" aria-modal={false} aria-labelledby="winery-detail-title"
      className="winery-detail absolute z-30 flex flex-col overflow-hidden rounded-lg bg-card shadow outline-none"
      initial={{ opacity: 0, x: !reduced && desktop ? -48 : 0, y: !reduced && !desktop ? 48 : 0 }} animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, x: !reduced && desktop ? -48 : 0, y: !reduced && !desktop ? 48 : 0 }} transition={reduced ? { duration: 0.15 } : detailSpring}
    >
      <motion.div className="detail-drag-handle flex shrink-0 justify-center py-3 lg:hidden"
        drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={0.5}
        onDragEnd={(_, info) => { if (info.offset.y > 60 || info.velocity.y > 400) onClose(); }}
      ><span className="h-1 w-10 rounded-full bg-border" /></motion.div>
      <Button variant="secondary" size="icon" onClick={onClose} aria-label="Close winery detail"
        className="absolute right-3 top-3 z-40 h-11 w-11 rounded-full bg-card shadow"><X /></Button>
      <article onTouchStart={(e) => { swipeStart.current = e.currentTarget.scrollTop === 0 ? e.touches[0]?.clientY ?? null : null; }}
        onTouchEnd={(e) => { const end = e.changedTouches[0]?.clientY; if (!desktop && swipeStart.current !== null && end !== undefined && end - swipeStart.current > 80) onClose(); swipeStart.current = null; }} className="min-h-0 overflow-y-auto overscroll-contain pb-8">
        {w.photo_url && <motion.img {...(reduced ? {} : { layoutId: `photo-${w.id}` })} transition={detailSpring}
          src={w.photo_url} alt={w.name} className="aspect-[16/9] w-full object-cover" />}
        <div className="px-5">
        <p className="eyebrow mt-5">{w.regions?.name}, {w.regions?.country}</p>
        <motion.h1 id="winery-detail-title" {...(reduced ? {} : { layoutId: `name-${w.id}` })} transition={detailSpring}
          className="mt-2 break-words text-2xl font-semibold leading-tight">{w.name}</motion.h1>
        <motion.div {...(reduced ? {} : { layoutId: `tags-${w.id}` })} transition={detailSpring} className="mt-3 flex gap-1.5">
          <span className="rounded-full bg-tag px-2 py-0.5 text-xs font-semibold text-tag-foreground">{w.appointment_required ? "Appointment" : "Walk-ins"}</span>
          {w.tasting_fee && <span className="rounded-full bg-tag px-2 py-0.5 text-xs font-semibold text-tag-foreground">{w.tasting_fee}</span>}
        </motion.div>
        <p className="mt-3 text-sm text-muted-foreground">{w.address}</p>

        <dl className="mt-8 grid grid-cols-2 gap-x-6">
          <Fact label="Appointment" value={w.appointment_required ? "Required" : "Not needed"} />
          <Fact label="Tasting fee" value={w.tasting_fee ?? "—"} />
          <Fact label="Open" value={w.opening_days ?? "—"} />
          <Fact label="Ships abroad" value={w.ships_abroad ? "Yes" : "No"} />
          <div className="col-span-2">
            <Fact label="Languages" value={w.languages.join(", ") || "—"} />
          </div>
        </dl>

        <section className="mt-8">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 border-b pb-3">
            <div className="min-w-0">
              <p className="eyebrow">From fellow travellers</p>
              <h2 className="break-words text-lg">
                {recs.length ? `${goCount} of ${recs.length} say go` : "No notes yet"}
              </h2>
            </div>
            <Button asChild className="h-11 shrink-0 px-3 text-sm font-semibold sm:px-4">
            <Link
              to="/wineries/$id/recommend"
              params={{ id: w.id }}
            >
              Add a note
            </Link>
            </Button>
          </div>

          <ul className="divide-y">
            {recs.map((r) => (
              <li key={r.id} className="break-words py-6">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <span className="min-w-0 font-semibold">{r.author_name}</span>
                  <span
                    className={`rounded-full px-3 py-0.5 text-xs font-bold uppercase tracking-wider ${
                      r.verdict === "go" ? "bg-go text-go-foreground" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {r.verdict}
                  </span>
                </div>
                <p className="mt-3 text-base italic leading-relaxed">“{r.note}”</p>
                {r.wines_to_try && (
                  <p className="mt-3 text-sm">
                    <span className="eyebrow mr-2">Try</span>
                    {r.wines_to_try}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
        </div>
      </article>
    </motion.aside>
  );
}
