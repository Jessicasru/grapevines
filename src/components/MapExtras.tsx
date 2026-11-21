import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, currentUserId, useAuth } from "@/lib/auth";
import { distanceKm, searchWineries, villageOf, type Region, type Save, type SaveStatus, type Winery } from "@/lib/wine";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function SearchBox({ wineries, onPick, onAdd }: { wineries: Winery[]; onPick: (w: Winery) => void; onAdd: (name: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const results = searchWineries(wineries, q);
  const show = open && q.trim().length > 0;
  return (
    <div className="relative h-full min-w-0 flex-1" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground lg:size-5" />
      <input
        type="search" value={q} placeholder="Search wineries" aria-label="Search wineries"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); setOpen(false); } if (e.key === "Enter" && results[0]) { onPick(results[0]); setQ(""); setOpen(false); } }}
        className="h-full w-full min-w-0 rounded-full bg-transparent pl-9 pr-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring lg:pl-10"
      />
      {show && (
        <div className="map-glass absolute left-0 right-0 top-full z-20 mt-3 min-w-[16rem] overflow-hidden rounded-lg shadow">
          <ul className="max-h-[50dvh] overflow-y-auto py-1" role="listbox" aria-label="Search results">
            {results.map((w) => (
              <li key={w.id}>
                <button type="button" role="option" aria-selected={false} onClick={() => { onPick(w); setQ(""); setOpen(false); }}
                  className="flex w-full flex-col px-4 py-2.5 text-left hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none">
                  <span className="truncate font-semibold">{w.name}</span>
                  <span className="truncate text-sm text-muted-foreground">{villageOf(w)}</span>
                </button>
              </li>
            ))}
            {!results.length && <li className="px-4 py-2.5 text-sm text-muted-foreground">No wineries match “{q.trim()}”.</li>}
          </ul>
          <button type="button" onClick={() => { onAdd(q.trim()); setQ(""); setOpen(false); }}
            className="flex w-full items-center gap-2 border-t px-4 py-3 text-left text-sm font-semibold text-primary hover:bg-secondary">
            <Plus className="size-4" /> Missing a winery? Add it
          </button>
        </div>
      )}
    </div>
  );
}

export function nearestRegion(regions: Region[], p: [number, number]) {
  return [...regions].sort((a, b) => distanceKm(p, [a.center_lng, a.center_lat]) - distanceKm(p, [b.center_lng, b.center_lat]))[0] ?? null;
}

export function AddWineryPanel({ initialName, picked, regions, onCancel, onCreated }: {
  initialName: string; picked: [number, number] | null; regions: Region[];
  onCancel: () => void; onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(initialName);
  const [village, setVillage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = "h-11 w-full rounded-full border bg-card px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Please add the winery’s name.");
    if (!picked) return setError("Tap the map to place the winery.");
    const region = nearestRegion(regions, picked);
    const uid = await currentUserId();
    if (!region || !uid) return setError("Please sign in again.");
    setBusy(true); setError(null);
    const { data, error } = await supabase.from("wineries").insert({
      name: name.trim().slice(0, 120), village: village.trim().slice(0, 120) || null,
      address: village.trim() || null, region_id: region.id, longitude: picked[0], latitude: picked[1], created_by: uid,
    }).select("id").single();
    setBusy(false);
    if (error || !data) return setError("Couldn’t add the winery. Please try again.");
    await qc.invalidateQueries({ queryKey: ["wineries"] });
    toast.success(`${name.trim()} added`);
    onCreated(data.id);
  };

  return (
    <form onSubmit={save} className="map-glass pointer-events-auto mx-4 mb-4 rounded-lg p-4 shadow sm:mx-auto sm:max-w-md">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Add a winery</h2>
        <Button type="button" variant="ghost" size="icon" onClick={onCancel} aria-label="Cancel adding a winery" className="rounded-full"><X /></Button>
      </div>
      <div className="mt-2 space-y-2">
        <input className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Winery name" aria-label="Winery name" />
        <input className={field} value={village} onChange={(e) => setVillage(e.target.value)} maxLength={120} placeholder="Village" aria-label="Village" />
        <p className={`text-sm ${picked ? "text-foreground" : "text-muted-foreground"}`}>
          {picked ? `Location set (${picked[1].toFixed(4)}, ${picked[0].toFixed(4)}) — tap the map to move it.` : "Tap the map to place the winery."}
        </p>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <Button disabled={busy} className="mt-3 h-11 w-full rounded-full font-semibold">{busy ? "Adding…" : "Add winery"}</Button>
    </form>
  );
}

/** Sits under the nav bar without dimming the map. */
function NavSheet({ label, children }: { label: string; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.section aria-label={label}
      initial={reduced ? { opacity: 0 } : { y: 48, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: reduced ? 0.15 : 0.25 }}
      className="nav-sheet absolute inset-x-0 bottom-0 z-20 mx-auto flex max-w-xl flex-col rounded-t-lg bg-card shadow">
      {children}
    </motion.section>
  );
}

export function SavedSheet({ saves, loading, onPick }: { saves: Save[]; loading: boolean; onPick: (id: string) => void }) {
  const renderList = (status: SaveStatus, empty: string) => {
    const rows = saves.filter((s) => s.status === status);
    if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">{loading ? "Loading…" : empty}</p>;
    return (
      <ul className="divide-y">
        {rows.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => onPick(s.winery_id)} className="flex w-full items-center gap-3 py-3 text-left">
              {s.wineries.photo_url ? <img src={s.wineries.photo_url} alt="" className="size-12 rounded-lg object-cover" /> : <span className="size-12 rounded-lg bg-muted" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.wineries.name}</span>
                <span className="block truncate text-sm text-muted-foreground">{villageOf(s.wineries)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  };
  return (
    <NavSheet label="Saved wineries">
      <h2 className="px-5 pb-2 pt-4 text-lg font-semibold">Saved</h2>
      <Tabs defaultValue="want_to_visit" className="flex min-h-0 flex-1 flex-col px-5">
        <TabsList className="grid w-full shrink-0 grid-cols-2 rounded-full">
          <TabsTrigger value="want_to_visit" className="rounded-full">Want to visit</TabsTrigger>
          <TabsTrigger value="been_here" className="rounded-full">Been here</TabsTrigger>
        </TabsList>
        <TabsContent value="want_to_visit" className="min-h-0 overflow-y-auto overscroll-contain">{renderList("want_to_visit", "Nothing saved yet. Tap “Want to visit” on a winery.")}</TabsContent>
        <TabsContent value="been_here" className="min-h-0 overflow-y-auto overscroll-contain">{renderList("been_here", "No visits yet. Tap “Been here” on a winery you’ve visited.")}</TabsContent>
      </Tabs>
    </NavSheet>
  );
}

export function YouSheet({ onSignedOut }: { onSignedOut: () => void }) {
  const { user, profile, openProfile, signOut } = useAuth();
  return (
    <NavSheet label="Your profile">
      <div className="flex items-center gap-3 px-5 pb-4 pt-5">
        <Avatar name={profile?.display_name ?? user?.email} url={profile?.avatar_url} className="size-12 text-lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold leading-tight">{profile?.display_name ?? "Your profile"}</h2>
          <p className="truncate text-sm text-muted-foreground">{user?.email}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 px-5">
        <Button variant="secondary" className="h-11 rounded-full font-semibold" onClick={openProfile}>Edit profile</Button>
        <Button variant="outline" className="h-11 rounded-full font-semibold" onClick={async () => { onSignedOut(); await signOut(); }}>Sign out</Button>
      </div>
    </NavSheet>
  );
}
