import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, currentUserId, useAuth } from "@/lib/auth";
import { distanceKm, savesQuery, searchWineries, villageOf, type Region, type SaveStatus, type Winery } from "@/lib/wine";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function SearchBox({ wineries, onPick, onAdd }: { wineries: Winery[]; onPick: (w: Winery) => void; onAdd: (name: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const results = searchWineries(wineries, q);
  const show = open && q.trim().length > 0;
  return (
    <div className="relative min-w-0 flex-1" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground lg:size-5" />
      <input
        type="search" value={q} placeholder="Search wineries" aria-label="Search wineries"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); setOpen(false); } if (e.key === "Enter" && results[0]) { onPick(results[0]); setQ(""); setOpen(false); } }}
        className="h-9 w-full min-w-0 rounded-full bg-secondary pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-11 lg:pl-10 lg:text-base"
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

export function MyWineriesDrawer({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (id: string, regionId: string) => void }) {
  const { user, profile, openProfile, signOut } = useAuth();
  const saves = useQuery({ ...savesQuery(user?.id ?? ""), enabled: !!user && open });
  const list = (status: SaveStatus) => (saves.data ?? []).filter((s) => s.status === status && s.wineries);
  const renderList = (status: SaveStatus, empty: string) => {
    const rows = list(status);
    if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">{saves.isLoading ? "Loading…" : empty}</p>;
    return (
      <ul className="divide-y">
        {rows.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => onPick(s.winery_id, s.wineries!.region_id)} className="flex w-full items-center gap-3 py-3 text-left">
              {s.wineries!.photo_url ? <img src={s.wineries!.photo_url} alt="" className="size-12 rounded-lg object-cover" /> : <span className="size-12 rounded-lg bg-muted" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.wineries!.name}</span>
                <span className="block truncate text-sm text-muted-foreground">{villageOf(s.wineries!)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  };
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-h-[90dvh] max-w-xl rounded-t-lg border-0 bg-card shadow">
        <div className="flex items-center gap-3 px-5 pb-2 pt-3">
          <Avatar name={profile?.display_name} url={profile?.avatar_url} className="size-10" />
          <div className="min-w-0 flex-1">
            <DrawerTitle className="text-lg">My wineries</DrawerTitle>
            <DrawerDescription className="truncate">{profile?.display_name}</DrawerDescription>
          </div>
          <Button variant="ghost" size="sm" className="rounded-full" onClick={openProfile}>Edit profile</Button>
          <Button variant="ghost" size="sm" className="rounded-full" onClick={async () => { onOpenChange(false); await signOut(); }}>Sign out</Button>
        </div>
        <Tabs defaultValue="want_to_visit" className="min-h-0 overflow-y-auto px-5 pb-8">
          <TabsList className="grid w-full grid-cols-2 rounded-full">
            <TabsTrigger value="want_to_visit" className="rounded-full">Want to visit</TabsTrigger>
            <TabsTrigger value="been_here" className="rounded-full">Been here</TabsTrigger>
          </TabsList>
          <TabsContent value="want_to_visit">{renderList("want_to_visit", "Nothing saved yet. Tap “Want to visit” on a winery.")}</TabsContent>
          <TabsContent value="been_here">{renderList("been_here", "No visits yet. Tap “Been here” on a winery you’ve visited.")}</TabsContent>
        </Tabs>
      </DrawerContent>
    </Drawer>
  );
}
