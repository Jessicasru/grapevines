import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_map/")({
  head: () => ({ meta: [
    { title: "Cellar Door — Wine trip recommendations" },
    { name: "description", content: "Find wineries worth the detour, with honest notes from fellow travellers." },
    { property: "og:title", content: "Cellar Door — Wine trip recommendations" },
    { property: "og:description", content: "Explore the winery map and traveller recommendations." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => null,
});