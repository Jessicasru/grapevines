import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { wineryQuery } from "@/lib/wine";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_map/wineries/$id")({
  loader: async ({ context, params }) => {
    const w = await context.queryClient.ensureQueryData(wineryQuery(params.id));
    if (!w) throw notFound();
    return { name: w.name, region: w.regions?.name ?? "", photo: w.photo_url };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Winery not found" }, { name: "robots", content: "noindex" }] };
    const t = `${loaderData.name} — ${loaderData.region} | Cellar Door`;
    const d = `Practical info and traveller notes for ${loaderData.name} in ${loaderData.region}.`;
    return {
      meta: [
        { title: t },
        { name: "description", content: d },
        { property: "og:title", content: t },
        { property: "og:description", content: d },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary_large_image" },
        ...(loaderData.photo?.startsWith("https://") ? [
          { property: "og:image", content: loaderData.photo },
          { name: "twitter:image", content: loaderData.photo },
        ] : []),
      ],
    };
  },
  notFoundComponent: () => (
    <div className="p-10 text-center">
      <h1 className="text-3xl">Winery not found</h1>
      <Link to="/" className="mt-4 inline-block text-primary underline">Back to the map</Link>
    </div>
  ),
  component: WineryPage,
});

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t py-3">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 break-words font-serif text-lg">{value}</dd>
    </div>
  );
}

function WineryPage() {
  const { id } = Route.useParams();
  const { data: w } = useSuspenseQuery(wineryQuery(id));
  if (!w) return null;
  const recs = w.recommendations ?? [];
  const goCount = recs.filter((r) => r.verdict === "go").length;

  return (
    <main className="mx-auto min-h-dvh max-w-7xl pb-16 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-12 lg:px-8 lg:pt-8">
      <div className="relative lg:sticky lg:top-8">
        {w.photo_url && <img src={w.photo_url} alt={w.name} className="aspect-[4/3] w-full object-cover sm:aspect-[16/9] lg:aspect-[4/5] lg:max-h-[calc(100dvh-4rem)]" />}
        <Button asChild variant="secondary" className="absolute left-4 top-4 h-11 bg-card px-4 text-sm font-semibold shadow">
        <Link to="/">
          ← Map
        </Link>
        </Button>
      </div>

      <article className="mx-auto w-full min-w-0 max-w-2xl px-5 sm:px-8 lg:px-0">
        <p className="eyebrow mt-6">{w.regions?.name}, {w.regions?.country}</p>
        <h1 className="mt-1 break-words text-3xl font-medium leading-tight sm:text-4xl">{w.name}</h1>
        <p className="mt-2 text-muted-foreground">{w.address}</p>

        <dl className="mt-8 grid grid-cols-2 gap-x-6">
          <Fact label="Appointment" value={w.appointment_required ? "Required" : "Not needed"} />
          <Fact label="Tasting fee" value={w.tasting_fee ?? "—"} />
          <Fact label="Open" value={w.opening_days ?? "—"} />
          <Fact label="Ships abroad" value={w.ships_abroad ? "Yes" : "No"} />
          <div className="col-span-2">
            <Fact label="Languages" value={w.languages.join(", ") || "—"} />
          </div>
        </dl>

        <section className="mt-12">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 border-b pb-3">
            <div className="min-w-0">
              <p className="eyebrow">From fellow travellers</p>
              <h2 className="break-words text-xl sm:text-2xl">
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
      </article>
    </main>
  );
}
