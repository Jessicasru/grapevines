import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Winery } from "@/lib/wine";

export type DuplicatePair = { winery_a: Winery; winery_b: Winery; distance_metres: number; classification: 'same' | 'different' | 'unique_osm' | 'manual'; address_a: { house: string; street: string }; address_b: { house: string; street: string } };
export type DuplicatePreview = { id: string; pairs: DuplicatePair[] };
export type MergeEntry = { id: string; kept_id: string; removed_id: string; mode: string; created_at: string; wineries: Winery[] };
export type DismissedEntry = { winery_a: Winery; winery_b: Winery; reason: string; created_at: string };
export type DuplicateHistory = { merged: MergeEntry[]; dismissed: DismissedEntry[]; last_run?: { dismissed: number; merged: number; manual_remaining: number } | null };
// One region at a time: over every region, the search runs too long. ("as never" until
// Lovable regenerates the database types with the new region argument.)
const regionSchema = z.object({ regionId: z.string().uuid() });
export const listDuplicatePairs = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => regionSchema.parse(input)).handler(async ({ data: input, context }) => {
  const { data, error } = await context.supabase.rpc("winery_duplicate_candidates", { _region_id: input.regionId } as never);
  if (error) throw new Error(error.message);
  return data as unknown as DuplicatePair[];
});
const pairSchema = z.object({ a: z.string().uuid(), b: z.string().uuid() }).refine((p) => p.a !== p.b, "Choose different wineries");
export const dismissDuplicatePair = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => pairSchema.parse(input)).handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("dismiss_winery_duplicate", { _a: data.a, _b: data.b });
    if (error) throw new Error(error.message);
  });
export const previewDuplicatePairs = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => regionSchema.parse(input)).handler(async ({ data: input, context }) => {
  const { data, error } = await context.supabase.rpc("preview_winery_duplicates", { _region_id: input.regionId } as never);
  if (error) throw new Error(error.message);
  return data as unknown as DuplicatePreview;
});
export const listDuplicateHistory = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data, error } = await context.supabase.rpc("duplicate_review_history");
  if (error) throw new Error(error.message);
  const { data: run, error: runError } = await context.supabase.from("winery_duplicate_runs").select("summary").eq("run_key", "distance-60m-domain-300m").maybeSingle();
  if (runError) throw new Error(runError.message);
  return { ...(data as unknown as DuplicateHistory), last_run: run?.summary as DuplicateHistory['last_run'] };
});
const idSchema = z.object({ id: z.string().uuid() });
export const applyDuplicatePreview = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input)).handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("apply_winery_duplicates", { _preview: data.id });
    if (error) throw new Error(error.message);
    return result as unknown as { merged: number; dismissed: number };
  });
export const undoDuplicateMerge = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input)).handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("undo_winery_merge", { _id: data.id });
    if (error) throw new Error(error.message);
  });
export const restoreDuplicatePair = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => pairSchema.parse(input)).handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("restore_winery_duplicate", { _a: data.a, _b: data.b });
    if (error) throw new Error(error.message);
  });
export const mergeDuplicatePair = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => pairSchema.parse(input)).handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("merge_winery_duplicate", { _keep: data.a, _remove: data.b });
    if (error) throw new Error(error.message);
    return id;
  });