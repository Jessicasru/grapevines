import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_map/")({
  head: () => ({ meta: [
    { title: "Grapevines — Wine trip recommendations" },
    { name: "description", content: "Wine trip recommendations from the wine community." },
    { property: "og:title", content: "Grapevines — Wine trip recommendations" },
    { property: "og:description", content: "Wine trip recommendations from the wine community." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => null,
});