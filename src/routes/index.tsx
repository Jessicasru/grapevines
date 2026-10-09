import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, List, X } from "lucide-react";
import { WineMap } from "@/components/WineMap";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { distanceKm, regionsQuery, wineriesQuery, type Winery } from "@/lib/wine";

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

const village = (w: Winery) => w.address?.split(/\d{5}\s*/).pop()?.trim() || w.address;
const SNAPS = [0.5, 1] as const;

function MapPage() {
  const { data: regions } = useSuspenseQuery(regionsQuery);
  const { data: allWineries } = useSuspenseQuery(wineriesQuery);
  const [regionId, setRegionId] = useState(regions[0]?.id ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [me, setMe] = useState<[number, number] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [snap, setSnap] = useState<number | string | null>(SNAPS[0]);
  const trackRef = useRef<HTMLOListElement>(null);
  const settleTimer = useRef<number | undefined>(undefined);

  const region = regions.find((r) => r.id === regionId) ?? null;
  const entries = useMemo(() => {
    if (me) {
      return allWineries
        .map((w) => ({ w, km: distanceKm(me, [w.longitude, w.latitude]) as number | null }))
        .sort((a, b) => (a.km ?? 0) - (b.km ?? 0))
        .slice(0, 5);
    }
    return allWineries.filter((w) => w.region_id === regionId).map((w) => ({ w, km: null as number | null }));
  }, [me, allWineries, regionId]);
  const visibleWineries = useMemo(() => entries.map(({ w }) => w), [entries]);

  const scrollToCard = useCallback((id: string, smooth = true) => {
    const card = trackRef.current?.querySelector<HTMLElement>(`[data-winery-id="${id}"]`);
    card?.scrollIntoView({ inline: "center", block: "nearest", behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Pin tap (or sheet row) → scroll carousel to that card.
  useEffect(() => {
    if (selectedId) scrollToCard(selectedId);
  }, [selectedId, scrollToCard]);

  // Swipe settles on a card → select it (flies map to its pin).
  const onTrackScroll = () => {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const track = trackRef.current;
      if (!track) return;
      const mid = track.getBoundingClientRect().left + track.clientWidth / 2;
      let best: { id: string; d: number } | null = null;
      track.querySelectorAll<HTMLElement>("[data-winery-id]").forEach((el) => {
        const r = el.getBoundingClientRect();
        const d = Math.abs(r.left + r.width / 2 - mid);
        if (!best || d < best.d) best = { id: el.dataset['wineryId']!, d };
      });
      const found = best as { id: string; d: number } | null;
      if (found && found.id !== selectedId) setSelectedId(found.id);
    }, 140);
  };

  const pickFromSheet = (id: string) => {
    setSheetOpen(false);
    setSelectedId(id);
  };

  return (
    <main className="wine-map-page relative h-dvh w-full overflow-hidden">
      <section aria-label="Winery map" className="absolute inset-0">
        <WineMap
          wineries={visibleWineries}
          region={region}
          selectedId={selectedId}
          onSelect={(id) => id && setSelectedId(id)}
          onLocate={(coords) => { setMe(coords); setSelectedId(null); }}
        />
      </section>

      <header className="map-glass absolute left-1/2 top-3 z-10 flex max-w-[calc(100%-6rem)] -translate-x-1/2 items-center rounded-full p-1.5 shadow sm:top-4">
        <h1 className="sr-only">Cellar Door</h1>
        <label className="sr-only" htmlFor="region">Region</label>
        <div className="relative min-w-[9.5rem]">
          <select
            id="region"
            value={regionId}
            onChange={(e) => { setRegionId(e.target.value); setMe(null); setSelectedId(null); }}
            className="h-9 w-full min-w-0 appearance-none truncate rounded-full bg-secondary pl-3 pr-8 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {regions.map((r) => (
              <option key={r.id} value={r.id}>{r.name}, {r.country}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      </header>

      <div className="map-carousel absolute inset-x-0 bottom-0 z-10 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mb-3 flex justify-center gap-2 px-4">
          <button
            type="button"
            onClick={() => { setSnap(SNAPS[0]); setSheetOpen(true); }}
            className="map-glass inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-semibold shadow"
          >
            <List className="size-4" /> {me ? "Closest to you" : `See all ${entries.length}`}
          </button>
          {me && (
            <button
              type="button"
              onClick={() => setMe(null)}
              aria-label="Show region wineries"
              className="map-glass inline-flex h-9 w-9 items-center justify-center rounded-full shadow"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <ol
          ref={trackRef}
          onScroll={onTrackScroll}
          aria-label="Wineries"
          className="map-carousel-track flex gap-3 overflow-x-auto overscroll-x-contain pb-2 pt-1"
        >
          {entries.map(({ w, km }, i) => (
            <li key={w.id} data-winery-id={w.id} className="map-card shrink-0">
              <Link
                to="/wineries/$id"
                params={{ id: w.id }}
                aria-current={selectedId === w.id ? "true" : undefined}
                className={`flex h-28 overflow-hidden rounded-lg bg-card shadow outline-none ring-primary transition focus-visible:ring-2 ${selectedId === w.id ? "ring-2" : ""}`}
              >
                <div className="relative w-24 shrink-0 bg-muted">
                  {w.photo_url && <img src={w.photo_url} alt="" loading="lazy" className="h-full w-full object-cover" />}
                  <span className="absolute left-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-3">
                  <h2 className="truncate text-base font-semibold leading-tight">{w.name}</h2>
                  <p className="truncate text-sm text-muted-foreground">
                    {village(w)}{km != null && ` · ${km.toFixed(1)} km`}
                  </p>
                  <div className="mt-1 flex min-w-0 gap-1.5 overflow-hidden">
                    <Tag>{w.appointment_required ? "Appointment" : "Walk-ins"}</Tag>
                    {w.tasting_fee && <Tag>{w.tasting_fee}</Tag>}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      </div>

      <Drawer
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        snapPoints={[...SNAPS]}
        activeSnapPoint={snap}
        setActiveSnapPoint={setSnap}
      >
        <DrawerContent className="mx-auto h-[96dvh] max-w-xl rounded-t-lg border-0 shadow">
          <div className="px-5 pb-2 pt-3">
            <DrawerTitle className="text-lg">{me ? "Closest to you" : `${entries.length} wineries in ${region?.name ?? ""}`}</DrawerTitle>
            <DrawerDescription>Tap one to see it on the map.</DrawerDescription>
          </div>
          <ol className={`divide-y overflow-y-auto overscroll-contain px-5 pb-8 ${snap === 1 ? "" : "max-h-[calc(50dvh-6rem)]"}`}>
            {entries.map(({ w, km }, i) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => pickFromSheet(w.id)}
                  className="flex w-full items-center gap-3 py-3 text-left"
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{w.name}</span>
                    <span className="block truncate text-sm text-muted-foreground">{village(w)}</span>
                  </span>
                  {km != null && <span className="shrink-0 text-sm font-semibold text-primary">{km.toFixed(1)} km</span>}
                </button>
              </li>
            ))}
          </ol>
        </DrawerContent>
      </Drawer>
    </main>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="truncate rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
      {children}
    </span>
  );
}
