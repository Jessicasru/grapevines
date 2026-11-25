import type { Geometry } from "geojson";
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { listDuplicatePairs, listDuplicateHistory } from "@/lib/duplicates.functions";

/** A region without its outline, which is large; outlines come from boundariesQuery. */
export type Region = Omit<Tables<"regions">, "boundary">;
export type Winery = Tables<"wineries">;
export type Recommendation = Tables<"recommendations">;
export type SaveStatus = "want_to_visit" | "been_here";

export const duplicatePairsQuery = (userId: string, regionId: string) => queryOptions({
  queryKey: ["admin-duplicates", userId, regionId], queryFn: () => listDuplicatePairs({ data: { regionId } }),
});
export const duplicateHistoryQuery = (userId: string) => queryOptions({
  queryKey: ["admin-duplicate-history", userId], queryFn: () => listDuplicateHistory(),
});

export const regionsQuery = queryOptions({
  queryKey: ["regions"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("regions")
      .select("id, name, country, center_lat, center_lng, default_zoom, created_at")
      .order("name");
    if (error) throw error;
    return data;
  },
});

/** Region outlines as GeoJSON geometries, for the subtle map overlay. */
export const boundariesQuery = queryOptions({
  queryKey: ["region-boundaries"],
  queryFn: async () => {
    const { data, error } = await supabase.rpc("region_boundaries");
    if (error) throw error;
    return (data ?? []) as unknown as { id: string; geojson: Geometry }[];
  },
});

export const wineriesQuery = queryOptions({
  queryKey: ["wineries"],
  queryFn: async () => {
    const { data, error } = await supabase.from("wineries").select("*, recommendations(verdict)").is("merged_into", null).order("name");
    if (error) throw error;
    return data;
  },
});

/** Featured wineries, or any with at least one public "Go", appear in the carousel with burgundy pins. */
export function isRecommended(w: { featured: boolean; recommendations?: { verdict: string }[] | null }) {
  return w.featured || !!w.recommendations?.some((r) => r.verdict === "go");
}

export const villageOf = (w: Pick<Winery, "village" | "address">) =>
  w.village || w.address?.split(/\d{5}\s*/).pop()?.trim() || w.address || "";

/** Case- and accent-insensitive name search. */
export function searchWineries<T extends { name: string }>(list: T[], q: string, limit = 8) {
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const needle = norm(q.trim());
  if (!needle) return [];
  return list.filter((w) => norm(w.name).includes(needle)).slice(0, limit);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const wineryQuery = (id: string) =>
  queryOptions({
    queryKey: ["winery", id],
    queryFn: async () => {
      // Malformed ids (e.g. /wineries/1) are a lookup miss, not a crash.
      if (!UUID_RE.test(id)) return null;
      const { data, error } = await supabase
        .from("wineries")
        .select("*, regions(name, country), recommendations(*)")
        .eq("id", id)
        .is("merged_into", null)
        .order("created_at", { referencedTable: "recommendations", ascending: false })
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

export const savesQuery = (userId: string) =>
  queryOptions({
    queryKey: ["saves", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saves")
        .select("*, wineries!inner(id, name, address, village, photo_url, region_id)")
        .is("wineries.merged_into", null)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

/** Great-circle distance in kilometres. */
export function distanceKm(a: [number, number], b: [number, number]) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
