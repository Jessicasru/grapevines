import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { motion, usePresence, useReducedMotion } from "framer-motion";
import { Bookmark, Check, X } from "lucide-react";
import { toast } from "sonner";
import { savesQuery, wineryQuery } from "@/lib/wine";
import { detailSpring } from "@/lib/detail-camera";
import { Avatar, currentUserId, useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t py-3">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 break-words font-serif text-lg">{value}</dd>
    </div>
  );
}

type Verdict = "go" | "skip";
const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function WineryDetail({ id, closing, onClose }: { id: string; closing: boolean; onClose: () => void }) {
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
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("[role=dialog][data-state=open]")) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => { window.removeEventListener("keydown", closeOnEscape); if (previous instanceof HTMLElement) previous.focus({ preventScroll: true }); };
  }, [onClose]);

  const qc = useQueryClient();
  const { user, profile, requireAuth } = useAuth();
  const { data: w } = useSuspenseQuery(wineryQuery(id));
  const saves = useQuery({ ...savesQuery(user?.id ?? ""), enabled: !!user });
  const [step, setStep] = useState<null | "verdict" | "details">(null);
  const [note, setNote] = useState("");
  const [wines, setWines] = useState("");
  const [busy, setBusy] = useState(false);

  if (!w) return null;
  const recs = w.recommendations ?? [];
  const goCount = recs.filter((r) => r.verdict === "go").length;
  const mine = user ? recs.find((r) => r.user_id === user.id) ?? null : null;
  const wanted = !!saves.data?.some((s) => s.winery_id === id && s.status === "want_to_visit");

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["winery", id] }),
    qc.invalidateQueries({ queryKey: ["wineries"] }),
    qc.invalidateQueries({ queryKey: ["saves"] }),
  ]);
  const fail = () => { toast.error("Something went wrong. Please try again."); };

  const toggleWant = () => requireAuth(async () => {
    const uid = await currentUserId();
    if (!uid) return;
    const isWanted = !!qc.getQueryData(savesQuery(uid).queryKey)?.some((s) => s.winery_id === id && s.status === "want_to_visit");
    const { error } = isWanted
      ? await supabase.from("saves").delete().match({ user_id: uid, winery_id: id, status: "want_to_visit" })
      : await supabase.from("saves").insert({ user_id: uid, winery_id: id, status: "want_to_visit" });
    if (error) { fail(); return; }
    toast.success(isWanted ? "Removed from Want to visit" : "Saved to Want to visit");
    void refresh();
  });

  const startBeenHere = () => requireAuth(() => {
    if (mine) { setNote(mine.note); setWines(mine.wines_to_try ?? ""); setStep("details"); }
    else setStep("verdict");
  });

  const pickVerdict = async (verdict: Verdict) => {
    const uid = await currentUserId();
    if (!uid) return;
    setBusy(true);
    const { error } = mine
      ? await supabase.from("recommendations").update({ verdict }).eq("id", mine.id)
      : await supabase.from("recommendations").insert({
          winery_id: id, user_id: uid, verdict, note: "",
          author_name: (profile?.display_name ?? "Traveller").slice(0, 80),
        });
    if (!error) await supabase.from("saves").upsert({ user_id: uid, winery_id: id, status: "been_here" }, { onConflict: "user_id,winery_id,status", ignoreDuplicates: true });
    setBusy(false);
    if (error) { fail(); return; }
    await refresh();
    if (!mine) { setNote(""); setWines(""); setStep("details"); }
  };

  const saveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mine) return;
    setBusy(true);
    const { error } = await supabase.from("recommendations")
      .update({ note: note.trim().slice(0, 2000), wines_to_try: wines.trim().slice(0, 500) || null })
      .eq("id", mine.id);
    setBusy(false);
    if (error) { fail(); return; }
    setStep(null);
    toast.success("Recommendation saved");
    void refresh();
  };

  const deleteMine = async () => {
    if (!mine || !window.confirm("Delete your recommendation?")) return;
    const uid = await currentUserId();
    const { error } = await supabase.from("recommendations").delete().eq("id", mine.id);
    if (error) { fail(); return; }
    if (uid) await supabase.from("saves").delete().match({ user_id: uid, winery_id: id, status: "been_here" });
    setStep(null);
    toast.success("Recommendation deleted");
    void refresh();
  };

  const field = "mt-1 w-full rounded-lg border bg-card px-4 py-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <motion.aside
      ref={panelRef} tabIndex={-1} role="dialog" aria-modal={false} aria-labelledby="winery-detail-title"
      className="winery-detail absolute z-30 flex flex-col overflow-hidden rounded-lg bg-card shadow outline-none"
      initial={{ opacity: 0, x: !reduced && desktop ? -48 : 0, y: !reduced && !desktop ? 48 : 0 }} animate={{ opacity: closing ? 0 : 1, x: closing && !reduced && desktop ? -48 : 0, y: closing && !reduced && !desktop ? 48 : 0 }}
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
        {w.photo_url ? <motion.img {...(reduced ? {} : { layoutId: `photo-${w.id}` })} transition={detailSpring}
          src={w.photo_url} alt={w.name} className="aspect-[16/9] w-full object-cover" /> : <div className="h-14" />}
        <div className="px-5">
        <p className="eyebrow mt-5">{w.regions?.name}, {w.regions?.country}</p>
        <motion.h1 id="winery-detail-title" {...(reduced ? {} : { layoutId: `name-${w.id}` })} transition={detailSpring}
          className="mt-2 break-words text-2xl font-semibold leading-tight">{w.name}</motion.h1>
        <motion.div {...(reduced ? {} : { layoutId: `tags-${w.id}` })} transition={detailSpring} className="mt-3 flex gap-1.5">
          <span className="rounded-full bg-tag px-2 py-0.5 text-xs font-semibold text-tag-foreground">{w.appointment_required ? "Appointment" : "Walk-ins"}</span>
          {w.tasting_fee && <span className="rounded-full bg-tag px-2 py-0.5 text-xs font-semibold text-tag-foreground">{w.tasting_fee}</span>}
        </motion.div>
        <p className="mt-3 text-sm text-muted-foreground">{w.address ?? w.village}</p>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button type="button" variant={wanted ? "default" : "outline"} aria-pressed={wanted} onClick={toggleWant} className="h-11 rounded-full font-semibold">
            <Bookmark className={wanted ? "fill-current" : ""} /> Want to visit
          </Button>
          <Button type="button" variant={mine ? "default" : "outline"} aria-pressed={!!mine} onClick={startBeenHere} className="h-11 rounded-full font-semibold">
            <Check /> Been here
          </Button>
        </div>

        {step === "verdict" && (
          <div className="mt-4 rounded-lg bg-tag p-4">
            <p className="font-semibold">Would you send a friend?</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["go", "skip"] as const).map((v) => (
                <Button key={v} type="button" disabled={busy} onClick={() => pickVerdict(v)} variant={v === "go" ? "default" : "outline"} className="h-12 rounded-full text-base font-semibold">
                  {v === "go" ? "Go" : "Skip"}
                </Button>
              ))}
            </div>
            <button type="button" onClick={() => setStep(null)} className="mt-3 text-sm text-muted-foreground">Cancel</button>
          </div>
        )}

        {step === "details" && mine && (
          <form onSubmit={saveDetails} className="mt-4 space-y-3 rounded-lg bg-tag p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold">Your verdict</p>
              <div className="flex gap-1.5">
                {(["go", "skip"] as const).map((v) => (
                  <Button key={v} type="button" size="sm" disabled={busy} aria-pressed={mine.verdict === v} onClick={() => mine.verdict !== v && pickVerdict(v)}
                    variant={mine.verdict === v ? "default" : "outline"} className="rounded-full">{v === "go" ? "Go" : "Skip"}</Button>
                ))}
              </div>
            </div>
            <label className="block text-sm font-semibold">Note <span className="font-normal text-muted-foreground">(optional)</span>
              <textarea className={`${field} min-h-24`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="The welcome, the view, the moment…" />
            </label>
            <label className="block text-sm font-semibold">Wines to try <span className="font-normal text-muted-foreground">(optional)</span>
              <input className={field} value={wines} onChange={(e) => setWines(e.target.value)} maxLength={500} placeholder="e.g. Riesling Grand Cru Schlossberg" />
            </label>
            <div className="flex items-center gap-2">
              <Button disabled={busy} className="h-11 rounded-full px-5 font-semibold">{busy ? "Saving…" : "Save"}</Button>
              <Button type="button" variant="ghost" onClick={() => setStep(null)} className="h-11 rounded-full">Done</Button>
            </div>
          </form>
        )}

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
          <div className="border-b pb-3">
            <p className="eyebrow">From fellow travellers</p>
            <h2 className="break-words text-lg">{recs.length ? `${goCount} of ${recs.length} say go` : "No notes yet"}</h2>
          </div>
          <ul className="divide-y">
            {recs.map((r) => {
              const name = r.profiles?.display_name ?? r.author_name;
              const own = !!user && r.user_id === user.id;
              return (
                <li key={r.id} className="break-words py-5">
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
                    <Avatar name={name} url={r.profiles?.avatar_url} className="size-9 text-sm" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{name}</p>
                      <p className="text-xs text-muted-foreground">{dateFmt.format(new Date(r.created_at))}</p>
                    </div>
                    <span className={`rounded-full px-3 py-0.5 text-xs font-bold uppercase tracking-wider ${r.verdict === "go" ? "bg-go text-go-foreground" : "bg-muted text-muted-foreground"}`}>
                      {r.verdict}
                    </span>
                  </div>
                  {r.note && <p className="mt-3 text-base leading-relaxed">“{r.note}”</p>}
                  {r.wines_to_try && (
                    <p className="mt-3 text-sm"><span className="eyebrow mr-2">Try</span>{r.wines_to_try}</p>
                  )}
                  {own && (
                    <div className="mt-3 flex gap-4 text-sm font-semibold">
                      <button type="button" className="text-primary" onClick={startBeenHere}>Edit</button>
                      <button type="button" className="text-muted-foreground" onClick={deleteMine}>Delete</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
        </div>
      </article>
    </motion.aside>
  );
}
