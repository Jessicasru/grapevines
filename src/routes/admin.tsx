import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Cellar Door" },
      { name: "description", content: "Review and manage winery listings." },
      { name: "robots", content: "noindex" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Admin — Cellar Door" },
      { property: "og:description", content: "Review and manage winery listings." },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminPage,
});

const cardShadow = { boxShadow: "var(--shadow-soft)" } as const;

function AdminPage() {
  const { user, profile, requireAuth } = useAuth();
  const qc = useQueryClient();
  const isAdmin = !!profile?.is_admin;

  const wineries = useQuery({
    queryKey: ["admin-wineries"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wineries")
        .select("id, name, village, review_status, enrichment_status, website, last_verified_at, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const setReview = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      const { error } = await supabase
        .from("wineries")
        .update({ review_status: status, last_verified_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-wineries"] }),
    onError: () => toast.error("Couldn't update the winery. Please try again."),
  });

  let body: React.ReactNode;
  if (!user) {
    body = (
      <div className="mx-auto mt-24 max-w-sm rounded-lg bg-card p-6 text-center" style={cardShadow}>
        <h1 className="text-lg font-semibold">Admins only</h1>
        <p className="mt-2 text-sm text-muted-foreground">Sign in to open the admin area.</p>
        <Button className="mt-4 h-11 w-full rounded-full" onClick={() => requireAuth(() => {})}>
          Sign in
        </Button>
      </div>
    );
  } else if (!profile) {
    body = <p className="mt-24 text-center text-sm text-muted-foreground">Loading…</p>;
  } else if (!isAdmin) {
    body = (
      <div className="mx-auto mt-24 max-w-sm rounded-lg bg-card p-6 text-center" style={cardShadow}>
        <h1 className="text-lg font-semibold">Admins only</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your account doesn't have access to this area.</p>
      </div>
    );
  } else {
    const list = wineries.data ?? [];
    body = (
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        <p className="mt-2 text-sm text-muted-foreground">
          {list.length} wineries · rejected ones are hidden from the public map
        </p>
        <ul className="mt-4 space-y-3">
          {list.map((w) => (
            <li key={w.id} className="rounded-lg bg-card p-4" style={cardShadow}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{w.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{w.village || "—"}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-tag px-2.5 py-0.5 text-xs font-medium text-tag-foreground">
                      review: {w.review_status}
                    </span>
                    <span className="rounded-full bg-tag px-2.5 py-0.5 text-xs font-medium text-tag-foreground">
                      enrichment: {w.enrichment_status}
                    </span>
                    {w.website && (
                      <a
                        href={w.website}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full bg-tag px-2.5 py-0.5 text-xs font-medium text-tag-foreground underline"
                      >
                        website
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    disabled={setReview.isPending || w.review_status === "approved"}
                    onClick={() => setReview.mutate({ id: w.id, status: "approved" })}
                  >
                    <Check className="size-4" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    disabled={setReview.isPending || w.review_status === "rejected"}
                    onClick={() => setReview.mutate({ id: w.id, status: "rejected" })}
                  >
                    <X className="size-4" /> Reject
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 pt-4">
        <Link
          to="/"
          aria-label="Back to the map"
          className="grid size-10 place-items-center rounded-full bg-card text-foreground"
          style={cardShadow}
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-xl font-bold">Admin</h1>
      </header>
      {body}
    </div>
  );
}
