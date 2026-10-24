import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Winery } from "@/lib/wine";

export type DuplicatePair = { winery_a: Winery; winery_b: Winery; distance_metres: number };
export const listDuplicatePairs = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data, error } = await context.supabase.rpc("winery_duplicate_candidates");
  if (error) throw new Error(error.message);
  return data as unknown as DuplicatePair[];
});
const pairSchema = z.object({ a: z.string().uuid(), b: z.string().uuid() }).refine((p) => p.a !== p.b, "Choose different wineries");
export const dismissDuplicatePair = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => pairSchema.parse(input)).handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("dismiss_winery_duplicate", { _a: data.a, _b: data.b });
    if (error) throw new Error(error.message);
  });
export const mergeDuplicatePair = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => pairSchema.parse(input)).handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("merge_winery_duplicate", { _keep: data.a, _remove: data.b });
    if (error) throw new Error(error.message);
    return id;
  });