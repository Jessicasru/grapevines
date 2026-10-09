import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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

  const region = regions.find((r) => r.id === regionId) ?? null;
  const wineries = useMemo(
    () => allWineries.filter((w) => w.region_id === regionId),
    [allWineries, regionId],
  );
  const selected = wineries.find((w) => w.id === selectedId);

  const nearby = useMemo(() => {
    if (!me) return [];
    return allWineries
      .map((w) => ({ w, km: distanceKm(me, [w.longitude, w.latitude]) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 5);
  }, [me, allWineries]);

  return (
    <main className="mx-auto min-h-screen max-w-2xl">
      <header className="px-5 pb-4 pt-6">
        <p className="eyebrow">Cellar Door · Field notes</p>
        <div className="mt-1 flex items-end justify-between gap-3">
          <h1 className="text-4xl font-medium italic leading-none">Where to taste</h1>
          <label className="sr-only" htmlFor="region">Region</label>
          <select
            id="region"
            value={regionId}
            onChange={(e) => {
              setRegionId(e.target.value);
              setSelectedId(null);
            }}
            className="rounded-full border bg-card px-4 py-2 text-sm font-semibold"
          >
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}, {r.country}
              </option>
            ))}
          </select>
        </div>
      </header>

      <section className="relative h-[58vh] overflow-hidden border-y">
        <WineMap wineries={wineries} region={region} onSelect={setSelectedId} onLocate={setMe} />
        {selected && (
          <Link
            to="/wineries/$id"
            params={{ id: selected.id }}
            className="absolute inset-x-3 bottom-3 flex overflow-hidden rounded-lg bg-card shadow-xl"
          >
            {selected.photo_url && (
              <img src={selected.photo_url} alt="" className="h-28 w-28 shrink-0 object-cover" />
            )}
            <div className="flex flex-col justify-center gap-1 p-4">
              <p className="eyebrow">{region?.name}</p>
              <h2 className="text-xl leading-tight">{selected.name}</h2>
              <p className="text-sm text-muted-foreground">
                {selected.appointment_required ? "By appointment" : "Walk-ins welcome"} · {selected.tasting_fee}
              </p>
              <span className="text-sm font-semibold text-primary">Read the notes →</span>
            </div>
          </Link>
        )}
      </section>

      <section className="px-5 py-8">
        <p className="eyebrow">{me ? "Closest to you" : "In this region"}</p>
        <h2 className="mt-1 text-2xl">
          {me ? "A short drive away" : `${wineries.length} cellars in ${region?.name ?? "—"}`}
        </h2>
        {!me && (
          <p className="mt-1 text-sm text-muted-foreground">Tap “Near me” on the map to sort by distance.</p>
        )}
        <ol className="mt-5 divide-y border-y">
          {(me ? nearby : wineries.map((w) => ({ w, km: null as number | null }))).map(({ w, km }, i) => (
            <li key={w.id}>
              <Link to="/wineries/$id" params={{ id: w.id }} className="flex items-baseline gap-4 py-4">
                <span className="font-serif text-lg italic text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                <span className="flex-1">
                  <span className="block font-serif text-lg">{w.name}</span>
                  <span className="text-sm text-muted-foreground">{w.address}</span>
                </span>
                {km != null && <span className="text-sm font-semibold text-primary">{km.toFixed(1)} km</span>}
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
