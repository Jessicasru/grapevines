import { createFileRoute, redirect } from "@tanstack/react-router";

// Recommendations now happen inside the winery sheet ("Been here"); keep old links working.
export const Route = createFileRoute("/wineries/$id_/recommend")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/wineries/$id", params: { id: params.id } });
  },
});
