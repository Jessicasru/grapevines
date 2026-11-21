import { supabase } from "@/integrations/supabase/client";

/** Flag codes written by refresh_winery_review_flags() in the database. */
export const FLAG_LABELS = {
  not_winery_name: "Name suggests it isn't a winery",
  no_website: "No website",
  single_source: "Only one source",
  possible_duplicate: "Possible duplicate",
} as const;
export type Flag = keyof typeof FLAG_LABELS;
export const FLAGS = Object.keys(FLAG_LABELS) as Flag[];
export const flagLabel = (flag: string) => FLAG_LABELS[flag as Flag] ?? flag;

export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export type AdminWinery = {
  id: string;
  name: string;
  address: string | null;
  village: string | null;
  website: string | null;
  latitude: number;
  longitude: number;
  region_id: string;
  review_status: string;
  review_flags: string[];
  sources: unknown;
  last_verified_at: string | null;
};

export type ReviewFilters = {
  status: ReviewStatus | "all";
  flagged: "all" | "flagged" | "unflagged";
  reason: Flag | "any";
  region: string | "all";
};

export function filterWineries<
  T extends Pick<AdminWinery, "review_status" | "review_flags" | "region_id">,
>(list: T[], f: ReviewFilters) {
  return list.filter(
    (w) =>
      (f.status === "all" || w.review_status === f.status) &&
      (f.flagged === "all" || (f.flagged === "flagged") === w.review_flags.length > 0) &&
      (f.reason === "any" || w.review_flags.includes(f.reason)) &&
      (f.region === "all" || w.region_id === f.region),
  );
}

export function reviewCounts(list: Pick<AdminWinery, "review_status" | "review_flags">[]) {
  const status: Record<string, number> = Object.fromEntries(REVIEW_STATUSES.map((s) => [s, 0]));
  const flag: Record<string, number> = Object.fromEntries(FLAGS.map((f) => [f, 0]));
  let unflagged = 0;
  for (const w of list) {
    status[w.review_status] = (status[w.review_status] ?? 0) + 1;
    if (w.review_flags.length === 0) unflagged++;
    for (const f of w.review_flags) flag[f] = (flag[f] ?? 0) + 1;
  }
  return { status, flag, unflagged };
}

/** The wineries "Approve all unflagged" will approve in one region. */
export function approvableIn<
  T extends Pick<AdminWinery, "review_status" | "review_flags" | "region_id">,
>(list: T[], regionId: string) {
  return filterWineries(list, {
    status: "pending",
    flagged: "unflagged",
    reason: "any",
    region: regionId,
  });
}

/** Only http(s) links are safe to render as a link. */
export function safeUrl(value: string | null | undefined) {
  const url = value?.trim();
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

const SOURCE_NAMES: Record<string, string> = {
  osm: "OpenStreetMap",
  datatourisme: "DATAtourisme",
  overture: "Overture",
};

/** Each source of a winery, with a link to the source record when one exists. */
export function sourceLinks(sources: unknown): { label: string; id: string; url?: string }[] {
  if (!Array.isArray(sources)) return [];
  return sources.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { source, source_id } = entry as { source?: unknown; source_id?: unknown };
    if (typeof source !== "string") return [];
    const id = typeof source_id === "string" ? source_id : "";
    const url =
      source === "osm" && /^(node|way|relation)\/\d+$/.test(id)
        ? `https://www.openstreetmap.org/${id}`
        : safeUrl(id);
    return [{ label: SOURCE_NAMES[source] ?? source, id, ...(url ? { url } : {}) }];
  });
}

// The generated database types don't know the review_flags column or the two
// functions below until Lovable regenerates them, so these calls are untyped.
type Result = PromiseLike<{ data: unknown; error: { message: string } | null }>;
const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (fn: string, args?: Record<string, unknown>) => Result)(fn, args);

/** Recomputes the stored flags. Returns how many wineries changed. */
export async function refreshReviewFlags() {
  const { data, error } = await rpc("refresh_winery_review_flags");
  if (error) throw new Error(error.message);
  return data as number;
}

/** Approves nothing unless exactly `expected` wineries qualify. */
export async function approveUnflagged(regionId: string, expected: number) {
  const { data, error } = await rpc("approve_unflagged_wineries", {
    _region: regionId,
    _expected: expected,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

const PAGE = 1000;
const COLUMNS =
  "id, name, address, village, website, latitude, longitude, region_id, review_status, review_flags, sources, last_verified_at";

/** Every winery that isn't merged away, read in pages because one request returns at most 1000 rows. */
export async function fetchAdminWineries() {
  const all: AdminWinery[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("wineries")
      .select(COLUMNS)
      .is("merged_into", null)
      .order("name")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as AdminWinery[];
    all.push(...rows);
    if (rows.length < PAGE) return all;
  }
}

export type WineryEdit = {
  name: string;
  address: string | null;
  website: string | null;
  latitude: number;
  longitude: number;
};

/** Checks an edit form. Returns the cleaned values, or a message saying what to fix. */
export function parseWineryEdit(form: {
  name: string;
  address: string;
  website: string;
  latitude: string;
  longitude: string;
}): WineryEdit | string {
  const name = form.name.trim();
  if (!name) return "Give the winery a name.";
  if (name.length > 120) return "Keep the name under 120 characters.";
  const website = form.website.trim();
  if (website && !safeUrl(website)) return "The website must start with http:// or https://.";
  const latitude = Number(form.latitude);
  const longitude = Number(form.longitude);
  if (form.latitude.trim() === "" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90)
    return "Latitude must be a number between -90 and 90.";
  if (
    form.longitude.trim() === "" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  )
    return "Longitude must be a number between -180 and 180.";
  return {
    name,
    address: form.address.trim() || null,
    website: website || null,
    latitude,
    longitude,
  };
}
