import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CheckCheck, Pencil, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { regionsQuery } from "@/lib/wine";
import {
  FLAGS,
  REVIEW_STATUSES,
  approvableIn,
  approveUnflagged,
  fetchAdminWineries,
  filterWineries,
  flagLabel,
  parseWineryEdit,
  refreshReviewFlags,
  reviewCounts,
  safeUrl,
  sourceLinks,
  type AdminWinery,
  type ReviewFilters,
} from "@/lib/review";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

function HiddenNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

const chip = "rounded-full bg-tag px-2.5 py-0.5 text-xs font-medium text-tag-foreground";
const flagChip =
  "rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive";
const selectClass = "h-9 w-full rounded-md border border-input bg-card px-2 text-sm";
const PAGE_SIZE = 50;
const plural = (n: number, word: string) =>
  `${n} ${n === 1 ? word : word.replace(/y$/, "ie") + "s"}`;

function Filter({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  const id = `filter-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        className={`mt-1 ${selectClass}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="inline text-muted-foreground">{label}</dt>
      <dd className="ml-1.5 inline font-semibold">{value}</dd>
    </div>
  );
}

function EditDialog({
  winery,
  onClose,
  onSaved,
}: {
  winery: AdminWinery;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: winery.name,
    address: winery.address ?? "",
    website: winery.website ?? "",
    latitude: String(winery.latitude),
    longitude: String(winery.longitude),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = (
    key: keyof typeof form,
    label: string,
    props?: React.ComponentProps<typeof Input>,
  ) => (
    <div>
      <Label htmlFor={`edit-${key}`}>{label}</Label>
      <Input
        id={`edit-${key}`}
        className="mt-1"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        disabled={busy}
        {...props}
      />
    </div>
  );
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const edit = parseWineryEdit(form);
    if (typeof edit === "string") return setError(edit);
    setBusy(true);
    setError(null);
    try {
      const { error: failed } = await supabase.from("wineries").update(edit).eq("id", winery.id);
      if (failed) throw new Error(failed.message);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the winery.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-[calc(100%-32px)] sm:max-w-lg">
        <DialogTitle>Edit winery</DialogTitle>
        <DialogDescription>
          A later import from the same source can overwrite these values.
        </DialogDescription>
        <form onSubmit={save} className="space-y-3">
          {field("name", "Name", { required: true, maxLength: 120 })}
          {field("address", "Address")}
          {field("website", "Website", { type: "url", placeholder: "https://" })}
          <div className="grid grid-cols-2 gap-3">
            {field("latitude", "Latitude", { inputMode: "decimal" })}
            {field("longitude", "Longitude", { inputMode: "decimal" })}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AdminPage() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const isAdmin = !!profile?.is_admin;
  const [sessionChecked, setSessionChecked] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().finally(() => setTimeout(() => setSessionChecked(true), 300));
  }, []);

  const [filters, setFilters] = useState<ReviewFilters>({
    status: "pending",
    flagged: "all",
    reason: "any",
    region: "all",
  });
  const [shown, setShown] = useState(PAGE_SIZE);
  const [editing, setEditing] = useState<AdminWinery | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; name: string; count: number } | null>(null);
  const setFilter = (patch: Partial<ReviewFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setShown(PAGE_SIZE);
  };

  const regions = useQuery({ ...regionsQuery, enabled: isAdmin });
  // Flags depend on imports, edits and duplicate review, so recompute them once each time the page opens.
  const flags = useQuery({
    queryKey: ["admin-review-flags"],
    enabled: isAdmin,
    queryFn: refreshReviewFlags,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const wineries = useQuery({
    queryKey: ["admin-wineries"],
    enabled: isAdmin && flags.isSuccess,
    queryFn: fetchAdminWineries,
  });
  const reload = () => qc.invalidateQueries({ queryKey: ["admin-wineries"] });

  const setReview = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      const { error } = await supabase
        .from("wineries")
        .update({ review_status: status, last_verified_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: reload,
    onError: () => toast.error("Couldn't update the winery. Please try again."),
  });

  const approveAll = useMutation({
    mutationFn: ({ id, count }: { id: string; name: string; count: number }) =>
      approveUnflagged(id, count),
    onSuccess: (approved, { name }) =>
      toast.success(`Approved ${plural(approved, "winery")} in ${name}.`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't approve the wineries."),
    onSettled: reload,
  });

  const all = useMemo(() => wineries.data ?? [], [wineries.data]);
  const inRegion = useMemo(
    () => (filters.region === "all" ? all : all.filter((w) => w.region_id === filters.region)),
    [all, filters.region],
  );
  const counts = useMemo(() => reviewCounts(inRegion), [inRegion]);
  const list = useMemo(() => filterWineries(all, filters), [all, filters]);

  if (!sessionChecked || (user && !profile)) return <div className="min-h-dvh bg-background" />;
  if (!isAdmin) return <HiddenNotFound />;

  const failure = flags.error ?? wineries.error;
  const regionName = (id: string) =>
    regions.data?.find((r) => r.id === id)?.name ?? "Unknown region";

  let body: React.ReactNode;
  if (failure) {
    body = (
      <p role="alert" className="mt-6 text-sm text-destructive">
        Couldn't load the wineries: {failure.message}
      </p>
    );
  } else if (!wineries.data) {
    body = <p className="mt-6 text-sm text-muted-foreground">Loading wineries…</p>;
  } else {
    body = (
      <>
        <section
          aria-label="Counts"
          className="mt-4 rounded-lg bg-card p-4 text-sm"
          style={cardShadow}
        >
          <p className="text-xs text-muted-foreground">
            {plural(inRegion.length, "winery")} in{" "}
            {filters.region === "all" ? "all regions" : regionName(filters.region)} · rejected ones
            are hidden from the public map
          </p>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
            {REVIEW_STATUSES.map((s) => (
              <Count
                key={s}
                label={s[0]?.toUpperCase() + s.slice(1)}
                value={counts.status[s] ?? 0}
              />
            ))}
          </dl>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
            {FLAGS.map((f) => (
              <Count key={f} label={flagLabel(f)} value={counts.flag[f] ?? 0} />
            ))}
            <Count label="No flag" value={counts.unflagged} />
          </dl>
        </section>

        <section aria-label="Approve unflagged wineries" className="mt-3 space-y-2">
          {(regions.data ?? []).map((r) => {
            const count = approvableIn(all, r.id).length;
            return (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-card p-4"
                style={cardShadow}
              >
                <p className="text-sm">
                  <span className="font-semibold">{r.name}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {plural(count, "pending winery")} without flags
                  </span>
                </p>
                <Button
                  size="sm"
                  className="rounded-full"
                  disabled={count === 0 || approveAll.isPending}
                  onClick={() => setConfirm({ id: r.id, name: r.name, count })}
                >
                  <CheckCheck className="size-4" /> Approve all unflagged
                </Button>
              </div>
            );
          })}
        </section>

        <section aria-label="Filters" className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Filter
            label="Review status"
            value={filters.status}
            onChange={(v) => setFilter({ status: v as ReviewFilters["status"] })}
          >
            <option value="all">All</option>
            {REVIEW_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0]?.toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Filter>
          <Filter
            label="Flags"
            value={filters.flagged}
            onChange={(v) => setFilter({ flagged: v as ReviewFilters["flagged"] })}
          >
            <option value="all">All</option>
            <option value="flagged">Flagged</option>
            <option value="unflagged">Not flagged</option>
          </Filter>
          <Filter
            label="Flag reason"
            value={filters.reason}
            onChange={(v) => setFilter({ reason: v as ReviewFilters["reason"] })}
          >
            <option value="any">Any</option>
            {FLAGS.map((f) => (
              <option key={f} value={f}>
                {flagLabel(f)}
              </option>
            ))}
          </Filter>
          <Filter label="Region" value={filters.region} onChange={(v) => setFilter({ region: v })}>
            <option value="all">All</option>
            {(regions.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Filter>
        </section>

        <p aria-live="polite" className="mt-4 text-sm text-muted-foreground">
          {list.length === 0
            ? "No wineries match these filters."
            : `${plural(list.length, "winery")} match`}
        </p>
        <ul className="mt-3 space-y-3">
          {list.slice(0, shown).map((w) => {
            const website = safeUrl(w.website);
            const sources = sourceLinks(w.sources);
            return (
              <li key={w.id} className="rounded-lg bg-card p-4" style={cardShadow}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 basis-64">
                    <p className="break-words font-semibold">{w.name}</p>
                    <p className="break-words text-sm text-muted-foreground">
                      {w.address || w.village || "No address"} · {regionName(w.region_id)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className={chip}>{w.review_status}</span>
                      {w.review_flags.map((f) =>
                        f === "possible_duplicate" ? (
                          <Link key={f} to="/admin/duplicates" className={`${flagChip} underline`}>
                            {flagLabel(f)}
                          </Link>
                        ) : (
                          <span key={f} className={flagChip}>
                            {flagLabel(f)}
                          </span>
                        ),
                      )}
                    </div>
                    <dl className="mt-2 space-y-0.5 text-sm">
                      <div>
                        <dt className="inline text-muted-foreground">Source: </dt>
                        <dd className="inline">
                          {sources.length === 0 && "none"}
                          {sources.map((s, i) => (
                            <span key={i}>
                              {i > 0 && ", "}
                              {s.url ? (
                                <a
                                  href={s.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary underline"
                                >
                                  {s.label}
                                </a>
                              ) : (
                                `${s.label}${s.id ? ` (${s.id})` : ""}`
                              )}
                            </span>
                          ))}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline text-muted-foreground">Website: </dt>
                        <dd className="inline break-all">
                          {website ? (
                            <a
                              href={website}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary underline"
                            >
                              {website}
                            </a>
                          ) : (
                            w.website?.trim() || "none"
                          )}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
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
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => setEditing(w)}
                    >
                      <Pencil className="size-4" /> Edit
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {list.length > shown && (
          <Button
            variant="outline"
            className="mt-4 w-full rounded-full"
            onClick={() => setShown(shown + PAGE_SIZE)}
          >
            Show more ({list.length - shown} left)
          </Button>
        )}
      </>
    );
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 pt-4">
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
      <div className="mx-auto w-full max-w-3xl px-4 pb-16">{body}</div>
      {editing && (
        <EditDialog
          winery={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            // An edit can add or clear a flag, such as "No website".
            await refreshReviewFlags();
            await reload();
          }}
        />
      )}
      <AlertDialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Approve {confirm && plural(confirm.count, "winery")} in {confirm?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              These are the pending wineries with no flag. Flagged wineries stay pending. If the
              number has changed since this page loaded, nothing is approved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm) approveAll.mutate(confirm);
              }}
            >
              Approve {confirm?.count}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
