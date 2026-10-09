import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ArrowUpRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WineMap } from "@/components/WineMap";
import { distanceKm, regionsQuery, wineriesQuery } from "@/lib/wine";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Cellar Door — Wine trip recommendations" },
      { name: "description", content: "Find wineries worth the detour, with honest notes from fellow travellers." },
      { property: "og:title", content: "Cellar Door — Wine trip recommendations" },
      { property: "og:description", content: "Find wineries worth the detour, with honest notes from fellow travellers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(regionsQuery),
      context.queryClient.ensureQueryData(wineriesQuery),
    ]),
  component: MapPage,
});

function MapPage() {
  const { data: regions } = useSuspenseQuery(regionsQuery);
  const { data: allWineries } = useSuspenseQuery(wineriesQuery);
  const [regionId, setRegionId] = useState(regions[0]?.id ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [me, setMe] = useState<[number, number] | null>(null);
  const [listExpanded, setListExpanded] = useState(false);

  const region = regions.find((r) => r.id === regionId) ?? null;
  const wineries = useMemo(
    () => allWineries.filter((w) => w.region_id === regionId),
    [allWineries, regionId],
  );
  const listRef = useRef<HTMLOListElement>(null);

  const nearby = useMemo(() => {
    if (!me) return [];
    return allWineries
      .map((w) => ({ w, km: distanceKm(me, [w.longitude, w.latitude]) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 5);
  }, [me, allWineries]);

  const entries = useMemo(
    () => me ? nearby : wineries.map((w) => ({ w, km: null as number | null })),
    [me, nearby, wineries],
  );
  const visibleWineries = useMemo(() => entries.map(({ w }) => w), [entries]);
  const selected = visibleWineries.find((w) => w.id === selectedId);
  const selectWinery = (id: string | null) => {
    setListExpanded(false);
    setSelectedId(id);
  };
  useEffect(() => {
    if (!selectedId) return;
    const item = listRef.current?.querySelector(`[data-winery-id="${selectedId}"]`);
    item?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [selectedId]);

  return (
    <main className="wine-map-page relative h-dvh w-full overflow-hidden">
      <section aria-label="Winery map" className="absolute inset-0">
        <WineMap wineries={visibleWineries} region={region} selectedId={selectedId} onSelect={selectWinery} onLocate={(coords) => { setMe(coords); setSelectedId(null); }} />
      </section>

      <header className="map-header absolute left-3 right-16 top-3 z-10 rounded-lg border bg-card p-4 shadow-lg sm:left-5 sm:top-5 lg:right-auto lg:w-96 lg:p-5">
        <p className="eyebrow">Wine trips · Field notes</p>
        <div className="mt-1 min-w-0">
          <h1 className="min-w-0 text-3xl font-medium leading-tight">Cellar Door</h1>
          <p className="mt-1 text-sm text-muted-foreground">Where to taste</p>
          <label className="sr-only" htmlFor="region">Region</label>
          <select
            id="region"
            value={regionId}
            onChange={(e) => {
              setRegionId(e.target.value);
               setMe(null);
              setSelectedId(null);
            }}
            className="mt-4 h-11 w-full min-w-0 rounded-md border bg-background px-3 text-base font-semibold"
          >
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}, {r.country}
              </option>
            ))}
          </select>
        </div>
      </header>

      {selected && (
        <div className="map-preview absolute inset-x-3 z-20 overflow-hidden rounded-lg border bg-card shadow-xl lg:inset-x-auto lg:bottom-8 lg:left-[calc(50%+12rem)] lg:w-96 lg:-translate-x-1/2">
          <Button variant="ghost" size="icon" aria-label="Close winery preview" onClick={() => setSelectedId(null)} className="absolute right-1 top-1 z-10 h-11 w-11 bg-card"><X /></Button>
          <Link
            to="/wineries/$id"
            params={{ id: selected.id }}
            className="flex min-h-32 overflow-hidden pr-10"
          >
            {selected.photo_url && (
              <img src={selected.photo_url} alt="" className="w-20 shrink-0 object-cover sm:w-28" />
            )}
            <div className="flex min-w-0 flex-col justify-center gap-1 p-3 sm:p-4">
              <p className="eyebrow">{regions.find((r) => r.id === selected.region_id)?.name}</p>
              <h2 className="break-words text-lg leading-tight sm:text-xl">{selected.name}</h2>
              <p className="text-sm text-muted-foreground">
                {selected.appointment_required ? "By appointment" : "Walk-ins welcome"} · {selected.tasting_fee}
              </p>
              <span className="text-sm font-semibold text-primary">Read the notes →</span>
            </div>
          </Link>
        </div>
      )}

      <aside aria-label="Winery directory" className={`map-directory absolute inset-x-3 bottom-3 z-10 flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-xl sm:inset-x-5 sm:bottom-5 lg:bottom-5 lg:left-5 lg:right-auto lg:top-56 lg:w-96 ${listExpanded ? "map-directory-expanded" : ""}`}>
        <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-4 lg:px-5">
         <div className="min-w-0">
         <p className="eyebrow">{me ? "Closest to you" : "In this region"}</p>
         <h2 className="mt-1 break-words text-xl">
          {me ? "A short drive away" : `${wineries.length} cellars in ${region?.name ?? "—"}`}
        </h2>
         </div>
         <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 lg:hidden" aria-label={listExpanded ? "Collapse winery list" : "Expand winery list"} aria-expanded={listExpanded} onClick={() => setListExpanded(!listExpanded)}>{listExpanded ? <ChevronDown /> : <ChevronUp />}</Button>
         {me && <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Show region wineries" onClick={() => setMe(null)}><X /></Button>}
        </div>
         <ol ref={listRef} className="min-h-0 flex-1 divide-y overflow-y-auto overscroll-contain px-4 lg:px-5">
          {entries.map(({ w, km }, i) => (
            <li key={w.id} data-winery-id={w.id}>
               <Button variant="ghost" onClick={() => selectWinery(w.id)} aria-pressed={selectedId === w.id} className={`group grid h-auto w-full grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 whitespace-normal rounded-none px-0 py-4 text-left ${selectedId === w.id ? "bg-secondary text-primary" : ""}`}>
                <span className="shrink-0 font-serif text-lg italic text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 break-words">
                   <span className="block font-serif text-lg group-hover:text-primary">{w.name}</span>
                  <span className="text-sm text-muted-foreground">{w.address}</span>
                </span>
                {km != null && <span className="shrink-0 whitespace-nowrap text-sm font-semibold text-primary">{km.toFixed(1)} km</span>}
                 {km == null && <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />}
              </Button>
            </li>
          ))}
        </ol>
      </aside>
    </main>
  );
}
