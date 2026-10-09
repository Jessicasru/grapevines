import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { wineryQuery } from "@/lib/wine";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/wineries/$id_/recommend")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(wineryQuery(params.id)),
  head: ({ loaderData }) => {
    const t = `Add a note${loaderData ? ` on ${loaderData.name}` : ""} | Cellar Door`;
    const d = "Share what to drink and whether it’s worth the visit.";
    return {
      meta: [
        { title: t },
        { name: "description", content: d },
        { property: "og:title", content: t },
        { property: "og:description", content: d },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: RecommendPage,
});

function RecommendPage() {
  const { id } = Route.useParams();
  const { data: w } = useSuspenseQuery(wineryQuery(id));
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [author, setAuthor] = useState("");
  const [note, setNote] = useState("");
  const [wines, setWines] = useState("");
  const [verdict, setVerdict] = useState<"go" | "skip">("go");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!author.trim() || !note.trim()) return setError("Please add your name and a note.");
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("recommendations").insert({
      winery_id: id,
      author_name: author.trim().slice(0, 80),
      note: note.trim().slice(0, 2000),
      wines_to_try: wines.trim().slice(0, 500) || null,
      verdict,
    });
    setBusy(false);
    if (error) return setError("Couldn’t save your note. Please try again.");
    await qc.invalidateQueries({ queryKey: ["winery", id] });
    navigate({ to: "/wineries/$id", params: { id } });
  };

  const field = "mt-2 w-full rounded-md border bg-card px-4 py-3 text-base outline-none focus:ring-2 focus:ring-ring";

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-5 pb-16 pt-6 sm:px-8 sm:pt-10 lg:pt-16">
      <Link to="/wineries/$id" params={{ id }} className="inline-flex min-h-11 items-center break-words text-sm font-semibold text-primary">← {w?.name}</Link>
      <p className="eyebrow mt-8">A note for the next traveller</p>
      <h1 className="mt-1 text-3xl font-medium italic sm:text-4xl">Was it worth it?</h1>

      <form onSubmit={submit} className="mt-8 space-y-6">
        <div className="grid grid-cols-2 gap-3">
          {(["go", "skip"] as const).map((v) => (
            <Button
              key={v}
              type="button"
              onClick={() => setVerdict(v)}
              aria-pressed={verdict === v}
              variant="outline"
              className={`h-20 rounded-lg border font-serif text-2xl transition ${
                verdict === v
                  ? v === "go" ? "border-go bg-go text-go-foreground" : "border-foreground bg-foreground text-background"
                  : "bg-card"
              }`}
            >
              {v === "go" ? "Go" : "Skip"}
            </Button>
          ))}
        </div>
        <label className="block">
          <span className="eyebrow">Your name</span>
          <input className={field} value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={80} />
        </label>
        <label className="block">
          <span className="eyebrow">Personal note</span>
          <textarea className={`${field} min-h-32`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="The welcome, the view, the moment…" />
        </label>
        <label className="block">
          <span className="eyebrow">Wines to try</span>
          <input className={field} value={wines} onChange={(e) => setWines(e.target.value)} maxLength={500} placeholder="e.g. Riesling Grand Cru Schlossberg 2019" />
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button disabled={busy} className="h-14 w-full font-semibold disabled:opacity-60">
          {busy ? "Saving…" : "Publish note"}
        </Button>
      </form>
    </main>
  );
}
