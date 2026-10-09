import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Region = Tables<"regions">;
export type Winery = Tables<"wineries">;
export type Recommendation = Tables<"recommendations">;

export const regionsQuery = queryOptions({
  queryKey: ["regions"],
  queryFn: async () => {
    const { data, error } = await supabase.from("regions").select("*").order("name");
    if (error) throw error;
    return data;
  },
});

export const wineriesQuery = queryOptions({
  queryKey: ["wineries"],
  queryFn: async () => {
    const { data, error } = await supabase.from("wineries").select("*").order("name");
    if (error) throw error;
    return data;
  },
});

export const wineryQuery = (id: string) =>
  queryOptions({
    queryKey: ["winery", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wineries")
        .select("*, regions(name, country), recommendations(*)")
        .eq("id", id)
        .order("created_at", { referencedTable: "recommendations", ascending: false })
        .maybeSingle();
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
