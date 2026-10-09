import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, List, X } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { WineryDetail } from "@/components/WineryDetail";
import { Button } from "@/components/ui/button";
import { detailSpring } from "@/lib/detail-camera";
import { WineMap } from "@/components/WineMap";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { distanceKm, regionsQuery, wineriesQuery, type Winery } from "@/lib/wine";

export const Route = createFileRoute("/_map")({
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
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const detailId = useRouterState({ select: (state) => {
    const match = state.matches.find((m) => m.routeId === "/_map/wineries/$id");
    return match && "id" in match.params ? String(match.params.id) : null;
  } });
  const closeDetail = useCallback(() => { void navigate({ to: "/", resetScroll: false }); }, [navigate]);
  const [overlayId, setOverlayId] = useState<string | null>(detailId);
  useEffect(() => {
    if (detailId) { setOverlayId(detailId); return; }
    const timer = window.setTimeout(() => setOverlayId(null), reduced ? 150 : 400);
    return () => window.clearTimeout(timer);
  }, [detailId, reduced]);
  const openDetail = (id: string) => {
    window.clearTimeout(settleTimer.current);
    setSheetOpen(false);
    void navigate({ to: "/wineries/$id", params: { id }, resetScroll: false });
  };
  const [regionId, setRegionId] = useState(regions[0]?.id ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [me, setMe] = useState<[number, number] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [snap, setSnap] = useState<number | string | null>(SNAPS[0]);
  const trackRef = useRef<HTMLOListElement>(null);
  const settleTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(settleTimer.current);
    if (!detailId) return;
    const winery = allWineries.find((w) => w.id === detailId);
    if (winery) { setRegionId(winery.region_id); setSelectedId(detailId); }
  }, [detailId, allWineries]);
  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

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

  const scrollTrack = useCallback((dir: 1 | -1) => {
    const track = trackRef.current;
    const card = track?.querySelector<HTMLElement>("[data-winery-id]");
    if (!track || !card) return;
    track.scrollBy({ left: dir * (card.offsetWidth + 12), behavior: "smooth" });
  }, []);

  // Pin tap (or sheet row) → scroll carousel to that card.
  useEffect(() => {
    if (selectedId) scrollToCard(selectedId);
  }, [selectedId, scrollToCard]);

  // Swipe settles on a card → select it (flies map to its pin).
  const onTrackScroll = () => {
    if (detailId) return;
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const track = trackRef.current;
      if (!track) return;
      const mid = track.getBoundingClientRect().left + track.clientWidth / 2;
      let best: { id: string; d: number } | null = null;
      track.querySelectorAll<HTMLElement>("[data-winery-id]").forEach((el) => {
        const r = el.getBoundingClientRect();
        const d = Math.abs(r.left + r.width / 2 - mid);
        const id = el.dataset["wineryId"];
        if (id && (!best || d < best.d)) best = { id, d };
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
    <LayoutGroup id="winery-map">
    <main className="wine-map-page relative h-dvh w-full overflow-hidden">
      <section aria-label="Winery map" className="absolute inset-0">
        <WineMap
          wineries={visibleWineries}
          region={region}
          selectedId={selectedId}
          detailId={detailId}
          onSelect={(id) => { if (id) openDetail(id); else if (detailId) closeDetail(); }}
          onLocate={(coords) => { setMe(coords); setSelectedId(null); }}
        />
      </section>

      <header className="map-glass map-header-pill absolute left-1/2 z-10 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center rounded-full p-1.5 shadow lg:p-2">
        <h1 className="sr-only">Cellar Door</h1>
        <label className="sr-only" htmlFor="region">Region</label>
        <div className="relative min-w-[9.5rem] lg:min-w-[15rem]">
          <select
            id="region"
            value={regionId}
            onChange={(e) => { setRegionId(e.target.value); setMe(null); setSelectedId(null); }}
            className="h-9 w-full min-w-0 appearance-none truncate rounded-full bg-secondary pl-3 pr-8 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-11 lg:pl-4 lg:pr-10 lg:text-base"
          >
            {regions.map((r) => (
              <option key={r.id} value={r.id}>{r.name}, {r.country}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground lg:right-3.5 lg:size-5" />
        </div>
      </header>

      <motion.div animate={{ opacity: detailId ? 0 : 1 }} transition={{ duration: reduced ? 0.15 : 0.25 }} inert={detailId ? true : undefined} aria-hidden={detailId ? true : undefined} className="map-carousel pointer-events-none absolute inset-x-0 bottom-0 z-10">
        <div className="pointer-events-auto mb-2 flex justify-center gap-2 px-4">
          <Button variant="ghost"
            type="button"
            onClick={() => scrollTrack(-1)}
            aria-label="Previous winery"
            className="map-glass hidden h-11 w-11 items-center justify-center rounded-full shadow lg:inline-flex"
          >
            <ChevronLeft className="size-5" />
          </Button>
          <Button variant="ghost"
            type="button"
            onClick={() => { setSnap(SNAPS[0]); setSheetOpen(true); }}
            className="map-glass inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-semibold shadow lg:h-11 lg:px-5 lg:text-base"
          >
            <List className="size-4 lg:size-5" /> {me ? "Closest to you" : "See all"}
          </Button>
          <Button variant="ghost"
            type="button"
            onClick={() => scrollTrack(1)}
            aria-label="Next winery"
            className="map-glass hidden h-11 w-11 items-center justify-center rounded-full shadow lg:inline-flex"
          >
            <ChevronRight className="size-5" />
          </Button>
          {me && (
            <Button variant="ghost"
              type="button"
              onClick={() => setMe(null)}
              aria-label="Show region wineries"
              className="map-glass inline-flex h-9 w-9 items-center justify-center rounded-full shadow lg:h-11 lg:w-11"
            >
              <X className="size-4 lg:size-5" />
            </Button>
          )}
        </div>
        <ol
          ref={trackRef}
          onScroll={onTrackScroll}
          aria-label="Wineries"
          className="map-carousel-track pointer-events-auto flex gap-3 overflow-x-auto overscroll-x-contain"
        >
          {entries.map(({ w, km }, i) => (
            <li key={w.id} data-winery-id={w.id} className="map-card shrink-0">
              <Button variant="ghost"
                onClick={() => openDetail(w.id)}
                aria-label={`Open ${w.name}`}
                aria-current={selectedId === w.id ? "true" : undefined}
                className={`w-full whitespace-normal p-0 text-left hover:bg-card flex h-28 overflow-hidden rounded-lg bg-card shadow outline-none ring-primary transition focus-visible:ring-2 lg:h-36 ${selectedId === w.id ? "map-card-selected ring-2" : ""}`}
              >
                <div className="relative h-full w-24 shrink-0 self-stretch bg-muted lg:w-32">
                  {w.photo_url && <motion.img {...(reduced ? {} : { layoutId: `photo-${w.id}` })} transition={detailSpring} src={w.photo_url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
                  <span className="absolute left-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-3">
                  <motion.h2 {...(reduced ? {} : { layoutId: `name-${w.id}` })} transition={detailSpring} className="truncate text-base font-semibold leading-tight">{w.name}</motion.h2>
                  <p className="truncate text-sm text-muted-foreground">
                    {village(w)}{km != null && ` · ${km.toFixed(1)} km`}
                  </p>
                  <motion.div {...(reduced ? {} : { layoutId: `tags-${w.id}` })} transition={detailSpring} className="mt-1 flex min-w-0 gap-1.5 overflow-hidden">
                    <Tag>{w.appointment_required ? "Appointment" : "Walk-ins"}</Tag>
                    {w.tasting_fee && <Tag>{w.tasting_fee}</Tag>}
                  </motion.div>
                </div>
              </Button>
            </li>
          ))}
        </ol>
      </motion.div>

      <Drawer
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        snapPoints={[...SNAPS]}
        activeSnapPoint={snap}
        setActiveSnapPoint={setSnap}
      >
        <DrawerContent className="mx-auto h-[96dvh] max-w-xl rounded-t-lg border-0 bg-card shadow">
          <div className="px-5 pb-2 pt-3">
            <DrawerTitle className="text-lg">{me ? "Closest to you" : `${entries.length} wineries in ${region?.name ?? ""}`}</DrawerTitle>
            <DrawerDescription>Tap one to see it on the map.</DrawerDescription>
          </div>
          <ol className={`divide-y overflow-y-auto overscroll-contain px-5 pb-8 ${snap === 1 ? "" : "max-h-[calc(50dvh-6rem)]"}`}>
            {entries.map(({ w, km }, i) => (
              <li key={w.id}>
                <Button variant="ghost"
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
                </Button>
              </li>
            ))}
          </ol>
        </DrawerContent>
      </Drawer>
      <Outlet />
      <Suspense fallback={null}>
        <AnimatePresence key={overlayId ?? "closed"}>
          {overlayId && <WineryDetail key={overlayId} id={overlayId} closing={!detailId} onClose={closeDetail} />}
        </AnimatePresence>
      </Suspense>
    </main>
    </LayoutGroup>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="truncate rounded-full bg-tag px-2 py-0.5 text-xs font-semibold text-tag-foreground">
      {children}
    </span>
  );
}
