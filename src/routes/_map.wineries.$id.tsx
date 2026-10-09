import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { wineryQuery } from "@/lib/wine";

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
  component: () => null,
});

